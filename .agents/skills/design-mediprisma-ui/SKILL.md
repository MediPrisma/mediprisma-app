---
name: design-mediprisma-ui
description: Design, implement, or review MediPrisma UI as a calm, credible, data-led clinical workspace. Use for changes to React or Next.js pages, Tailwind or CSS styling, design tokens, shared UI components, responsive layouts, accessibility, visual hierarchy, or requests to reduce generic AI or SaaS aesthetics in this repository.
---

# Design MediPrisma UI

Apply the repository's clinical visual language while preserving functionality and excluded work.

## Workflow

1. Read the repository root `DESIGN.md`.
2. For a material UI design or review, read `references/review-checklist.md`.
3. Inspect `git status` and the current rendered interface. Preserve user changes.
4. State the user, task, and information hierarchy in one sentence using real content.
5. Choose the smallest coherent scope:
   - Make a global change only when the rule is truly global.
   - Keep a change local when an excluded or unrelated feature could be affected.
   - Preserve data, accessibility, and responsive behavior.
6. Critique the plan. Remove choices that resemble a generic AI dashboard.
7. Implement with existing primitives and tokens. Add a value only when it has a reusable semantic role.
8. Run relevant tests, lint, and a production build.
9. Inspect screenshots at 320, 390, 430, 768, 1024, and 1440 CSS pixels when the affected surface can appear at those widths. Check portrait and landscape at the mobile/tablet boundary, and light and dark themes when shared styles change.
10. Critique the result and remove at least one non-communicative decoration when present.
11. Report changed surfaces, verification, and intentional exceptions.

## Decision Rules

- Put patient identity, clinical safety, and the current task ahead of branding.
- Default to minimal copy: avoid slogans, explanatory banners, and repeated routine reminders. Do not annotate every report with normal grouping behavior. Keep details available on demand; retain only concise, actionable messages that affect operation or clinical interpretation, plus accessible control labels.
- Use neutral surfaces and one interaction color. Reserve semantic colors for meaning.
- Never identify a feature with a thick colored card border or accent stripe.
- Prefer sections, rows, lists, and tables over repeated cards.
- Reserve elevation for overlays.
- Use explicit labels and visible focus states.
- Design mobile as a single-task view, not as a scaled-down two-column desktop.
- Keep no more than two persistent navigation levels visible on mobile. Turn a third level into a labeled picker, overflow menu, or in-content navigation.
- Give touch-oriented controls a 44px target. Do not rely on hover, tiny switches, or icon-only navigation for primary tasks.
- Assign horizontal scrolling to one explicit owner per region. Keep identifying columns sticky in wide clinical tables and leave a visible overflow cue.
- Check safe-area insets, the on-screen keyboard, 200% zoom/reflow, long zh-TW and English labels, and portrait/landscape changes.
- Do not modify `features/personalized-education/` unless the user explicitly includes it.
- Follow explicit user direction when it conflicts with this skill, and identify any temporary design-system exception.

## Review Output

Lead with actionable findings and exact file references.

- Treat safety, accessibility, broken functionality, misleading hierarchy, and responsive failures as blockers.
- Treat consistency, density, typography, and unnecessary decoration as improvements.
