# NHI-FHIR-Bridge SDK JSON browser artifact

This directory contains the browser-only bundle generated from
`@nhi-fhir-bridge/sdk-json/browser` in the sibling NHI-FHIR-BRIDGE repository.
It is checked in so the static MediPrisma build can convert a Health Bank SDK
JSON file locally without a server, a package-registry dependency, or runtime
network access.

The source of truth remains NHI-FHIR-BRIDGE. Regenerate `browser.js` there with
`npm run build:browser --workspace @nhi-fhir-bridge/sdk-json`, then update this
artifact and its declaration together.

Vendored package version: `0.1.5`.

The artifact intentionally excludes the SDK CLI and fixture helpers, which use
Node.js file-system and crypto APIs.

## App Worker compatibility patch

This copy of v0.1.5 uses `globalThis.window` in js-sha1's environment probe.
Next.js folds a bare `typeof window` to `"object"` in client chunks, including
the module imported by the local-conversion Worker. That would turn the
following conditional access into an unconditional reference to the absent
`window` and prevent even standard FHIR files from loading the converter.
The qualified property preserves the real environment check in browser and
Worker scopes. Conversion rules, resource IDs and the public declarations are
unchanged.

When regenerating upstream, add `window: "globalThis.window"` to the esbuild
`define` options in `scripts/build-sdk-browser.mjs` before copying the output.
Keep the Node environment regression in `sdk-worker-module.test.ts` and run
the production import profile; the development server bypasses this Worker.
