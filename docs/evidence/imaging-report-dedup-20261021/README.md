# Imaging report copy grouping evidence

All records, report text, identifiers and viewer responses in these screenshots are synthetic. No patient export or authenticated NHI response is included.

Before: `af0bfe42c50ecba16b62a58a35ba4808c79b472e` (PR base).
After application code: `a628c580c8d9db89cd6f6e90b918d310b43aaa11` (latest master integrated). The following evidence-only commit does not change application code.

Both isolated checkouts ran `e2e/tests/reports-cross-source-imaging.spec.ts` with the same generated bundle, locale, light theme, collapsed report rows, search and viewport. Before uses `IMAGING_BEFORE=1`; assertions expect eight rows before and four groups after. Six widths passed: 320, 390, 430, 768, 1024 and 1440 CSS pixels, height 1000.

| Before | After |
| --- | --- |
| ![Desktop before: eight reports](before-1440.png) | ![Desktop after: four report groups](after-1440.png) |
| ![Phone before](before-390.png) | ![Phone after](after-390.png) |

[Original source narratives and IDs](after-sources.png) remain available. [Viewer result](after-viewer.png) uses an intercepted synthetic HTTPS page and a simulated NHI extension bridge. The actual application request retains `SYNTHETIC-0` and its synthetic patient context hash. This verifies application wiring, not an authenticated live NHI session.

The regression suite executes production grouping and UI/AI paths, including conflicting body text, side/anatomy/modality/contrast/view, dates/times, patient/facility/status/identifiers, repeated exams, incomplete attachments, structured results, filtered views, existing shared procedure groups and echo exclusions. Uncertain evidence stays separate; source FHIR resources are never deleted.
