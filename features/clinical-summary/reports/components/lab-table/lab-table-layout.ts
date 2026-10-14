// Column grammar shared by every row of the lab tab — single results, panel
// headers, panel members and day sections all sit on the SAME tracks, so a
// value's right edge, its unit, its flag and its range line up down the list
// whichever kind of row they belong to. (Previously each row was its own flex
// card: the value hugged whatever followed it, so a long reference range pushed
// it sideways and nested members started from a different edge entirely.)
//
// Four widths per view, chosen by the list's CONTAINER (the left panel is
// resizable, so the viewport says little). Rows stay on one line down to a
// phone-width list; only below that do they fold:
//   narrow  — two lines (flat list < 580px, day view < 440px): name · value ·
//             unit · flag · menu, then range + source
//   compact — one line, the tightest tracks and a 6px gap
//   medium  — one line, tighter fixed tracks
//   wide    — one line, roomier fixed tracks (switched to only once the
//             range would still keep ~230px, so widening never shrinks it)
// The reference range and the source cell are the flexible tracks: 1 : 1 in
// the compact and medium layouts, 1 : 0.7 once wide. The source keeps a floor
// wide enough for a badge, a four-character institution and a two-digit
// month/day date (健 台大醫院 2025/12/19), and both grow with the panel. Everything
// else is fixed. Measured on real 健康存摺 / 雲端病歷
// data (2026-10-14): 90% of analyte names fit 160px; results fit 57px at p95;
// units fit 100px at p99; reference ranges are bimodal — ~70% under 150px and
// the rest age/sex-stratified strings of 1,000–3,000px that no width holds. So
// the name, value, unit and source get the space they need and the range takes
// what is left, on one line, clamped with the full text on hover / tap.
//
// The flat list carries a source cell (institution and date on one line); the
// by-date view moves both to the day header, so it reaches one line sooner.
//
// Tailwind only sees literal class strings, so each variant spells its classes
// out in full instead of composing a breakpoint prefix.

export type LabTableVariant = 'flat' | 'day'

interface LabTableLayout {
  /** Grid tracks for every row (narrow first, then the container queries). */
  grid: string
  /** Column gap — a little tighter until the wide layout. */
  gap: string
  /** Cells that exist only in the one-line layouts (range / source). */
  wideOnly: string
  /** The second line of the two-line layout. */
  narrowOnly: string
  /** Column header row — shown only in the one-line layouts. */
  header: string
  range: string
  /** Institution + date, one line. `hidden` in the day view. */
  meta: string
  /** A panel member has no source of its own (the header carries it), so its
   *  range runs on over the empty source track. */
  rangeToEdge: string
  menu: string
  /** A panel header's title runs over the result / unit / flag tracks. */
  panelTitle: string
  /** The chevron box = lead track + column gap, so the panel name starts on
   *  the same edge as every other row's name. */
  panelChevron: string
}

export const LAB_TABLE_LAYOUT: Record<LabTableVariant, LabTableLayout> = {
  flat: {
    grid: 'grid-cols-[1.25rem_minmax(5.5rem,1fr)_auto_4.5rem_2.25rem_2rem] @min-[580px]:grid-cols-[1rem_6.5rem_4rem_4rem_2rem_minmax(3.5rem,1fr)_minmax(9rem,1fr)_1.5rem] @min-[660px]:grid-cols-[1.25rem_7.5rem_4.25rem_4.5rem_2.25rem_minmax(4.5rem,1fr)_minmax(9.5rem,1fr)_1.75rem] @min-[920px]:grid-cols-[1.5rem_10rem_4.75rem_6.25rem_2.75rem_minmax(6rem,1fr)_minmax(9.5rem,0.7fr)_2rem]',
    gap: 'gap-x-2 @min-[580px]:gap-x-1.5 @min-[660px]:gap-x-2 @min-[920px]:gap-x-2.5',
    wideOnly: 'hidden @min-[580px]:block',
    narrowOnly: '@min-[580px]:hidden',
    header: 'hidden @min-[580px]:grid',
    range: 'col-start-6 row-start-1',
    meta: 'col-start-7 row-start-1',
    rangeToEdge: 'col-end-8',
    menu: 'col-start-6 row-start-1 @min-[580px]:col-start-8',
    panelTitle: 'col-start-1 col-end-6 row-start-1',
    panelChevron: 'w-[1.75rem] @min-[580px]:w-[1.375rem] @min-[660px]:w-[1.75rem] @min-[920px]:w-[2.125rem]',
  },
  day: {
    grid: 'grid-cols-[1.25rem_minmax(5.5rem,1fr)_auto_4.5rem_2.25rem_2rem] @min-[440px]:grid-cols-[1rem_6.5rem_4rem_4rem_2rem_minmax(3.5rem,1fr)_1.5rem] @min-[520px]:grid-cols-[1.25rem_7.5rem_4.25rem_4.5rem_2.25rem_minmax(4.5rem,1fr)_1.75rem] @min-[820px]:grid-cols-[1.5rem_10rem_4.75rem_6.25rem_2.75rem_minmax(6rem,1fr)_2rem]',
    gap: 'gap-x-2 @min-[440px]:gap-x-1.5 @min-[520px]:gap-x-2 @min-[820px]:gap-x-2.5',
    wideOnly: 'hidden @min-[440px]:block',
    narrowOnly: '@min-[440px]:hidden',
    header: 'hidden @min-[440px]:grid',
    range: 'col-start-6 row-start-1',
    meta: 'hidden',
    rangeToEdge: '',
    menu: 'col-start-6 row-start-1 @min-[440px]:col-start-7',
    panelTitle: 'col-start-1 col-end-6 row-start-1',
    panelChevron: 'w-[1.75rem] @min-[440px]:w-[1.375rem] @min-[520px]:w-[1.75rem] @min-[820px]:w-[2.125rem]',
  },
}

/** Row chrome: one divider per row inside the list's single bordered box. */
export const LAB_ROW_BASE = 'grid w-full min-w-0 items-center gap-y-0.5 border-b border-border/70 px-3 py-1.5 text-[0.8125rem] leading-snug'

/** "[0.72–1.18 mg/dL]" → "0.72–1.18 mg/dL". The column already says what the
 *  text is, so the brackets are noise; anything with inner brackets (a doubled
 *  or stratified source string) is left exactly as the source wrote it. */
export function stripRangeBrackets(text: string): string {
  const match = text.match(/^\[([^[\]]*)\]$/)
  return match ? match[1] : text
}
