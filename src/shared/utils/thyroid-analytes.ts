// Thyroid autoantibody and thyroglobulin LOINCs for the 內分泌 panel. Every code
// was verified on 2026-10-09 against tx.fhir.org (LOINC 2.82) and the NLM
// Clinical Table Search LOINC index; LONG_COMMON_NAME quoted in the comment.
//
// The panel used to list '8099-6' and '8100-2'. Neither exists in LOINC (both
// fail the Mod-10 check digit; tx.fhir.org: not found), so a real anti-TPO or
// anti-Tg row never reached 內分泌 by its LOINC. (8100-0, the check-digit
// "correction" of 8100-2, is Specimen preparation — not anti-Tg.)
//
// clinical-lab-normalization maps none of these, so the column comes from here.
// Anti-Tg and thyroglobulin are different tests and keep different columns; a
// thyroglobulin row named "Tg" would otherwise collide with triglyceride.

/** Thyroid analyte LOINC → canonical column key. */
export const THYROID_LOINC_TO_KEY: Readonly<Record<string, string>> = {
  '8099-4': 'ANTI-TPO',       // Thyroperoxidase Ab [Units/volume] in Serum or Plasma
  '32042-4': 'ANTI-TPO',      // Thyroperoxidase Ab [Presence] in Serum or Plasma
  '56477-3': 'ANTI-TPO',      // Thyroperoxidase Ab [Units/volume] in Serum or Plasma by Immunoassay
  '32786-6': 'ANTI-TPO',      // Thyroperoxidase Ab [Titer] in Serum or Plasma
  '8098-6': 'ANTI-TG',        // Thyroglobulin Ab [Units/volume] in Serum or Plasma
  '3013-0': 'THYROGLOBULIN',  // Thyroglobulin [Mass/volume] in Serum or Plasma
}

/** Column header for each thyroid key above (same text in zh-TW and en). */
export const THYROID_DISPLAY: Readonly<Record<string, string>> = {
  'ANTI-TPO': 'Anti-TPO',
  'ANTI-TG': 'Anti-Tg',
  THYROGLOBULIN: 'Thyroglobulin',
}

/** LOINC Scale of each thyroid LOINC above (same sources). */
export const THYROID_LOINC_SCALE: Readonly<Record<string, 'Qn' | 'Ord' | 'Titr'>> = {
  '8099-4': 'Qn',
  '32042-4': 'Ord',
  '56477-3': 'Qn',
  '32786-6': 'Titr',
  '8098-6': 'Qn',
  '3013-0': 'Qn',
}
