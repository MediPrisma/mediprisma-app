// Column grammar shared by every row of the lab tab — single results, panel
// headers, panel members and day sections all sit on the SAME tracks, so a
// value's right edge, its unit, its flag and its range line up down the list
// whichever kind of row they belong to. (Previously each row was its own flex
// card: the value hugged whatever followed it, so a long reference range pushed
// it sideways and nested members started from a different edge entirely.)
//
// Two widths per view, chosen by the list's CONTAINER (the left panel is
// resizable, so the viewport says little):
//   narrow  — two lines: name · value · unit · flag · menu, then range + source
//   wide    — one line with a column per field and a header row above
// The flat list carries source and date columns; the by-date view moves both to
// the day header, so it reaches the one-line layout at a smaller width.
//
// The name keeps a floor in both layouts, so a long text result wraps in the
// space left over instead of squeezing the analyte name away. In the one-line
// layout the name and the reference range share what is left 3 : 2 — the name
// is what a clinician scans for, so a stratified range clamps first (full text
// on hover), not the name.
//
// Tailwind only sees literal class strings, so each variant spells its classes
// out in full instead of composing a breakpoint prefix.

export type LabTableVariant = 'flat' | 'day'

interface LabTableLayout {
  /** Grid tracks for every row (narrow first, wide behind the container query). */
  grid: string
  /** Cells that exist only in the one-line layout (range / source / date). */
  wideOnly: string
  /** The second line of the two-line layout. */
  narrowOnly: string
  /** Column header row — shown only in the one-line layout. */
  header: string
  range: string
  source: string
  date: string
  menu: string
}

export const LAB_TABLE_LAYOUT: Record<LabTableVariant, LabTableLayout> = {
  flat: {
    grid: 'grid-cols-[1.25rem_minmax(5.5rem,1fr)_auto_4.5rem_2.25rem_2rem] @min-[820px]:grid-cols-[1.5rem_minmax(10rem,3fr)_4.75rem_5.25rem_2.75rem_minmax(7rem,2fr)_7rem_5.75rem_2rem]',
    wideOnly: 'hidden @min-[820px]:block',
    narrowOnly: '@min-[820px]:hidden',
    header: 'hidden @min-[820px]:grid',
    range: 'col-start-6 row-start-1',
    source: 'col-start-7 row-start-1',
    date: 'col-start-8 row-start-1',
    menu: 'col-start-6 row-start-1 @min-[820px]:col-start-9',
  },
  day: {
    grid: 'grid-cols-[1.25rem_minmax(5.5rem,1fr)_auto_4.5rem_2.25rem_2rem] @min-[600px]:grid-cols-[1.5rem_minmax(10rem,3fr)_4.75rem_5.25rem_2.75rem_minmax(7rem,2fr)_2rem]',
    wideOnly: 'hidden @min-[600px]:block',
    narrowOnly: '@min-[600px]:hidden',
    header: 'hidden @min-[600px]:grid',
    range: 'col-start-6 row-start-1',
    source: 'hidden',
    date: 'hidden',
    menu: 'col-start-6 row-start-1 @min-[600px]:col-start-7',
  },
}

/** Row chrome: one divider per row inside the list's single bordered box. */
export const LAB_ROW_BASE = 'grid w-full min-w-0 items-center gap-x-2.5 gap-y-0.5 border-b border-border/70 px-3 py-1.5 text-[0.8125rem] leading-snug'

/** "[0.72–1.18 mg/dL]" → "0.72–1.18 mg/dL". The column already says what the
 *  text is, so the brackets are noise; anything with inner brackets (a doubled
 *  or stratified source string) is left exactly as the source wrote it. */
export function stripRangeBrackets(text: string): string {
  const match = text.match(/^\[([^[\]]*)\]$/)
  return match ? match[1] : text
}
