// ESLint flat config (audit C1).
//
// Two jobs:
//   1. Baseline Next/TypeScript linting (next/core-web-vitals + typescript).
//   2. ARCHITECTURE BOUNDARIES — the layering rules the audit found violated
//      (core importing feature UI) are now machine-enforced. The dependency
//      direction is:
//        core ← shared ← infrastructure ← application ← features ← app
//      core depends on nothing above it and never on React.
//
// Run: npm run lint

import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const config = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "coverage/**",
      ".claude/**",
      "vendor/**",
      "next-env.d.ts",
      // git-ignored scratch (e.g. the lab-category differential's base copy)
      "tmp/**",
    ],
  },

  ...coreWebVitals,
  ...typescript,

  // Pragmatic baseline: the repo predates linting. Anything spammy that tsc
  // already guards (or that needs a dedicated cleanup pass) is downgraded to
  // warn — errors must stay actionable so the CI gate means something.
  {
    // eslint-config-next does not register the React Hooks plugin for CommonJS
    // utility scripts. Keep React-oriented overrides on the source extensions
    // where that plugin is present, so `eslint .` can still lint legacy .cjs.
    files: ["**/*.{js,jsx,mjs,ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off", // ~500 FHIR-shaped anys — separate burn-down (audit C7)
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "react-hooks/exhaustive-deps": "warn",
      "@next/next/no-img-element": "off", // static export — no Image Optimizer
      "@typescript-eslint/no-require-imports": "warn", // deliberate lazy requires in a few hooks/tests
      // React-Compiler-era hooks rules (plugin v6): ~60 pre-existing hits.
      // Real signal, but a dedicated refactor — keep visible as warnings;
      // rules-of-hooks itself stays an error.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
    },
  },
  {
    files: ["**/*.cjs"],
    rules: {
      // CommonJS is the file format contract for these scripts.
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["jest.config.js"],
    rules: {
      // next/jest loads this configuration through CommonJS.
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  // ── Boundary: src/core imports nothing from upper layers, and no React ──
  {
    files: ["src/core/**/*.ts", "src/core/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/features/*"], message: "core must not import from features (audit C3) — register UI by key instead." },
            { group: ["@/src/application/*"], message: "core must not import from application — move the type/logic into core." },
            { group: ["@/src/infrastructure/*"], message: "core must not import concrete infrastructure — depend on a core interface and inject it." },
            { group: ["react", "react-dom", "react/*"], message: "core is UI-free." },
          ],
        },
      ],
    },
  },

  // ── Boundary: src/shared stays below features/application ──
  // (src/shared/config registries are composition roots that intentionally
  //  wire everything — exempted below. src/shared/components is a KNOWN DEBT:
  //  those components consume application providers (i18n, audience, theme)
  //  because the providers live in application — they only get the weaker
  //  no-features rule until the providers move down. The old src/shared/di
  //  container was dead code and has been deleted; the composition root is
  //  now src/application/composition.ts.)
  {
    files: ["src/shared/**/*.ts", "src/shared/**/*.tsx"],
    ignores: ["src/shared/config/**", "src/shared/components/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/features/*"], message: "shared must not import from features — move the helper into shared or invert via registry." },
            { group: ["@/src/application/*"], message: "shared must not import from application." },
          ],
        },
      ],
    },
  },
  {
    files: ["src/shared/components/**/*.tsx", "src/shared/components/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/features/*"], message: "shared components must not import from features — move the component into the feature or app layer instead." },
          ],
        },
      ],
    },
  },

  // ── Boundary: infrastructure must not reach into application/features ──
  {
    files: ["src/infrastructure/**/*.ts", "src/infrastructure/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/features/*"], message: "infrastructure must not import from features." },
            { group: ["@/src/application/*"], message: "infrastructure must not import from application." },
          ],
        },
      ],
    },
  },

  // ── Boundary: application must not import feature UI ──
  {
    files: ["src/application/**/*.ts", "src/application/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/features/*"], message: "application must not import from features — features consume application hooks, not the reverse." },
          ],
        },
      ],
    },
  },

  // ── Boundary: features go through application/core, not raw infrastructure ──
  // KNOWN DEBT below is exempted file-by-file (not by directory) so no NEW
  // feature file can silently take a direct infrastructure dependency:
  //  - medical-chat useAgentChat/useVoiceRecording: deep-mode agent wiring —
  //    slated to move behind a core use-case (audit 2026-07 refactor #3).
  //  - import-bundle useImportBundle + reports useReportImageUrls: local-bundle
  //    persistence IS this feature's job; a facade would only rename it.
  //  - auth useAuthDialog: firebase auth-error mapping.
  //  - clinical-insights sync consumers: Firestore panel sync (post-merge).
  {
    files: ["features/**/*.ts", "features/**/*.tsx"],
    ignores: [
      "features/medical-chat/hooks/useAgentChat.ts",
      "features/medical-chat/hooks/useVoiceRecording.ts",
      "features/import-bundle/hooks/useImportBundle.ts",
      "features/clinical-summary/reports/hooks/useReportImageUrls.ts",
      "features/auth/hooks/useAuthDialog.ts",
      "features/clinical-insights/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/src/infrastructure/*"], message: "features must not import infrastructure directly — go through an application hook / core use-case (composition root: src/application/composition.ts)." },
          ],
        },
      ],
    },
  },
];

export default config;
