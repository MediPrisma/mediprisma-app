#!/usr/bin/env node
import { createRequire } from 'node:module'
import { checkDeploymentEnv } from './deployment-env.mjs'

// Use the env loader shipped with the installed Next version. No new dependency
// or second dotenv parser: shell > .env.production.local > .env.local >
// .env.production > .env, including Next's variable expansion rules.
process.env.NODE_ENV ||= 'production'
let loadFailed = false
let envReadFailed = false
try {
  const require = createRequire(import.meta.url)
  const nextRequire = createRequire(require.resolve('next/package.json'))
  nextRequire('@next/env').loadEnvConfig(process.cwd(), false, {
    info() {},
    // Next skips unreadable env files after logging. Do not turn that into a
    // fatal error for existing builds that have not selected this profile.
    error() { envReadFailed = true },
  })
} catch { loadFailed = true }
if (loadFailed) {
  console.error('[deployment] Could not load build environment. Check installed Next dependencies and env files locally; values are not printed.')
  process.exit(1)
}
const result = checkDeploymentEnv(process.env)
if (result.enabled) {
  if (envReadFailed) {
    console.error('[deployment] Could not read a build env file. Check file permissions locally; values are not printed.')
    process.exit(1)
  }
  for (const note of result.notes) console.log(`[deployment] ${note}`)
  for (const error of result.errors) console.error(`[deployment] ${error}`)
  if (result.errors.length) process.exit(1)
  console.log('[deployment] Hospital configuration syntax passed. VM, TLS, authorization and storage acceptance are still required.')
}
