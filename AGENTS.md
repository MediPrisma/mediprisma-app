# Repository agent instructions

## Dependency versions and the lockfile

`npm install` on macOS rewrites `package-lock.json` from the tree it just built
here, and that tree has no room for the optional entries and platform fields
only Linux installs — `@emnapi/*`, `react-native`, `libc` on the lightningcss
and oxide builds. They disappear, Linux CI runs `npm ci`, and the build goes
red on a two-line version bump.

- To move a first-party package forward, do not install: `npm run bump:dep -- <package> <version>` edits `package.json` and the one lockfile entry from the registry's own tarball and integrity values. Follow with `npm ci` if `node_modules` needs to match.
- When an install is genuinely needed (adding or removing a package, a changed dependency graph), run it through `npm run packages:install`, which repairs the lockfile straight afterwards.
- `npm run check:lockfile` reports what a rewrite dropped; `npm run fix:lockfile` puts it back. The pre-commit hook runs the check whenever the lockfile is staged, and CI runs it against the previous commit.
- The hook needs `git config core.hooksPath .githooks` once per clone; the `prepare` script does it on `npm install`.
- No npm flag avoids the pruning: `--include=optional`, `--package-lock-only`, and `--install-strategy=nested` each drop the same five entries. Do not go looking for one.

## GitHub authentication checks

- Never conclude that the user's GitHub token is invalid from a sandboxed or network-restricted `gh auth status` failure.
- Check authentication in a network-enabled execution context with `gh auth status -h github.com`.
- Confirm the live identity with the read-only command `gh api user --jq .login` before reporting that authentication is valid or invalid.
- If the network-enabled checks cannot run, report that authentication could not be verified; do not report that the token expired or is invalid.
- Never print, copy, persist, or expose the GitHub token itself.

## Visibility gates

- A change that hides, disables, or removes a clinical surface — a tab, a care
  pack, a card, a switch — for a route, a site, a role, or a sign-in state is
  never a side effect of another change. Ask the owner first, in the chat, with
  the surface and the route named; do not infer it from a neighbouring rule
  such as "this route must stay silent".
- Every commit that touches such a gate carries a `Visible behaviour changes:`
  section listing, one line per surface, what a user on which route can no
  longer see or do — or `Visible behaviour changes: none`.
- The gates in force are listed in `docs/LAUNCH-ROUTE-GATES.md`; update the
  table in the same commit, and test the route where the surface is kept, not
  only the one where it is hidden.

## Someone else's branch, and the machinery that ships it

`pilot/hmc` — in this repository and in `mediprisma-cdss` — is a
collaborator's working branch. They push to it directly, they review their own
clinical work on `https://mediprisma.tw/app-hmc/`, and nothing on it is yours
to tidy.

- Never commit, push, rebase, force-push or delete `pilot/hmc`. Do not
  cherry-pick from it and then "clean up" what you took. Merging `origin/master`
  into it counts as changing it: ask the owner in the chat first, even when the
  merge is a fix they want.
- A pilot author cannot see a failure on their own push before it happens, and
  cannot fix what belongs to this repository. Assume every change you make to
  shared machinery lands on them silently.

The preview's engine is a chain across two repositories, and only its last
link is ours:

```
mediprisma-cdss             main       .github/workflows/relay-hmc-preview.yml
this repository             pilot/hmc  .github/workflows/hmc-build.yml
this repository             master     .github/workflows/hmc-publish.yml
this repository             master     docs/HMC-AI-AGENT-GUIDE.md
```

- Never delete, move, or revert the two on `master` as part of another change,
  and never propose a PR that removes them. A `workflow_run` workflow fires
  only from the default branch, so removing the publisher does not relocate the
  preview — it stops every pilot deployment, with no error anywhere the pilot
  can see. That happened on 2026-09-12 and cost two days.
- The links are coupled in ways no single file shows. `hmc-publish.yml` selects
  its trigger by workflow **name** (`HMC preview build`), and the relay's tag
  must land on a commit that carries the build — when the build moved branches
  on 2026-09-13 the relay kept tagging `master` and the chain went silent. Any
  rename or move on one side is a change to the other two.
- The trap to know: a branch built on `pilot/hmc` history carries that branch's
  **older** copies of these files. Removing them so the PR "only contains the
  product change" reads as correct locally and deletes `master`'s newer version.
  Keep `master`'s copy; if the diff still looks wrong, ask.
- A genuine change to any of the three — a gate, a trigger, a rule in the guide
  — is its own PR, described as affecting the pilot's deployments, and the owner
  decides. Never a side effect.
- Before opening any PR to `master`, check that the diff deletes nothing under
  `.github/workflows/` and no `docs/HMC-*` file: `git diff --diff-filter=D
  --name-only origin/master...HEAD`.

## UI design guidance

- Before creating, changing, or reviewing rendered UI, read the repository root `DESIGN.md`.
- Use the repository skill in `.agents/skills/design-mediprisma-ui/`.
- For a disease's at-a-glance CDSS view (status board), use `.agents/skills/cdss-status-board/`.
- Prefer existing tokens and shared primitives over one-off values.
- Verify material UI changes with relevant tests, lint, a production build, and real browser checks.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
