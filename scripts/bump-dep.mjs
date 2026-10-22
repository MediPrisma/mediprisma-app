/**
 * Changes one dependency's version in package.json and package-lock.json
 * without running an install.
 *
 * `npm install` rebuilds the whole lockfile from the tree it just laid down on
 * this machine, which on macOS means losing every optional entry and platform
 * field the host cannot use — see scripts/check-lockfile.mjs. For the routine
 * case of moving a first-party package forward one version, none of that
 * rebuilding is wanted: the dependency graph is unchanged and only a version,
 * a tarball URL, and an integrity hash need to move.
 *
 * So this asks the registry for those three values and edits them in place.
 * The lockfile that comes out differs from the committed one by exactly the
 * lines that had to change.
 *
 *   node scripts/bump-dep.mjs @voho0000/personalized-care 1.2.3
 *
 * Reach for `npm install` when the dependency's own dependencies change, when
 * adding or removing a package, or for anything else that genuinely reshapes
 * the tree — then run `npm run fix:lockfile` afterwards.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const [name, version] = process.argv.slice(2)

if (!name || !version) {
  console.error('Usage: node scripts/bump-dep.mjs <package> <version>')
  process.exit(2)
}

function githubToken() {
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

function registryMetadata() {
  // Windows cannot exec npm.cmd without a shell; preserve argument boundaries
  // by using the same npm JS entry point as npm-with-github-packages.mjs.
  const npmCli = process.platform === 'win32'
    ? process.env.npm_execpath || join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
    : null
  const args = ['view', `${name}@${version}`, 'dist.tarball', 'dist.integrity', 'version', '--json']
  const raw = execFileSync(
    npmCli ? process.execPath : 'npm',
    npmCli ? [npmCli, ...args] : args,
    { encoding: 'utf8', env: { ...process.env, NODE_AUTH_TOKEN: githubToken() } },
  )
  const parsed = JSON.parse(raw)
  // `npm view` answers with an array when the spec matches more than one
  // version; an exact version should not, but a range would.
  const record = Array.isArray(parsed) ? parsed.at(-1) : parsed
  if (record.version !== version) {
    throw new Error(`Registry returned ${record.version} for ${name}@${version}; pass an exact version`)
  }
  return record
}

const meta = registryMetadata()

const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
const field = ['dependencies', 'devDependencies', 'optionalDependencies']
  .find((candidate) => manifest[candidate]?.[name] !== undefined)
if (!field) {
  console.error(`${name} is not a dependency in package.json`)
  process.exit(1)
}
const previous = manifest[field][name]
manifest[field][name] = version

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
const lockKey = `node_modules/${name}`
if (!lock.packages?.[lockKey]) {
  console.error(`${lockKey} is not in package-lock.json; run npm install for a package this new`)
  process.exit(1)
}

lock.packages[''][field][name] = version
lock.packages[lockKey] = {
  ...lock.packages[lockKey],
  version,
  resolved: meta['dist.tarball'],
  integrity: meta['dist.integrity'],
}

writeFileSync('package.json', `${JSON.stringify(manifest, null, 2)}\n`)
writeFileSync('package-lock.json', `${JSON.stringify(lock, null, 2)}\n`)

console.log(`${name}: ${previous} → ${version}`)
console.log('The lockfile is already correct. Run `npm ci` to bring node_modules in line —')
console.log('`npm install` would rewrite the lockfile again and undo this.')
