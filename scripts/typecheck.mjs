import { spawnSync } from 'node:child_process'
import { optionalBuildConfig, writeOptionalBuildTsconfig } from './optional-build-config.mjs'
const root = process.cwd()
const optional = optionalBuildConfig(root)
const config = Object.keys(optional.aliases).length ? writeOptionalBuildTsconfig(root, optional) : 'tsconfig.json'
const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '-p', config], { stdio: 'inherit' })
if (result.error) console.error(result.error.message)
process.exit(result.status ?? 1)
