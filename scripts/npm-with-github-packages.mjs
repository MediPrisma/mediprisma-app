import { execFileSync, spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'

const npmArgs = process.argv.slice(2)

if (npmArgs.length === 0) {
  console.error('Usage: node scripts/npm-with-github-packages.mjs <npm arguments>')
  process.exit(2)
}

// An existing environment token also supports CI without GitHub CLI. Private
// packages are optional: a public checkout must not require a GitHub login.
let githubToken = process.env.NODE_AUTH_TOKEN || ''
if (!githubToken) {
  try {
    githubToken = execFileSync('gh', ['auth', 'token', '-h', 'github.com'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    // npm skips inaccessible optional packages; the app builds without them.
  }
}
if (!githubToken) {
  console.log('Installing public dependencies. Unavailable private features will be omitted.')
}

// Windows cannot exec a .cmd file without a shell. Invoke npm's JS entry
// directly, preserving argument boundaries and keeping credentials in env only.
const npmCli = process.platform === 'win32'
  ? process.env.npm_execpath || join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
  : null
const result = spawnSync(npmCli ? process.execPath : 'npm', npmCli ? [npmCli, ...npmArgs] : npmArgs, {
  env: {
    ...process.env,
    NODE_AUTH_TOKEN: githubToken,
  },
  stdio: 'inherit',
})

githubToken = ''

if (result.error) {
  console.error(`Unable to run npm: ${result.error.message}`)
  process.exit(1)
}

// Any npm command that resolves the tree rewrites package-lock.json from what
// it laid down on this machine, which on macOS drops the optional entries and
// platform fields only Linux can use. Repair it here, while the command the
// developer ran is still the thing on screen, rather than leaving it to be
// discovered by a red CI run. `npm ci` is exempt: it installs the lockfile
// rather than rewriting it.
const REWRITES_LOCKFILE = new Set(['install', 'i', 'add', 'update', 'up', 'uninstall', 'remove', 'rm', 'dedupe', 'ddp'])
if (result.status === 0 && REWRITES_LOCKFILE.has(npmArgs[0])) {
  const repair = spawnSync(process.execPath, ['scripts/check-lockfile.mjs', '--fix', '--quiet'], { stdio: 'inherit' })
  if (repair.error || repair.status !== 0) process.exit(1)
}

process.exit(result.status ?? 1)
