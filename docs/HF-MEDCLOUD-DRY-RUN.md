# HF imported-record calculator integration

Scope: the two outpatient claims P1_CD_mortality_1m and P1_CD_mortality_3m.
Manual input checks and a separate manual prediction action are implemented. No automatic clinical upload, result persistence or clinical database write is introduced.

## Clinical meaning

The upstream service is a research pilot without a medical device license. Its outcome is death within 1 or 3 months after the index outpatient visit (owner correction, 2026-10-07: not in-hospital death). Deaths are ascertained from TVGH records, so deaths outside TVGH may be missed. Applicability to medcloud2 and other institutions remains unvalidated. Results require physician interpretation and cannot be the sole basis for treatment.

An accepted input check is not a risk result and does not establish complete history. Missing labs and coverage warnings remain visible. A 422 refusal says unable to assess, never low risk. Prediction shows the returned calibrated probability, risk tier, notes, index date and model horizon. Optional observed incidence is labelled a group rate, not individual probability. Model name, versions, calibration, model/manifest hashes, computation time, adapter version and matching request ID remain available with the result. Three-month model hashes can be a two-member m1/m2 ensemble.

## Browser data path

The calculator reads the original tab-scoped LocalBundleService Bundle only after an explicit preparation action, only in local-import mode and for a single-patient supported bridge source. SMART mode never falls back to a leftover local Bundle. Demographic overlays are not used.

For cloud records, choose a dated AMB encounter with a resolvable Organization identifier in https://cloud-wildcatch.invalid/fhir/sid/medcloud-provider. The visit supplies indexDate and hospital scope. Explicit case type 08 is excluded. Route names and acquisition-platform labels do not establish hospital source.

The adapter:
- Uses a fresh UUID namespace and strips names, identifiers, raw source IDs and narratives.
- Includes only selected-hospital records linked to the same patient, omitting conflicting or unknown sources, future or void records.
- Preserves exact recognized ICD system URLs/editions, validates code syntax, deduplicates the same ICD family/code and reports unsupported diagnoses. WHO ICD-10 is not relabelled as ICD-10-CM.
- Collapses identical inpatient episodes but retains separate outpatient visits. Excludes future discharge dates and discharge-derived diagnoses of ongoing admissions.
- Uses only audited LOINC assays, supported units and actual collection/effective dates. Never substitutes a report date or normal/zero lab value.
- Blood WBC/platelet counts exported per microlitre by EHR-FHIR-BRIDGE are divided by 1000 for the model's `10*3/uL` unit. Micro symbols `µ` and `μ` normalize to `u`; unknown units and non-blood assays remain excluded. Fasting serum/plasma glucose `1558-6` feeds the existing general glucose feature `2345-7`; this does not establish fasting status for any other glucose assay. The projected wire codes/units remain compatible with the existing SaMD transport contract.
- Reports unavailable modules, unverified longitudinal coverage and missing inpatient ranks without inventing them.
- Accepts only exact recognized ICD procedure systems and formats; NHI order codes are not relabelled.

Complete birth date and recorded male/female sex are required by the model; a masked birth year is not expanded. Historical feature BNP maps ONLY to NT-proBNP LOINC 33762-6. Departments are not guessed. Service transport validation independently enforces the projected privacy contract, department AB/AD/22 and two-digit case codes.

## HTTPS SaMD contract

Build-time public settings:
```
NEXT_PUBLIC_HF_GATEWAY_ORIGIN=https://samd.mediprisma.tw
NEXT_PUBLIC_HF_AUTH_POLICY=intranet
```
Unset policy retains Firebase mode; no origin default, URL override, direct HTTP fallback or model token is embedded in the browser.

Both policies must target the standalone mediprisma-samd-service for prediction. Its legacy integrations/hf-gateway/dry-run-handler.ts handoff supports input checks only and is not a prediction endpoint. A Firebase deployment verifies the signed current caller and explicit operation authorization. Intranet mode, approved by the owner, omits Firebase credentials and relies on protected local HTTPS ingress attestation and approved client CIDRs. Origin/CORS, browser IP headers and site names never grant access.

The service requires explicit prediction activation; old configurations remain dry-run only. Firebase model-hf grants alone do not grant prediction. See the service's HF-PREDICTION-CONTRACT.md and configuration examples for activation and operation grants.

Request body: projected application/fhir+json Bundle, maximum 2 MiB; X-Request-ID is a fresh UUIDv4.
- POST /hf/v1/dry-run?claim=...&indexDate=YYYY-MM-DD&dryRun=true returns checked OperationOutcome with 200/422.
- POST /hf/v1/predict?claim=...&indexDate=YYYY-MM-DD&dryRun=false returns application/json schemaVersion1 scored/refused DTO with 200/422.

The server owns the HF token and fixed upstream URL. It validates input, forces the operation, bounds requests/responses and concurrency, uses a deadline and never retries or forwards caller credentials. Scoring validates subject, claim, mortality outcome, time horizon, Device association, probability, risk tier and required versions, then returns only a narrow DTO. Malformed scoring is distinct from transport outage.

The browser requires an accepted check of the same prepared input before enabling prediction. Nothing submits automatically. Import, source, patient, visit, horizon and Firebase identity changes clear old responses; stale replies are discarded. Responses are held in memory only. Requests omit cookies/cache/referrer and reject redirects. Reads are bounded while streaming. Returned request IDs appear only when correlated with the sent UUID.

CORS must allow the actual HTTPS frontend Origin, POST/OPTIONS and Authorization, Content-Type, Accept, X-Request-ID. Expose X-Request-ID and X-SaMD-Adapter-Version. The current production Origin is https://mediprisma.tw; normal HTTP localhost is not approved. Browser CORS and Local Network Access must be validated independently of server-side API tests.

## Local synthetic preview

Only in development, NEXT_PUBLIC_HF_LOCAL_PREVIEW_RELAY=synthetic activates exact /__hf-local-preview/hf/v1/dry-run and /predict rewrites to loopback 127.0.0.1:3004. Before any network request, the client validates a SHA256 fingerprint of the full projected Bundle with UUIDs normalized. Only two pinned synthetic fixtures are accepted; changing birth date or clinical values is rejected. Production builds with the flag fail closed on submission.

The local test tool separately validates loopback peer, Origin, query, content type, request ID, body size and canonical fixture equality. Input checks use the deployed HTTPS service. Prediction uses the staged new service's full authorization/parser path and the same real HF upstream. This temporary tool is not a general clinical proxy or production Gateway, and is outside the app artifact. Production services and TLS/CORS settings are not changed by this preview.

## Validation and deployment boundary

Only synthetic fixtures are used in tests, screenshots and model calls. No credentials, real patient records or raw clinical responses belong in version control or logs.

Focused frontend tests cover projection, transport, manual actions, refused/malformed results, source and identity invalidation, launch visibility and the traditional HF prognosis entry. Run relevant lint and production build with the preview flag unset. Service checks cover operation authorization, response sanitization, contract provenance, timeouts, size and concurrency.

Real synthetic calls on 2026-10-05 returned scored 200 for both horizons, with laboratory-day coverage warnings. Model versions and calibration are taken from the response, not adapter version. Production app/service publication is separate; the current deployed SaMD remains dry-run until the reviewed release and explicit prediction setting are activated.

## Additional bridge sources (2026-10-05)

The preparation button is now 整理模型資料. Supported source formats are medcloud2, NHI-FHIR-BRIDGE health-bank extension exports (the exact bridge-version tag), and EHR-FHIR-BRIDGE local extension exports (`ehr-fhir-bridge/extension-local`). All still use the active tab-local imported Bundle, explicit preparation/validation/prediction, and the same service authorization.

Health-bank hospital display names become private internal hospital scope references in a copy. Names must match exactly except for an explicit list of TVGH name variants. Other-hospital and conflicting performer records remain excluded. These grouping keys are never presented as official provider codes or transmitted. Only the audited TVGH single-hospital scraper resources can use TVGH as a fallback when their hospital reference is absent. A route's `site` does not supply clinical provenance. Module-completeness checks for imue modules remain specific to cloud exports; general source applicability and history coverage warnings remain on all imports.

A new bridge visit can be prepared even when its diagnosis cannot yet be mapped, so the missing diagnosis is visible. Input upload stays disabled when the selected index encounter lacks a recognized ICD-CM diagnosis. Current EHR-FHIR-BRIDGE mapper output uses `http://hl7.org/fhir/sid/icd-10` for some diagnoses: those are not silently relabelled as ICD-10-CM. The producer's underlying terminology must be verified and corrected before those records can score. This PR does not establish that current TVGH exports all successfully predict.

The EHR deidentified Patient name marker `DEID-` accompanies an artificial Jan 1 birth date. The adapter discards that date rather than presenting it as a full birth date. Missing birth date, unmapped diagnosis, laboratory items/units and history are not filled with guessed values.

Source code reviewed: `voho0000/NHI-FHIR-BRIDGE` extension background bundle envelope and mapper Encounter; `voho0000/EHR-FHIR-BRIDGE` extension build-bundle, helpers, Patient, Encounter, Condition and Observation mappers, and qemr-parser. Regression fixtures are synthetic and reflect their documented structures.
Health-bank exports only contain hospital display names. Identically named institutions cannot be reliably separated; an explicit hospital-name-only warning requires the user to verify identity and scope. Bridge normalization copies only resource fields it changes, avoiding repeated deep serialization of documents/images. Both the UI and request hook block a missing selected index diagnosis, even when another same-day visit is eligible.

The SaMD hook subscribes to the existing bundle-changed and storage notifications using useSyncExternalStore. Import/clear transitions immediately hide the prior context and results and abort pending requests, even if the memoized parent never renders. Regression tests dispatch the actual notification without manually rerendering the hook.


## Physician-supplied HF diagnosis (2026-10-06)

The owner requested an explicit physician confirmation for diagnoses omitted by imported records. No model eligibility rule is bypassed. A dated cloud visit without a usable diagnosis may now be prepared; submission still requires a diagnosis on the exact selected index encounter.

In advanced settings, the physician selects ICD-10-CM I50.9 (heart failure, unspecified), actual visit dates and diagnosis ranks. Shortcuts propose existing encounter dates and additional secondary ranks, then apply on explicit selection. No supplementation is applied by default or merely by opening the calculator. The owner removed the redundant physician-identity checkbox. Selecting a diagnosis shortcut confirms and applies the displayed existing visits; complete advanced date/code/rank selections also apply immediately. Opening the calculator alone does not confirm or add a diagnosis. These explicit selections are user statements, not verification of medical licensure. Only actual projected same-patient, same-hospital visits up to the index date are eligible; ongoing admissions and future records cannot be selected. Original chart/source data is unchanged. No synthetic visit or onset date is created. Existing I50.9 is not duplicated and original known ranks are retained; shortcuts use an additional free secondary rank for unranked supplementation, while advanced selections specify a rank explicitly. A conflict with an original ranked diagnosis is rejected, without overwriting source ranks.

Supplemental Conditions link to each explicitly selected Encounter. Attestation source, selected visit dates and confirmation time stay in the in-memory HfInput context and remain visible with the results. The upstream privacy contract sends minimal Conditions only, without attestation metadata or clinician identity. It does not support FHIR Provenance; the API does not receive a distinct physician-source flag. This limitation is visible here and should be addressed separately if upstream auditing requires it.

Changing code, selected visits, confirmation, index visit or model horizon clears old validation and prediction. Preparing another import resets confirmation. Input validation must pass again before prediction; age, missing data and all other upstream refusals remain in force.

Synthetic live tests of the deployed SaMD dry-run endpoint on 2026-10-06: one AMB I50.9 failed the HF requirement; two ranked AMB I50.9 visits or one ranked prior IMP I50.9 passed with missing-lab/history warnings. Unranked supplemental diagnoses were not recognized even with encounter end dates; a ranked secondary HF diagnosis was accepted. The actual new preparation helper was live-tested with an I10-only synthetic import: baseline 422, physician-confirmed I50.9 at two existing visits with explicitly chosen rank 2 returned 200, then prediction returned 200/scored with probability 0.001337 (0.1337%). This supports encounter-count eligibility as an inference, not an authoritative specification of all upstream rules. Do not create visits or repeat diagnoses purely to satisfy it. API acceptance does not establish clinical validity.

I50.9 descriptor reference: https://www.cms.gov/files/document/r13672CP.pdf . The initial UI deliberately offers only unspecified HF; it does not guess systolic/diastolic subtype.

The input summary and source gaps are initially collapsed by the owner's request; input-check and prediction buttons are above the detail section. Physician attestation provenance, returned errors and model warnings remain visible without opening the source details.


### Simplified confirmation

The UI offers two shortcuts: HF present at the two most recent outpatient encounters, or at the most recent completed admission. These use only actual projected encounters at the selected hospital on/before the index date. Selecting a shortcut immediately applies unspecified HF (I50.9) to those existing dates as an additional secondary diagnosis where an original rank is absent; the selected dates and ranks are displayed. No additional physician-identity checkbox is required. Existing HF ranks are preserved; otherwise a free secondary rank after known ranks/diagnosis count is proposed. Selection applies the diagnosis to the in-memory model request, but does not transmit it. Transmission still requires the input-check or prediction action. The API remains authoritative and no general history-only override is sent. If HF occurred at different dates, use the collapsed advanced date/rank controls. A shortcut is unavailable when the required existing encounters are absent; no encounter is invented. Preparation now defaults to the newest eligible outpatient visit, including a cloud visit without a recognized diagnosis. Previously cloud preparation skipped such visits and defaulted to the newest diagnosed one. The owner explicitly requested the latest outpatient visit with supplied HF history; the missing-index diagnosis still blocks checks until supplied on that exact visit, with a visible explanation.

Local browser validation on 2026-10-06 with the synthetic fixture and a selected HF-history shortcut still showed a connection failure. Identical OPTIONS requests with Content-Type/X-Request-ID preflight headers returned 403 for http://localhost:3003 but 204 with Access-Control-Allow-Origin for https://mediprisma.tw. The localhost failure occurs before upstream eligibility validation; this PR does not alter the SaMD service origin/access configuration.

Review hardening: case-type 08 records cannot receive supplemental HF diagnoses. The outpatient shortcut anchors to the exact index encounter even when other visits share its date. A missing index diagnosis is explained beside the disabled input-check button; an inpatient diagnosis alone does not clear it. Invalid manual ranks show an inline explanation and do not apply supplementation.

Unavailable diagnosis shortcuts explain their reasons beside the controls. Same-day selected encounters display distinct visit numbers, matching advanced settings, and a note to verify them individually. Privacy explanation and general hints remain visible outside the compact sticky actions.

Owner-approved display naming (2026-10-06): badge 北榮研究試用; calculator HF 門診預後模型; detail heading 北榮 HF 研究試用. English and accessible labels use TVGH research trial. No visible SaMD/AI-SaMD labels remain. Internal module identifiers, endpoint paths and model contracts are unchanged; this is a presentation change, not a regulatory status claim.

## Three-step layout and both horizons (2026-10-07)

The detail is laid out as 步驟 1 基準門診, 步驟 2 確認心衰病史 and 步驟 3 執行預測. Opening the detail prepares the active import locally, with no network request; 「重新整理」 prepares it again. The horizon selector is gone: one 「執行 HF 模型預測」 sends, for each of P1_CD_mortality_1m and P1_CD_mortality_3m in parallel, the dry-run and, only when accepted, the prediction, all from the same prepared input. Each horizon keeps its own check, score, refusal or error. A failure shared by both horizons is shown once; an authorization failure in either clears both. The card in the calculator list shows both probabilities.

Results show probability, risk tier (the active tier is highlighted; no cut-points are drawn because the browser does not receive them as data), and optional observed incidence per horizon. Server notes and dry-run warnings are merged across horizons, de-duplicated, and grouped as possible underestimation, outside the development data range, or other; a note from only one horizon is labelled with it. 「複製結果到病歷」 copies both horizons with the out-of-hospital-death caveat and the physician attestation.

After running, step 2 collapses to one line with 「修改」 (owner approval in chat, 2026-10-07). The usage guide can be dismissed; the preference lives in this browser only. 「本次使用的資料」 lists what is sent (patient, visits by class, diagnoses including physician-supplied codes, model lab items present and missing, procedures), what is never sent (medications, vital signs, free text, identifiers), and the source gaps.

## Cloud laboratory status (2026-10-07)

The medcloud2 and health-bank bridges mark every laboratory Observation `status: unknown`, because NHI cloud data carries no workflow status. The projection required final/amended/corrected, so every cloud lab was dropped and the model received none (a real v0.13.6 export: 315 labs, 0 sent; the model then reported hemoglobin and creatinine as untested). Owner decision in chat: from the medcloud and health-bank sources, an `unknown` result with a numeric value, a supported unit and a collection date is sent and counted as `lab-status-unreported`; preliminary, registered, cancelled and entered-in-error stay excluded, and the TVGH EHR bridge keeps the strict rule. Unit matching ignores whitespace (`g /dL`). When no model lab will be sent, the pre-run box says so with the reasons and counts. A separate bridge task proposes emitting `final` at the source.
