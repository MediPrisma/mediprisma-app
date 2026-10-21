// Jest Configuration
const nextJest = require('next/jest')

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
})

// Add any custom config to be passed to Jest
const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup.ts'],
  testEnvironment: 'jest-environment-jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/__tests__/**/*.test.tsx',
  ],
  // react-markdown and its unified/remark/micromark dependency tree are
  // ESM-only, so jest must transform them instead of ignoring node_modules —
  // otherwise any suite that renders MarkdownRenderer for real dies on
  // "Unexpected token 'export'".
  transformIgnorePatterns: [
    '/node_modules/(?!(' + [
      'react-markdown',
      'remark-.*',
      'rehype-.*',
      'mdast-util-.*',
      'micromark.*',
      'hast-util-.*',
      'unist-util-.*',
      'unified',
      'vfile.*',
      'bail',
      'ccount',
      'character-entities.*',
      'comma-separated-tokens',
      'decode-named-character-reference',
      'devlop',
      'escape-string-regexp',
      'estree-util-is-identifier-name',
      'html-url-attributes',
      'is-plain-obj',
      'longest-streak',
      'markdown-table',
      'property-information',
      'space-separated-tokens',
      'stringify-entities',
      'trim-lines',
      'trough',
      'web-namespaces',
      'zwitch',
      '@ungap/structured-clone',
    ].join('|') + ')/)',
    '^.+\\.module\\.(css|sass|scss)$',
  ],
  // Without this, stale copies under .claude/worktrees/ get picked up and fail the run
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/.claude/',
    '<rootDir>/out/',
    '<rootDir>/coverage/',
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    'features/**/*.{ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/.next/**',
    '!**/coverage/**',
    '!**/dist/**',
  ],
  // Ratchet: floors sit just below current coverage (~25% lines, 2026-06) so the
  // gate fails on regressions; raise them as coverage grows toward the 70% goal.
  coverageThreshold: {
    global: {
      branches: 18,
      functions: 21,
      lines: 23,
      statements: 23,
    },
  },
}

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async.
// next/jest overwrites transformIgnorePatterns with its own list, so ours has to
// be re-applied on the resolved config (documented Next.js workaround).
module.exports = async () => {
  const config = await createJestConfig(customJestConfig)()
  const { optionalBuildConfig } = await import('./scripts/optional-build-config.mjs')
  const optional = optionalBuildConfig(__dirname)
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  config.moduleNameMapper = {
    ...Object.fromEntries(Object.entries(optional.aliases).map(([name, file]) => [`^${escape(name)}$`, `<rootDir>/${file}`])),
    ...config.moduleNameMapper,
  }
  config.transformIgnorePatterns = customJestConfig.transformIgnorePatterns
  return config
}
