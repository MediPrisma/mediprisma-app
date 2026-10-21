# Hospital ingredients in CDSS

The live feature uses `utils/hospital-medication-profile.ts` to supply the same
exact recorded-name catalogue as the medication pane. It supplies only derived
ingredient evidence: no NHI/ATC code, official-master snapshot, product identity,
strength-to-dose conversion, or fill grouping is manufactured. Official NHI
terminology takes priority. Unresolved or contradictory aliases stay unresolved.

Imported FHIR, original status and dosage remain intact. Derived facts and AF
regimens cite the original resource type/id, coding, date and status. Catalogue
version, mapping origin and verified alias reference remain available. The profile
contains minimal citations and class IDs, never duplicate raw resources. No new
patient-data transmission, logging or automatic persistence is introduced.

## Use-state policy

The policy is limited to VGH generic/product coding systems, including unresolved
names. It preserves national-cloud interpretation.

| Hospital source record | Use-state interpretation | Exposure checks |
| --- | --- | --- |
| Active, nonfuture MedicationStatement | Confirmed current use | Native checks |
| Active/unknown/missing-status MedicationRequest | Actual use unconfirmed | Possible exposure retained |
| Above record with expired dispensing validity | Historical order; actual use unconfirmed | Possible exposure retained |
| Draft / intended | Actual use unconfirmed | Excluded from current/possible exposure |
| On hold | On hold | Native held-record handling |
| Stopped, completed, not taken | Not current | Excluded from current/possible exposure |
| Cancelled, entered in error | Excluded | Excluded |
| Future active statement | Unconfirmed | Reconcile source; cannot confirm actual use |

FHIR `dispenseRequest.validityPeriod` defines when dispensing is permitted, not
when the patient takes the drug. An in-date window or recent expected supply
cannot confirm actual use. See the [FHIR R4 definition](https://hl7.org/fhir/R4/medicationrequest-definitions.html#MedicationRequest.dispenseRequest.validityPeriod).

The therapy/use-state pass suppresses the cloud adapter's automatic promotion of
hospital active orders and recently completed supplies. Internal noncurrent
markers are restored in every emitted citation and prescribing timeline, including
identical names/dates. A confirmed same-class NHI record or MedicationStatement
still establishes current use. Confirmed insulin/SU evidence is preserved when the
other class has a pending hospital order; their shared fact must not be overwritten.

## Possible exposure and treatment decisions

An unconfirmed order must not disappear from safety derivations. A second native
FHIR pass retains possible exposure from pending hospital records; it excludes
ended/cancelled records. Only medication exposure facts and AF regimens are used:
`currentNsaid`, `currentPotentialHfWorseningMedication`, potassium/renal risks,
DOAC/VKA/OAC, antiplatelets, the medication overview, and HF harmful-drug evidence.
Pending facts are labelled as unconfirmed hospital exposure, and all sources retain
the original status. Other diagnosis or therapy facts are not copied from that pass.

`buildHospitalAwareCdssResult` is the single pack-evaluation seam for selected packs,
English output and companions. Its evaluation-only profile treats the native
classifier's recognized pending classes as possible exposure, so safety checks
that require a positive class state (notably MRA hyperkalemia) remain evaluable.
The source profile and reconciliation panel keep actual use explicitly unconfirmed.
Physician-entered observations, answers and overrides are applied to this live
profile, rather than reading a stale prebuilt safety result. No clinical threshold,
interaction or dose rule is reimplemented in the host.

The result adapter preserves native actionable/review safety status, priority,
instructions, positive evidence and physician overrides. Possible NSAID exposure,
MRA hyperkalemia and AF drug interactions therefore remain visible. Unconfirmed
prescriptions cannot yield a negative OAC finding. Start/titrate decisions become
reconciliation requests; their derived visit actions are retired. Safety modules
keep their warnings but do not offer prescribe/dose-adjust visit actions based only
on unconfirmed use. Chinese and English use the same policy.

The decision map reads any AF anticoagulant regimen as a settled decision
(「已抗凝」, DP-07 已定, CHA₂DS₂-VA 「已在用」). When every anticoagulant on the
profile comes from an unconfirmed hospital prescription, the profile names it
(`hospitalMedicationUnconfirmedAnticoagulation`) and `buildVisitModel` keeps AF's
「要不要抗凝」 point — on the AF page, and where the heart-failure page folds it —
in the pack's own 待核對 form: `info`, the order's agent and dose as information
(「apixaban 5 mg bid：使用待核對」), 核對目前用藥 as missing data, no action, and the
CHA₂DS₂-VA verdict 「· 院內處方待核對」 marked pending. The regimen stays on the
profile for interaction, dose and bleeding checks, so the map never reads 「未用抗凝」
and offers no second anticoagulant. A confirmed MedicationStatement or NHI record
still settles the point as before.

## Incomplete inventory scope

One active/unconfirmed hospital ingredient outside the exact-name catalogue makes
otherwise `not-found` classes `uncertain`; confirmed-current and held classes stay
intact. Negative medication evidence rows also become unknown, including AF's OAC
row (which has no class context). This deliberately broad completeness policy can
make many medication modules request reconciliation from a single unresolved
record. Native positive exposure evidence still supports safety warnings even when
the display catalogue cannot normalize that name. Unknown ingredients do not imply
no exposure, nor a complete interaction screen.

The shared panel lists pending records, dates and ingredient provenance across
layouts. Actual use confirmation requires a source MedicationStatement/current-
medication update. No new confirmation control, automatic stop inference, clinical
rule or route/care-pack visibility gate is introduced.

Validation uses fictional AF apixaban orders, severe MRA hyperkalemia, interactions,
NSAID/potassium/renal/antiplatelet exposure facts, unknown ingredients, ended records,
shared insulin/SU evidence, live physician potassium edits, source provenance,
national-cloud equivalence, live wiring, browser imports and responsive checks.
