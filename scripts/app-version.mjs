// App version = the date (Asia/Taipei) of the commit being built, as
// `YYYY.M.D` — e.g. 2026.11.11.
//
// Every merge to master deploys, so a hand-bumped semver stopped moving.
// The commit date needs no bump commit, sorts correctly, and still fits the
// Collector's three-number `app_version` format. Builds from the same day
// share a version; `build_revision` (the commit hash) tells them apart.
//
// Without git (source tarball, no .git) it falls back to package.json.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const taipeiDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: 'numeric', day: 'numeric',
})

export function dateVersion(epochSeconds) {
  const parts = Object.fromEntries(taipeiDate.formatToParts(new Date(epochSeconds * 1000)).map(p => [p.type, p.value]))
  return `${parts.year}.${parts.month}.${parts.day}`
}

function commitEpochSeconds(repoRoot) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%ct'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return /^\d+$/.test(out) ? Number(out) : null
  } catch {
    return null
  }
}

export function resolveAppVersion(repoRoot, commitEpoch = commitEpochSeconds(repoRoot)) {
  if (commitEpoch !== null) return dateVersion(commitEpoch)
  return JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version
}

// public/version.json is what the running app fetches (useAppVersion). It is
// generated, not committed. Next loads its config in several processes, so
// write through a temporary file and skip the write when nothing changed.
export function writeVersionFile(repoRoot, version) {
  const file = join(repoRoot, 'public', 'version.json')
  const content = JSON.stringify({ version }, null, 2) + '\n'
  try { if (readFileSync(file, 'utf8') === content) return } catch {}
  const temporary = `${file}.${process.pid}.tmp`
  try {
    writeFileSync(temporary, content, 'utf8')
    renameSync(temporary, file)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}
