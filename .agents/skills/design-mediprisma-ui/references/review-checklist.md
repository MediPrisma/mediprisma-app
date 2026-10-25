# MediPrisma UI Review Checklist

## Hierarchy

- Can a clinician identify the patient, current task, and primary action without scanning decorative content?
- Does size, weight, spacing, and alignment establish hierarchy before color or containers?
- Are metadata and provenance visually subordinate but still available?

## Anti-template Check

- Remove decorative gradients, glass effects, glow, hover lift, and colored icon tiles that do not encode meaning.
- Remove thick colored card edges or accent stripes; use labels, badges, icons, or restrained backgrounds for meaningful states.
- Question every card, rounded corner, pill, icon, badge, and shadow.
- Keep at most one prominent brand expression in a view.
- Remove slogans, routine reminders, and repeated explanations of normal behavior. Does each remaining message change the next action or interpretation? Keep essential safety, missing-data, error, and sign-in guidance concise and contextual; preserve accessible labels and on-demand source details.
- Let real clinical content determine the layout rather than filling a generic dashboard grid.

## Components

- Use one primary action per region.
- Keep functional colors consistent across controls and states.
- Give tabs clear labels, stable order, and one selected-state treatment.
- Use badges only for state, severity, provenance, or an active filter.
- Pair unfamiliar icons with labels and provide adequate targets.
- Give inputs persistent labels, visible focus, and nearby recovery guidance.

## Accessibility

- Meet WCAG 2.2 AA contrast: 4.5:1 for normal text and 3:1 for large text and UI components.
- Preserve keyboard order, semantic names, and visible focus.
- Respect reduced-motion preferences.
- Prefer 44px touch targets; never use targets below 24px without adequate spacing.
- Never communicate a clinical or interaction state by color alone.

## Responsive and State Coverage

- Inspect 320, 390, 430, 768, 1024, and 1440 CSS-pixel widths when the changed surface can appear there.
- Inspect phone portrait, phone landscape, and tablet portrait when navigation or panel behavior changes.
- Mobile presents one primary task at a time; it does not preserve desktop columns by shrinking them.
- Keep at most two persistent navigation levels visible. Replace a third level with a labeled picker or overflow menu.
- Touch targets are at least 44px for primary and repeated mobile actions.
- Primary mobile navigation uses visible labels; icons may reinforce labels but do not replace them.
- No action, explanation, or state is available only through hover.
- One element owns horizontal scrolling in each region. Wide clinical tables keep the identifying column sticky and expose an overflow cue.
- Check safe-area padding, the on-screen keyboard, 200% zoom/reflow, long zh-TW and English strings, and dynamic text wrapping.
- Inspect light and dark themes when shared styles change.
- Check loading, empty, error, disabled, selected, hover, and focus states.
- Check long localized text, zoom, wrapping, and horizontal overflow.

## Implementation and Verification

- Reuse shared tokens and components before adding local values.
- Do not let a global change alter excluded work without explicit approval.
- Run relevant tests, lint, and a production build.
- Compare before-and-after screenshots using the same viewport, data, theme, and scroll position.

## Reference Influences

- Anthropic frontend-design: ground decisions in subject matter and critique both plan and result.
- Vercel Web Interface Guidelines: audit accessibility, interaction, forms, typography, responsive behavior, and performance.
- Wshobson responsive-design: use mobile-first layout decisions, fluid composition, and container-aware behavior.
- Addy Osmani frontend-ui-engineering: reject generic AI defaults and verify production UI across real breakpoints.
- Google Labs `DESIGN.md`: keep a repository-level design contract that agents and humans can both read.
