// ICD is diagnostic metadata, not an alert. No chip colour: the monospace code
// is recognisable on its own, and the diagnosis text reads as plain content.
export const clinicalIcdToneClass =
  "border border-transparent transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"

export const clinicalIcdCodeToneClass =
  "text-muted-foreground"

export const clinicalIcdDescriptionToneClass =
  "text-foreground/85"

export const clinicalIcdChipClass =
  `inline-flex h-5 min-w-0 max-w-[16rem] items-center gap-1.5 rounded-md px-1 py-0 text-xs ${clinicalIcdToneClass}`

export const clinicalIcdCodeClass =
  `shrink-0 font-mono font-medium ${clinicalIcdCodeToneClass}`

export const clinicalIcdDescriptionClass =
  `min-w-0 truncate ${clinicalIcdDescriptionToneClass}`

// Clinical hover cards use the same quiet themed surface in both modes. The
// descendant selector also recolours Radix's nested arrow SVG, avoiding a
// black arrow attached to an otherwise themed tooltip.
export const clinicalTooltipSurfaceClass =
  "border border-border bg-popover text-popover-foreground shadow-md [&_svg]:bg-popover! [&_svg]:fill-popover!"

// Sits directly beside an h-5 ICD chip, so it stays that chip's sibling in
// height — an earlier 36px square turned the whole diagnosis line into a tall,
// uneven strip. Padding cannot separate ink from target here (border and
// background paint on the padding box), so the finger area comes from an
// invisible ::before that reaches past the line. That only works because the
// collapsed diagnosis row now clips on x with `overflow-x-clip` instead of
// `overflow-hidden`: hidden would force the y axis to auto and swallow it.
export const clinicalIcdMoreButtonClass =
  "relative inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md border border-transparent bg-transparent px-1.5 py-0 text-[0.6875rem] max-md:min-w-[2.75rem] max-md:px-2 max-md:before:absolute max-md:before:inset-x-0 max-md:before:-inset-y-[9px] max-md:before:content-[''] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
