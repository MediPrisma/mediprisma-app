# Imaging report copy grouping evidence

All records, report text, identifiers and viewer responses in these screenshots are synthetic. No patient export or authenticated NHI response is included.

Before: `af0bfe42c50ecba16b62a58a35ba4808c79b472e` (PR base).
After application code: `b65d1dd4ae10fd880c0f7719c8086df17e11179c` (latest master integrated; study/clinical-notation boundaries and per-source history corrected). The following evidence/test-only commit does not change application code.

Both isolated checkouts ran `e2e/tests/reports-cross-source-imaging.spec.ts` with the same generated bundle, locale, light theme, collapsed report rows, search and viewport. Before uses `IMAGING_BEFORE=1`; assertions expect eight rows before and four groups after. Six widths passed: 320, 390, 430, 768, 1024 and 1440 CSS pixels, height 1000.

One prior NHI report remains outside the search, so the filtered display is 8/9 before and 4/5 after. Searching the NHI breast-ultrasound title still finds the merged row. Each original title has its own history action; opening the NHI source history displays its prior report without inferring aliases across body parts.

| Before | After |
| --- | --- |
| ![Desktop before: eight reports](before-1440.png) | ![Desktop after: four report groups](after-1440.png) |
| ![Phone before](before-390.png) | ![Phone after](after-390.png) |

[Original source narratives and IDs](after-sources.png) remain available. [Viewer result](after-viewer.png) uses an intercepted synthetic HTTPS page and a simulated NHI extension bridge. The actual application request retains `SYNTHETIC-0` and its synthetic patient context hash. This verifies application wiring, not an authenticated live NHI session.

The regression suite executes production grouping and UI/AI paths, including conflicting body text, side/anatomy/modality/contrast/view, dates/times, patient/facility/status/identifiers, repeated exams, incomplete attachments, structured results, filtered views, existing shared procedure groups and echo exclusions. Uncertain evidence stays separate; source FHIR resources are never deleted.

Study-linked reports (including unresolved, identifier-only and same-reference links) stay outside automatic cross-source pairing until study identity is verified. Clinical superscripts, subscripts, micro symbols and unit case remain distinct; only full-width ASCII formatting and whitespace are folded.

Additional integration check: `merged-fhir-download.spec.ts` passed. `original-fhir-download.spec.ts` timed out at the popup's Copy tab (line 78 → line 31), both on the unmodified base and on the PR. This existing popup-layout test limitation is recorded separately from the passing imaging regression.
