# MediPrisma Interface Design

## Overview

MediPrisma is a clinical workspace, not an AI showcase or marketing site. It should feel calm, credible, compact, and data-led.

Use this visual hierarchy:

1. Patient context and safety
2. The current clinical task
3. Primary data or interpretation
4. Source, time, and other metadata
5. Branding

Existing CSS variables and shared components are the implementation source of truth. Do not duplicate their numeric values here until the project has a generated token workflow.

## Colors

- Use neutral surfaces for the application shell and routine grouping.
- Use one interaction blue for navigation, focus, links, and the primary action.
- Reserve red, amber, and green for clinical risk, warning, error, success, or verified state.
- Never communicate meaning by color alone.
- Do not use decorative gradients on pages, headings, cards, or controls.
- Do not color card borders by feature or category. Express state with explicit text, a compact badge, an icon, or a restrained background.

## Typography

- Use the existing application font; do not introduce a decorative display font.
- Use sentence case and plain clinical language.
- Establish hierarchy with weight, size, and alignment before adding color or containers.
- Avoid routine UI text below 12px.
- 醫療摘要 reads in three layers, each a rem size with a px floor so the
  clinician phone default (12px root) cannot shrink it: what is read first
  (headline `max(15px,1rem)`, problem `max(14px,0.9375rem)`, finding
  `max(13px,0.875rem)`), evidence and review tags (`max(13px,0.8125rem)`), and
  notes — basis, dates, source chips, section labels (`max(12px,0.75rem)`).
  Save space by removing repetition, not by shrinking a layer.
- Use tabular numbers when scanning laboratories, dates, or counts benefits from alignment.

## Layout and Spacing

- Preserve the split between the clinical summary and the active task panel.
- Use a 4px or 8px spacing rhythm and compact clinical density.
- Align related content to shared edges.
- Prefer sections, rows, lists, and tables for repeated information.
- Use whitespace instead of wrapping every group in a card.
- Keep patient and safety context in stable positions.

## Elevation and Depth

- Use borders, dividers, and surface color for routine hierarchy.
- Use shadows only for dialogs, popovers, dropdowns, and other overlays.
- Do not lift, scale, or deepen routine cards on hover.
- Do not use backdrop blur on the shell or clinical content.

## Shapes

- Use a 6–8px radius for routine containers and controls.
- Use pills only for status, filters, or tokens.
- Use circles only for icon-only controls with an accessible name.
- Keep shape treatment consistent within a view.

## Components

### Clinical Workspace Primitives

Use `src/shared/components/clinical-workspace/` for the application shell:

- `ClinicalWorkspaceRoot`, `ClinicalWorkspaceMain`, and `ClinicalWorkspacePanel` own viewport sizing, density, and phone/desktop panel visibility.
- `ClinicalWorkspaceDivider` and `ClinicalWorkspaceRail` own resizing, collapse, and restore affordances. Keep their callbacks connected to existing behavior.
- `ClinicalMobilePanelSwitcher` owns the phone-level clinical-summary/task switch.
- `ClinicalTabList` and `ClinicalTabTrigger` own the line-selected tab grammar for both left and right panels.
- `ClinicalPatientContext` keeps patient identity visible without turning it into a decorative card.

Features should supply content, labels, icons, and state. They should not recreate the workspace shell or tab styling locally.

### Cards and Sections

- Use a card only for an independent action, safety message, or self-contained module.
- Keep routine cards flat with a visible boundary.
- Do not use thick colored edge strips such as `border-l-4` as card decoration.
- Replace nested cards with headings, dividers, or rows.

### Tabs

- Use tabs for frequent switching between closely related views.
- Keep labels clear and order them by clinical need.
- Use a flat or line-based selected state with one interaction color.
- Do not give each feature a decorative selected color.

### Buttons and Actions

- Use one primary action per region.
- Use explicit action labels.
- Do not add colored shadows, glow, or press-scale effects.
- Use at least a 24px compact target, 32px where space permits, and 44px for touch-oriented views.

### Badges

- Use badges only for state, severity, provenance, or an active filter.
- Show dates, counts, and ordinary categories as metadata text.

### Inputs

- Keep a visible border and clear focus treatment.
- Do not rely on glow alone for focus.
- Use persistent labels and place validation or recovery guidance near the field.

### Icons

- Use icons to reinforce a known action or content type, not to decorate every heading.
- Pair unfamiliar icons with text.
- Do not create colored icon tiles merely for visual variety.

## Responsive Behaviour

- Desktop supports scanning, comparison, and dense information.
- Tablet preserves parallel panels only while both remain readable.
- Mobile shows one primary task at a time without hiding required patient or safety context.
- Use 768px as the current panel-mode boundary: below it, show one panel with a labeled switcher; at and above it, show the split workspace while both panels remain readable.
- Keep at most two persistent navigation levels visible on mobile. Turn additional feature/category navigation into a labeled picker, menu, or content-level scroller.
- Use visible labels for primary mobile navigation. Icon-only controls are reserved for familiar utilities with accessible names.
- Use 44px touch targets for repeated and primary mobile actions.
- Give wide clinical tables one explicit horizontal scroll container, keep the identifying column sticky, and show that more content exists off-screen.
- Do not require hover. Check the on-screen keyboard, safe-area insets, 200% zoom/reflow, long zh-TW and English labels, and phone landscape.

## Accessibility and Safety

- Target WCAG 2.2 AA.
- Preserve keyboard access, visible focus, semantic labels, reduced motion, zoom, and reflow.
- Pair abnormal, destructive, or AI-generated states with explicit wording and a recovery path.

## Do and Don't

Do:

- Make the patient and current task immediately obvious.
- Let real clinical content determine hierarchy.
- Use a restrained palette and shared tokens.
- Verify material changes at multiple viewports and relevant themes.

Don't:

- Use generic AI SaaS patterns such as decorative gradients, glass panels, glow, floating card grids, or decorative pills.
- Add one-off visual values when a shared primitive already expresses the role.
- Elevate metadata over clinical content.
- Modify `features/personalized-education/` unless the user explicitly asks.

## Verification

1. Inspect the current rendered state before changing it.
2. Run relevant tests, lint, and a production build.
3. Inspect 320, 390, 430, 768, 1024, and 1440 CSS-pixel widths where applicable.
4. Check focus, contrast, overflow, loading, empty, and error states.
5. Review a screenshot and remove at least one non-informative decoration when present.
