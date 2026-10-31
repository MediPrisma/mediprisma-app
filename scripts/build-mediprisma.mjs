#!/usr/bin/env node
// Build the static-export artifact for the official mirror at
// mediprisma.tw/app (basePath "/app").
//
// Same idea as build-gh.mjs: static export (`output: "export"`) cannot live
// with API routes, so we temporarily move /app/api/ out of the tree, run the
// build, then restore it. The only difference from the GH Pages build is the
// base path, driven by DEPLOY_BASE_PATH (see next.config.ts).
//
// Output: ./out  — copy it into the docs site at static/app/ (see the docs
// repo's scripts/sync-app.mjs).
import { execSync } from 'node:child_process'
import { existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'

// /app is production; the staging channel builds the same tree for /app-staging.
const BASE_PATH = process.env.MEDIPRISMA_BASE_PATH || '/app'
if (!['/app', '/app-staging'].includes(BASE_PATH)) throw new Error(`Unsupported MEDIPRISMA_BASE_PATH ${BASE_PATH}`)

const repoRoot = process.cwd()
const API_DIR = join(repoRoot, 'app', 'api')
const STASH_DIR = join(repoRoot, '.api-stash-mediprisma-build')

// Recover from an interrupted previous run.
if (existsSync(STASH_DIR) && !existsSync(API_DIR)) {
  console.log('• found leftover stash from a previous interrupted build — restoring first')
  renameSync(STASH_DIR, API_DIR)
}

let stashed = false
if (existsSync(API_DIR)) {
  console.log('• stashing app/api/ for static export build')
  renameSync(API_DIR, STASH_DIR)
  stashed = true
}

try {
  console.log(`• building static export with basePath ${BASE_PATH}`)
  execSync('next build', {
    stdio: 'inherit',
    env: {
      ...process.env,
      DEPLOY_BASE_PATH: BASE_PATH,
    },
  })
} finally {
  if (stashed) {
    console.log('• restoring app/api/')
    renameSync(STASH_DIR, API_DIR)
  }
}
