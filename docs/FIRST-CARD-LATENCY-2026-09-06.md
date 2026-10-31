# 初診快覽 first-section latency — the two-lane generation (2026-09-06)

## The problem

On the hospital's on-prem vLLM (`tvghbrain3.5`) the clinician presses 產生 and
waits for the whole prompt to be prefilled before a single token comes back.
The 醫療摘要 batch sends the complete fitted clinical context — years of
cross-hospital NHI records plus the discharge narrative — and asks for five
card blocks in one response. The overview block is first in that response, so
the first visible section is gated on prefill of the *largest* prompt the
feature ever builds.

Turning reasoning off was tried and rejected: latency improved, quality did
not survive. So the lever has to be prompt SIZE for the first section, not the
model's thinking budget.

Target: **< 20 s from 產生 to the overview card being visible**, with the
remaining sections unchanged in quality.

## What changed

### 1. Harness is selected by context window, not by provider

`use-medical-summary.hook.ts` previously chose the compact ("local-small")
prompt harness with `isCustomOpenAiModelId(modelId)` — i.e. "is this a
user-configured endpoint". It now asks `usesCompactSummaryHarness(contextLimit)`
(`src/core/use-cases/medical-summary/medical-summary-harness.ts`), which is
`contextLimit < 500_000`.

What the compact harness fixes — a short module-scoped contract, overview
first, reduced evidence — is what a **small window with a slow prefill** needs,
and that is not a property of one vendor. The threshold splits the shipped
lineup exactly:

| model | context limit | harness |
|---|---|---|
| Gemini / GPT / Claude long-context tiers | 900 000 – 1 800 000 | `frontier` |
| GPT nano | 120 000 | `local-small` (new) |
| Claude Haiku | 180 000 | `local-small` (new) |
| conservative 15K fallback entry | 15 000 | `local-small` (new) |
| custom OpenAI-compatible endpoint | profile's `contextWindowTokens` | as declared |

Moving the three sub-500K cloud models onto the compact rules is intended, not
a side effect.

**Provider-shaped transport options were deliberately left alone.** `temperature: 0`
+ `reasoningEffort: 'low'`, the 45 s card-progress watchdog, and the
`strictGrounding` finalize flag are still gated on `isCustomOpenAiModelId`.
Those are properties of a user-configured endpoint, not of a window size, and
changing `strictGrounding` for GPT-nano/Haiku would have silently changed what
their summaries are allowed to say — a quality change nobody asked for.

### 2. Two lanes whenever the compact harness is active

A fresh compact-harness generation now issues **two concurrent requests** under
the same generation slot, the same operation key, and the same abort:

**Fast lane — `overview` only, over a deterministically reduced evidence set**
(`buildFastLaneOverviewEvidence` in `generate-medical-summary.use-case.ts`):

> **Superseded — see "The overview snapshot" at the end of this document.**
> `buildFastLaneOverviewEvidence` line-filtered the generic narrative, so its
> size followed the chart. It was replaced by `buildOverviewSnapshot`
> (`src/core/use-cases/medical-summary/overview-snapshot.ts`), whose size is
> set by per-section caps. The bullets below describe the removed builder and
> are kept only as the record of what was tried.


- **Catalog keys are never renumbered.** The fast lane filters catalog
  *entries*; a surviving key means the same resource it means in the full lane,
  so a citation from either lane resolves against the one catalog the UI shows.
- Kept resource types: `Condition`, `MedicationRequest`, `MedicationStatement`,
  `Observation`, `DiagnosticReport`, `AllergyIntolerance`, `CarePlan`,
  `Composition`/`DocumentReference` (the **D keys stay citable**), and
  `Encounter` only when its `encounterClass` is inpatient or emergency.
  Outpatient encounters, procedures, imaging studies, immunisations, devices
  and consents belong to the sections the full lane writes.
- The clinical narrative goes through the **same line filter** as
  `compactLocalRetryEvidence` (that mechanism was extracted into
  `keepLinesCitingAllowedKeys` and is now shared by both), then is capped at
  **`FAST_LANE_OVERVIEW_TOKEN_BUDGET = 12 000` estimated tokens**. Trimming is
  applied only as far as the budget requires, in this fixed order:
  1. **document bodies** — the `<BEGIN_DOCUMENT>` boundary and the
     `Document title:` line stay, the narrative is replaced with an explicit
     omission marker. (The formatter marks no 出院診斷/住院臆斷 headings inside
     the body, so there is nothing narrower to keep; the D key remains in the
     catalog.)
  2. **the longitudinal investigation appendix** — each analyte keeps its
     latest 2 points instead of the full series.
  3. **visits older than ~6 months** — measured against the newest visit the
     data itself carries, never the wall clock, and followed by an explicit
     "visits before *date* are not listed in this section" note so an omission
     can never read as "this patient had no earlier visits".
  4. last resort: the shared `fitClinicalContextTextToTokenBudget`.
- Prompt: the existing local overview rules + the overview schema + the batch
  marker contract for that single block. One sentence was added to the overview
  local rule — *"This block can be written directly from the listed evidence;
  it does not need extended deliberation."* Deliberately soft: no thinking is
  disabled and no new provider parameter is sent.

**Full lane — `problems`, `focus`, `recent`, `safety`** in the current local
order, with the full fitted clinical context, and everything it had before:
`runWithContextWindowRetry`, per-card progressive parse/publish, the two
bounded retries, and the watchdog.

**Publishing** is unchanged and shared: whichever lane parses a closing marker
first writes the progressive artifact to the store, so the overview appears as
soon as it lands even while the full lane is still streaming.

**Failure handling.** A lane only escapes with an abort (user stop) or a
context-window rejection — both propagate, as before. Every other failure is
recorded per card, so a failed fast lane leaves `cardErrors.overview` and the
existing `retryFailed` / single-module retry path regenerates the overview
alone (covered by a test).

The frontier harness keeps the established single batch. A module retry is
never split — it already targets exactly the failed cards.

### 3. The number is visible

`MedicalSummaryGeneration` gained `firstCardMs` — monotonic, from the start of
the run to the first published card. The sticky status strip now reads

> `tvghbrain3.5 · 首段 00:12 · 耗時 00:41`
> `tvghbrain3.5 · First section 00:12 · Time 00:41`

with a matching ARIA template (`summaryGenerationProvenanceWithFirstCard`).
The live elapsed timer during a run is unchanged.

On the `ai_result` usage-analytics event the new parameter is
**`first_card_bucket`**, not a raw millisecond value. That event's contract
says in as many words that it never carries a raw duration — `duration_bucket`
is banded for exactly that reason — so the time-to-first-section is banded the
same way (`lt5` / `5to15` / `15to45` / `gt45`). The exact millisecond number
stays in the app, where the clinician can see it.

## How to run the experiment

```
FIRST_CARD_BASE_URL=http://localhost:11434/v1 \
FIRST_CARD_MODEL=qwen2.5:1.5b \
npx tsx scripts/experiments/first-card-latency/main.ts
```

Env: `FIRST_CARD_BASE_URL` (default `http://localhost:11434/v1`),
`FIRST_CARD_MODEL` (default `qwen2.5:1.5b`), `FIRST_CARD_API_KEY` (optional
bearer), `FIRST_CARD_LOCALE` (`zh-TW` | `en`), `FIRST_CARD_SKIP_BASELINE=1`,
`FIRST_CARD_SEQUENTIAL=1` (run the lanes one after another on a single-slot
endpoint), `FIRST_CARD_FAST_BUDGET` (override the fast-lane snapshot budget),
`FIRST_CARD_MAX_TOKENS` (per-lane completion cap, default 4000),
`FIRST_CARD_DEADLINE_MS` (per-lane wall-clock cap, default 900000),
`FIRST_CARD_FAST_THINKING=off` (turn hidden reasoning off on the overview lane
only — what the app now ships), `FIRST_CARD_BUNDLE=<absolute path>` (measure
another FHIR Bundle instead of the demo; the reference clock is pinned to that
bundle's newest record date, and a large chart may need
`NODE_OPTIONS=--max-old-space-size=8192`).

The run prints a per-section token table for the overview snapshot and the
total fast-lane request size before it starts streaming.

For the on-prem endpoint:

```
FIRST_CARD_BASE_URL=<vLLM base url>/v1 \
FIRST_CARD_MODEL=tvghbrain3.5 \
FIRST_CARD_API_KEY=<token> \
npx tsx scripts/experiments/first-card-latency/main.ts
```

The script loads `public/demo/demo-bundle.json` through the same scoping the
demo-snapshot validator uses, builds the clinical context with
`GenerateClinicalContextUseCase` + the shared document/longitudinal formatters,
and then builds **all three prompts with the real use-case code** — the same
`buildRegisteredCardBatchMessages`, the same card registry instructions, the
same `buildFastLaneOverviewEvidence`. It streams the baseline alone first (two
requests sharing one GPU is the condition the split creates, and timing the
baseline under that contention would flatter the result), then the two lanes
concurrently, and reports per lane: estimated prompt tokens, time to first
token, time to the first complete card block, total time, and whether the
overview block parses. It ends with

```
first-card=<s> total=<s> prompt-tokens=<n>
```

Because it uses the core clinical-context use-case rather than the app's
React-hook composition, the absolute prompt size is smaller than the app's; the
lane comparison is what the script measures.

## Measurements

### Local proof run — Ollama `qwen2.5:1.5b`

This run exists to prove the plumbing end to end (prompt construction, both
lanes, concurrent streaming, block parsing). **Its absolute speed is
meaningless** — a 1.5B model on a laptop is not the on-prem deployment.

Command (this Ollama serves one request at a time, so the lanes were run
sequentially — see the caveat below):

```
FIRST_CARD_SEQUENTIAL=1 FIRST_CARD_MAX_TOKENS=1500 FIRST_CARD_DEADLINE_MS=600000 \
  npx tsx scripts/experiments/first-card-latency/main.ts
```

```
endpoint      http://localhost:11434/v1
model         qwen2.5:1.5b
catalog       95 sources (fast lane keeps 62)
context       3358 est. tokens (fast lane 3358, budget 12000)
fast trims    (none needed)

lane                 prompt-tok    ttft  first-block   total  overview
baseline(one batch)       8101  45.5s        51.6s    96.1s  FAILED
fast(overview)            5935  39.3s          n/a   126.5s  FAILED
full(rest)                7740  59.2s          n/a   117.4s       -

first-card=n/a total=243.8s prompt-tokens=13675
```

A second run with the fast-lane budget forced down to 1 500 tokens
(`FIRST_CARD_FAST_BUDGET=1500`) exercised the trimming ladder on this small
chart:

```
context       3358 est. tokens (fast lane 1105, budget 1500)
fast trims    documents
fast(overview)            3681 prompt tokens
```

What this run does and does not show:

- **Proven:** the demo bundle is scoped, the catalog is built (95 sources, 62
  survive the fast-lane filter), both lanes' prompts are built by the real
  use-case code, the trimming ladder fires and reports which step it used, both
  lanes stream, and card-block detection works — the baseline's overview
  closing marker was detected at 51.6 s.
- **Not proven: overview quality.** `qwen2.5:1.5b` echoes the schema back
  instead of filling it, on every lane and on the baseline, so
  `parseBatchModuleResult('overview', …)` correctly returns null and the run
  reports `FAILED`. That is a 1.5B model's instruction-following, not the
  pipeline; a successful parse is covered by the hook-level integration test
  instead.
- **Not proven: the concurrency saving.** This Ollama serves one request at a
  time, so a concurrent run only measures the queue (an earlier concurrent
  attempt had the queued lane's connection dropped at ~300 s). The per-lane
  prompt size and prefill numbers above are still valid; the wall-clock saving
  from running the lanes at once is not measurable here.
- Run-to-run variance on this laptop is large (the full lane's 7 740-token
  prompt took *longer* to first token than the baseline's 8 101-token prompt in
  this run). Do not read a trend out of these seconds.
- The demo chart's clinical context is only ~3 400 tokens, so the fast lane's
  prompt reduction here (8 101 → 5 935, −27 %) comes mostly from dropping four
  card contracts and 33 catalog entries. On a real multi-year chart the context
  dominates the prompt and the 12 000-token cap is what does the work.

### On-prem `tvghbrain3.5`

To be measured by the owner with the command above.

| | baseline (one batch) | fast lane (overview) | full lane (rest) |
|---|---|---|---|
| estimated prompt tokens | TBD | TBD | TBD |
| time to first token | TBD | TBD | TBD |
| **time to first section** | TBD | **TBD** | — |
| total time | TBD | TBD | TBD |
| overview parsed | TBD | TBD | — |

Target for the fast lane's *time to first section*: **< 20 s**.

### In-app check (localhost:3001, demo patient)

A temporary custom OpenAI-compatible profile pointing at
`http://localhost:11434/v1/chat/completions` with `qwen2.5:1.5b` (declared
window 32 768) was added through the app's own AI settings — no Firebase
involved — selected in the 醫療摘要 model picker, and 重新產生 pressed.

- The browser network log shows **two concurrent `POST /v1/chat/completions`**
  (each preceded by its own CORS preflight) for the one generation — the lane
  split is live in the app, not only in tests.
- The 32 768-token window pushed the run onto a smaller context-fitting tier
  (coverage dropped from 院所 10 / 就醫 43 / 用藥 148 / 檢驗 92 to 9 / 29 /
  111 / 26) and the 資料已調整 badge appeared, as designed.
- The run ended with all five cards showing 請求逾時 and a per-card 重試 — the
  45 s card-progress watchdog firing repeatedly, because `qwen2.5:1.5b` never
  emits a valid block. The partial-result UI, the per-card errors and the retry
  affordances all behaved correctly.
- The profile was left in place but **disabled** afterwards (its 移除 button did
  not respond to automated clicking); delete it from AI 偏好設定 → 自訂 AI 端點
  when convenient.

## What was NOT verified

- No measurement on `tvghbrain3.5`; every number for it above is `TBD`, not an
  estimate.
- No successful overview parse from a live model: neither locally available
  Ollama model (`qwen2.5:1.5b`, `qwen2.5vl:7b`) fills the schema instead of
  echoing it. Successful parsing and lane-independent publishing are covered by
  `__tests__/application/hooks/medical-summary/summary-two-lane.test.tsx`,
  which runs the real prompt-building, streaming-parse and publish code.
- The wall-clock benefit of running the two lanes at once was not measured: the
  local Ollama serves one request at a time.

## OpenRouter MoE runs (2026-09-06, demo patient, zh-TW, real numbers)

Cloud providers behind OpenRouter vary run to run (the same Qwen configuration
gave a 22.9 s and a 104.7 s first card), so **wall-clock seconds here are not
comparable to the on-prem GPU**. The stable signal is `think-chars`: how much
hidden reasoning the model emitted before the overview block. On-prem that
text is generated at local decode speed and lands squarely inside the
first-card budget.

Demo context is small (3 358 est. tokens, no fast-lane trim needed), so these
runs measure the reasoning cost of the overview lane, not prefill.

| model | fast-lane variant | first card | think-chars (fast) | overview rows | notes |
|---|---|---|---|---|---|
| qwen/qwen3.6-35b-a3b | model-default thinking, max_tokens 4000 | FAILED | n/a | 0 | thinking consumed the whole output cap; no content token |
| qwen/qwen3.6-35b-a3b | model-default thinking, max_tokens 16000 | 22.9 s / 104.7 s | 20 032 / 18 035 | 4 / 6 | best content: renal, anticoagulation (PE + dabigatran, D1), hematology, high-risk-meds, ECG; baseline one-batch 51.9 s |
| qwen/qwen3.6-35b-a3b | `reasoning.effort=low` | 40.0 s | 17 849 | 2 | provider did not shorten thinking; lost the anticoagulation row |
| qwen/qwen3.6-35b-a3b | brief-reasoning sentence in system prompt | 19.3 s | 15 800 | 1 | prompt barely shortens thinking and the block degrades — rejected |
| qwen/qwen3.6-35b-a3b | **overview lane thinking off** (`reasoning.enabled=false` / `enable_thinking=false`), full lane default | **7.7 s** | 0 | 3 | renal, anticoagulation (PE + dabigatran, D1), allergy; missed hematology / high-risk-meds |
| google/gemma-4-26b-a4b-it | no thinking (model has none) | 5.9 s / 8.4 s / 8.7 s | 0 | 1–3 | shallow: missed anticoagulation in every run; one run copied the slot enum literally (`renal|anticoagulation|…`, coerced to `other` app-side) |

Reading: for the overview lane the cost is hidden reasoning, not prompt size.
Soft prompting ("keep reasoning brief") does not move a thinking model; only a
provider-level switch does. Turning reasoning off for the overview lane alone
kept the two rows that matter most (renal dosing, anticoagulant status) while
the full lane keeps the model's default reasoning for focus/problems/recent.
Whether that trade is acceptable is the owner's call; tvghbrain3.5 numbers
remain TBD until measured on-prem.

Script flags used: `FIRST_CARD_MAX_TOKENS=16000`, `FIRST_CARD_SKIP_BASELINE=1`,
`FIRST_CARD_FAST_THINKING=off`, `FIRST_CARD_FAST_BRIEF_THINK=1`,
`FIRST_CARD_REASONING_EFFORT=low`.

---

## The overview snapshot (2026-09-06, later the same day)

### Why the line filter was not enough

The owner accepted the thinking-off trade for the overview lane
(「堪用即可」) with one hard requirement: **the first section must appear in
under 20 s on `tvghbrain3.5`**. The on-prem throughput recorded in
`docs/FHIR-context-stability-optimization.txt` (main repo) is

| request size | measured |
|---|---|
| ~5 000 tokens | 10.7 s |
| ~13 000 tokens | 23.8 s |

so the fast lane has to stay near **10 000 tokens including its instructions
and its source list**, with thinking off — that is the largest request that
still interpolates under 20 s. (This paragraph said 7 000 through round 6,
when the evidence budget was 5 000; round 7 raised the evidence budget to
8 000 and the request ceiling to ~10 000. See "Round 7".)

`buildFastLaneOverviewEvidence` could not promise that. It filtered *lines* of
the generic narrative, so its output tracked the chart: 5 935 tokens on the
tiny demo patient (2 600 of which were fixed prompt overhead and 1 500 the
source list), and unbounded on a real multi-year NHI record — the 12 000-token
cap alone is already over budget.

### What replaced it

`buildOverviewSnapshot` (`src/core/use-cases/medical-summary/overview-snapshot.ts`)
composes a fixed set of sections straight from the scoped FHIR data and the
catalog, each with a **hard cap**, so the request size is a property of the
code rather than of the patient:

| section | cap | content |
|---|---|---|
| patient | 1 line | sex, age (age computed against the data's newest record) |
| problems | 15 | Conditions deduped by normalised name, then Encounter.reasonCode diagnoses grouped and marked 申報碼 with a visit count and last date |
| medicines | 25 | current medicines only, deduped by product, with org / days supply / date |
| admissions · ER | 8 | inpatient + emergency Encounters inside 24 months |
| discharge documents | 2 × 700 tok | key-section extraction, then the existing `fitDocumentTextToTokenBudget` |
| labs | 8 sampling dates per panel | one date × test markdown pivot per lab panel, the same table the full lane sends (shared `buildLabPivots`), newest date first, the latest value's catalog key in the column header; values with no lab category at all go under `- [no panel]`, one line each (round 7; through round 6 this was 30 lines of latest + previous over an analyte allowlist) |
| reports | 6 | latest DiagnosticReport per `inferGroupFromDiagnosticReport` modality, conclusion ≤ 240 chars |
| care plans | 4 | title + date |
| allergies | 10 | AllergyIntolerance records **only when present** |

Every capped section ends with `+N more not listed`, so an omission can never
be read as an absence. Windows are measured against the newest record the data
itself carries, never the wall clock. Catalog keys are not renumbered and the
returned catalog is the subset the snapshot actually cites.

Trim ladder when the 8 000-token evidence budget is exceeded, applied only as
far as the budget requires and reported in `sections`: document bodies
700 → 350 tokens each → 病史 for the newest note only → drop the older
document → problems 20 → 10 → procedures 12 → 8 → lab sampling dates 8 → 4 → 1
→ medicines 25 → 15 → drop 病史. Labs give up depth before medicines give up
rows: a trend still reads from four points, a missing prescription reads as
none.

Two utilities were ported (only these two) from branch
`codex/vghbrain-context-test`:

- `isMedicationCurrentlyInUse` (commit `392471d2`) — a computable supply
  window covering the reference date is positive evidence even when `status`
  is `unknown`, which is the only shape the NHI dispensing feed ever sends.
  Without it the "current medicines" section is empty on real data.
- `extractDocumentKeySections` and its vocabulary/guards — keeps 診斷 /
  主訴 / 住院治療經過 / 手術 / 病理 / 出院用藥 / 出院指示 and drops the
  administrative header, history, physical exam, labs and imaging dumps. It is
  conservative: an unrecognised layout is returned whole.

### Two more prompt changes

- **Fast-lane language contract stated twice, not four times.** The full prompt
  bookends itself (`system` head + tail, `user` head + final check) so the
  requested output language survives thousands of Chinese source lines. The
  snapshot is short, so the fast lane keeps it once at the top of the system
  message and once at the end of the user message
  (`singleLanguageContract`).
- **Allergy is no longer a model slot.** 「雲端無過敏資料，非確認無過敏」 is a
  statement about the BUNDLE, and it was the one row allowed an empty
  `sources` array — which cost the whole schema its "every row cites a key"
  guarantee. `SummaryMustKnowSchema.sources` is `min(1)` again, `allergy` is
  gone from `MUST_KNOW_SLOTS` and from every prompt sentence, and
  `finalizeResult` now emits `allergyRecords` from the catalog's `A` keys.
  `OverviewHeroCard` renders that row itself, with navigable A-key source pills
  when records exist and the 「非 AI」 badge either way.

### Measurements (2026-09-06, OpenRouter, zh-TW, real numbers)

Same caveat as the runs above: OpenRouter provider latency varies run to run
and is **not** comparable to the on-prem GPU. The stable, transferable numbers
are the prompt sizes.

Demo patient (`public/demo/demo-bundle.json`), clock pinned to 2026-09-03:

```
catalog       95 sources (fast lane cites 49)
context       3358 est. tokens (fast-lane snapshot 1554, budget 5000)

overview snapshot   tokens  kept  dropped
patient                6     1        0
problems             356    15       13
medications          255    12        0
documents            552     1        0
labs                 266    19        0
reports               85     1        0
carePlans             33     2        0
TOTAL               1554

fast request  3728 est. tokens (target ≤ 4500 on the demo chart)
```

`qwen/qwen3.6-35b-a3b`, `max_tokens=16000`, `FIRST_CARD_FAST_THINKING=off`,
two runs:

| run | lane | prompt-tok | ttft | first-block | total | overview | think-chars |
|---|---|---|---|---|---|---|---|
| 1 | baseline (one batch) | 8 060 | 26.4 s | 28.0 s | 30.5 s | ok | 25 061 |
| 1 | **fast (overview, no-think)** | **3 728** | 5.7 s | **5.7 s** | 5.8 s | ok | 0 |
| 1 | full (rest) | 7 740 | 60.5 s | 63.8 s | 69.4 s | — | 20 927 |
| 2 | baseline (one batch) | 8 060 | 59.2 s | 60.4 s | 71.6 s | ok | 20 170 |
| 2 | **fast (overview, no-think)** | **3 728** | 6.7 s | **6.7 s** | 6.7 s | ok | 0 |
| 2 | full (rest) | 7 740 | 119.4 s | 123.2 s | 132.0 s | — | 35 301 |

Overview rows the fast lane produced (identical text in both runs — the lane is
deterministic apart from the model):

```
headline: 94歲男性，CKD stage 3b (eGFR 32)，多重青光眼用藥，近期有譫妄、肺炎及多發性骨髓瘤病史
  [renal!] eGFR 32 mL/min/1.73m2 — 患者腎功能為CKD stage 3b，處方藥物（如Forxiga、Eltrixon、止痛藥等）需嚴格依據腎功能調整劑量或監測。 (O7)
```

**One row, not the three the earlier no-think run produced.** The baseline —
same prompt rules, full evidence, full thinking — also returned exactly one row
in both runs, so this is the model's row count on this prompt revision, not a
cost of the snapshot. The row it keeps is the renal one. The anticoagulation
row (PE + dabigatran, cited from D1) that the earlier runs sometimes produced
did not appear in either lane in either run, even though the D1 narrative
naming `Dabigatran 110mg bid` is present in the snapshot. This is the open
quality question on this revision.

Synthetic heavy chart (66 MB, ~1.1 M tokens, no PHI; clock pinned to its own
newest record 2026-08-23), baseline skipped:

```
catalog       247 sources (fast lane cites 62)
context       7191 est. tokens (fast-lane snapshot 1589, budget 5000)

overview snapshot   tokens  kept  dropped
patient                6     1        0
problems             185    14        0
medications          129     7        0
admissions            55     2        0
documents            746     1        0
labs                 360    18        0
reports               81     1        0
allergies             25     1        0
TOTAL               1589

fast request  4064 est. tokens (target ≤ 4500 on the demo chart)

lane                      prompt-tok    ttft  first-block   total  overview  think-chars
fast(overview,no-think)        4064  6.6s        6.6s   6.7s      ok            0
full(rest)                    15246 78.9s       81.8s  94.9s       -        25305
```

```
headline: 58歲女性，轉移性乳癌（骨、肝、肋膜）合併肋膜積液，近期出院帶藥含Apixaban、Letrozole及止痛/止吐藥物，門診追蹤至2026-08-23。
  [anticoagulation!] Apixaban 90d supply 2026-08-15 — 患者目前使用Apixaban，需確認抗凝適應症（如房顫或靜脈血栓）及出血風險，以評估今日處方之必要性與劑量。 (M3)
```

**This is the result the redesign exists for.** The chart is two orders of
magnitude larger than the demo, the full lane's prompt grew from 7 740 to
15 246 tokens, and the fast lane moved 3 728 → 4 064 — a 9 % rise for a 300×
larger bundle, because the caps, not the chart, decide the size.

`google/gemma-4-26b-a4b-it` on the demo (no hidden reasoning at all):

| lane | prompt-tok | ttft | first-block | total | overview | think-chars |
|---|---|---|---|---|---|---|
| baseline (one batch) | 8 060 | 5.4 s | 7.1 s | 14.1 s | ok | 0 |
| fast (overview, no-think) | 3 728 | 6.7 s | n/a | 11.1 s | ok | 0 |
| full (rest) | 7 740 | 9.0 s | 11.0 s | 20.6 s | — | 0 |

```
headline: 94歲男性，具多發性骨髓瘤、慢性腎臟病(Stage 3b)及糖尿病病史，近期有肺炎與譫妄紀錄。
  [renal] eGFR 32 mL/min/1.73m2 — 慢性腎臟病第3b期，需注意藥物劑量調整。 (O7)
  [high-risk-meds] 使用 Forxiga 10mg — 需注意糖尿病患者之腎功能變化。 (M10)
  [hematology] Hb 12.1 g/dL — 血色素值偏低，需持續追蹤貧血狀況。 (O9)
  [other] 多發性骨髓瘤 (未達緩解) — 需注意骨髓功能與相關併發症。 (E7)
```

Gemma produced four well-cited rows here — more than Qwen with thinking off —
which is worth keeping in view when the on-prem model is chosen.

Its `first-block` reads `n/a` while `overview` reads `ok`: Gemma closed the
block in a shape `hasCompleteBatchBlock` does not match but
`parseBatchModuleResult` does. In the app that costs the *progressive* publish,
not the card: the end-of-attempt parse still produces it. Pre-existing
behaviour, unchanged by this work, and not chased here.

### Transport

`hiddenReasoning: 'off'` now runs from `ctx.ai.stream` → `use-unified-ai.hook`
→ `AiSdkStreamAdapter` → the provider factory → a fetch wrapper on the
OpenAI-compatible client, and applies to **CUSTOM endpoints only**:

- default (vLLM/Qwen dialect): `chat_template_kwargs: { enable_thinking: false }`
- configured model id matching `/^gpt-oss/`: `reasoning_effort: 'low'` instead
  — gpt-oss bounds hidden CoT and cannot disable it, and the field must not
  reach other models on the hospital gateway
- `baseUrl` host `openrouter.ai`: additionally `reasoning: { enabled: false }`

Only the fast lane sets it; the full lane keeps the model's default. Frontier
providers ignore the option. The body mapping is unit-tested in
`__tests__/infrastructure/ai/openai-compatible.client.test.ts`.

### Still TBD

`tvghbrain3.5` remains unmeasured. Against the on-prem throughput table a
~4 100-token fast-lane request with thinking off should land near 9 s, and the
< 20 s requirement has ~2× headroom — but that is arithmetic, not a
measurement, and the table above is the only place a real on-prem number
belongs.

## Round 3 — admission floor, weighted problems, slot checklist (2026-09-06 evening, real numbers)

The first snapshot runs showed Qwen (thinking off) returning a single `renal`
row three times out of three, and the snapshot's `## Admissions` section was
empty on the demo: the default 6-month visit window had removed the 2025
admissions whose claim codes carry `Z86.711 肺栓塞之個人史` and `Z79.01 長期服用
抗凝血劑`, and recency-ranked claim codes put 耳垢嵌塞 above them. Three
deterministic changes, no new model-error guard:

1. **Milestone floor in the AI scope** (`filterEncounterRecords`): inpatient
   and emergency encounters within 24 months of the newest visit stay in scope
   whatever the saved visit window is. This also makes the 最近 90 天 rule
   ("older only if admission/procedure") reachable at all.
2. **Clinically weighted claim ranking** in the snapshot: Z79/Z86/Z87/Z95
   (long-term therapy, history, devices) > malignancy/haematology > chronic
   chapters (I/E/N/K7/J4x) > other > acute S/T/R/H6/Z0; admission-attached codes
   get +1; recency only breaks ties.
3. **Slot checklist** in the overview rule: fill every supported slot (3–5 rows
   typical), with one line per slot saying what evidence triggers it; claim-only
   diagnoses are written as 申報碼 in the headline.

`qwen/qwen3.6-35b-a3b`, fast lane thinking off, demo patient, three runs:

| run | fast request | first card | rows | rows produced |
|---|---|---|---|---|
| 1 | 4 044 tok | 8.8 s | 4 | renal, hematology, anticoagulation (E30), endocrine-pending |
| 2 | 4 044 tok | 2.4 s | 3 | renal, hematology, anticoagulation (D1) |
| 3 | 4 044 tok | 9.0 s | 5 | renal, anticoagulation (E30), hematology, high-risk-meds, endocrine-pending |

`google/gemma-4-26b-a4b-it`, demo, one run: 5.2 s, 4 rows (renal, anticoagulation,
hematology, endocrine-pending) — but two rows cite ICD codes (`Z7901`, `E1122`)
as if they were catalog keys; the app renders those as amber unverified pills.

Before this round the same configuration yielded 1 row in 3/3 runs, so the
change is the evidence and the checklist, not model variance. Snapshot size
moved 3 728 → 4 044 tokens (+316: the two admissions and their claim codes).

## Round 4 — "is 4K tokens too little?" (2026-09-06 night, real numbers)

The owner asked whether a 4 064-token fast lane for a 66 MB chart means the
snapshot is starving the model. Two honest corrections and three fixes:

- The "+9 % for a 300× bundle" line was misleading: the app's default AI
  scope had already cut that chart to 7 191 tokens before the snapshot saw it.
  `FIRST_CARD_SCOPE=all` now runs the all-time selection (746 732 tokens of
  context) — the only setting that actually stresses the snapshot's caps.
- The snapshot was thin for the wrong reasons, not by design: (1) reports were
  keyed by one coarse group, so the daily portable chest film hid every CT, MRI,
  ultrasound and pathology report; (2) pathology reports never reached any AI
  surface — the scope kept only the lab and imaging groups — and their text
  lives in `presentedForm`, which the snapshot did not decode; (3) the summary's
  document scope keeps only the latest admission's note, so the second
  discharge summary was never citable.

Fixes: reports keyed by modality class (pathology > PET > CT/MRI > US/echo >
ECG > X-ray; bilingual duplicates of one study collapse); pathology rides on
the imaging selection in `scopeClinicalDataForAi`; a discharge-summary floor
keeps the latest 2 notes within 24 months citable regardless of document mode
(never widening a manual pick); the snapshot decodes `presentedForm` text.

Synthetic 1.1 M-token chart, fast-lane snapshot:

| scope | context | snapshot evidence | documents | reports | fast request |
|---|---|---|---|---|---|
| default (before round 4) | 7 191 | 1 727 | 1 | 1 (CXR only) | 4 064 |
| default (after) | 7 191 | 2 765 | 2 | 5 (pathology, CT, MRI, US, CXR) | 5 721 |
| all-time (after) | 746 732 | 2 775 | 2 | 5 | 5 740 |

`qwen/qwen3.6-35b-a3b`, thinking off, heavy chart, default scope: first card
**7.5 s**, 5 rows (anticoagulation — apixaban on the current list; hematology —
Hb 8.6 / ANC 0.9; high-risk-meds; endocrine-pending — glucose 235; other — CRP
124 / ALT 60 / AST 82). Full lane 15 523 tokens / 82 s with thinking.

Budget check against the on-prem table (5K ≈ 10.7 s, 13K ≈ 23.8 s): the fast
lane is now 5.7K tokens, i.e. ~12 s by interpolation with thinking off. That is
the ceiling the snapshot is allowed to grow to; it will not be raised further
without an on-prem measurement. *(Superseded in round 7: the same table puts a
10K request at ~18 s, which is what the labs time series is spent on.)*

### Round 4 follow-up: document default, not a hidden floor

A first attempt added the second discharge summary as a silent floor inside
`scopeClinicalDataForAi`. That made the 資料範圍 drawer's 「最近一次住院」 label
lie about what was sent (the same UI-vs-sent gap flagged as B2 in the July
audit), so it was reverted. Instead the DEFAULT document mode moved from
`latestAdmission` to `recentAdmissions` (drawer label 「最近三次住院」,
`DEFAULT_DOCUMENT_MODE`), saved profiles keep whatever mode the user chose,
and the bounded-context tiers still fall back to one note. Effect on the demo
patient: full-lane context 3 358 → 7 642 tokens (the 2025-02 pneumonia stay's
note now travels), fast-lane request 4 044 → 4 995 tokens (two key-section
extracts). Heavy chart: unchanged at 5 721.

### Round 4 correction: same-named studies

NHI cloud records name every CT the same (33071B 電腦斷層造影－有造影劑) whatever
the body part, and MRI likewise, so "latest per modality" would let a head CT
hide a chest CT. Reports now keep the latest **3 per modality class** and
collapse only what is the same study (same class, same day, same accession
identifier when present — the bilingual double rows). Cap raised 6 → 8.
Heavy chart: 3 pathology, 2 CT, 2 MRI, 1 US listed (+4 more noted); fast-lane
request 5 721 → 6 031 tokens, still under the 7K on-prem ceiling that held
through round 6.

## Round 5 — real 健康存摺 fixtures: what the snapshot actually dropped (2026-09-06 late)

Six real (masked, local-only) charts from the bridge fixtures were converted
with the extension's own pure adapters and audited offline — no model call,
no values in this doc, only counts. Two systematic gaps showed up that the
synthetic chart had hidden:

1. **Quiet recent window ⇒ empty overview.** A prostate-cancer chart whose
   activity sits in 2023–2024 produced a 239-token snapshot (3 problems, 2 labs,
   1 report) because the default 6-month / 1-year windows saw almost nothing.
2. **Latest tumour markers / platelets older than six months never reached the
   model.** patient2's CA-125, CEA, FSH/E2 and the last platelet count (all
   2026-01) were outside the 6-month lab window; a busy oncology chart listed
   zero medicines because every supply window had lapsed between cycles.

Fix — **latest-known floors in the AI scope** (`src/core/utils/first-visit-floors.ts`),
deterministic, 24 months from the newest record in the chart, and printed in the
資料範圍 drawer so the UI says what is sent:
- admissions / ER visits (already), plus
- the latest value of each prescribing-relevant analyte outside the lab window
  (panel filter still respected),
- the latest report per modality class outside the imaging window,
- when fewer than 5 medicines are current, up to 10 recently dispensed
  medicines (the snapshot marks them `last dispensed … (supply ended)`).

| fixture (masked) | before → after snapshot tokens | medicines | labs | reports | documents |
|---|---|---|---|---|---|
| chart A (demo source) | 1 302 → 1 427 | 12 | 19 | 5 | 0 (only preventive-care notes) |
| chart B (breast ca) | 3 237 → 3 614 | 1 → 6 | 10 → 30 | 7 → 8 (+2) | 2 of 23 |
| chart C (oncology, busy) | 1 322 → 1 472 | 0 → 5 | 29 → 30 | 8 (+1) | 0 (2023 notes, outside 24 m) |
| chart D (prostate ca, quiet) | 239 → 642 | 2 | 2 → 23 | 1 → 3 | 0 |
| chart F | 1 425 | 0 | 10 | 5 | 1 |
| chart E | 1 609 | 7 | 23 | 3 | 1 |

Claim categories dropped on any of the six: only acute/minor (S/T/R/Z0/H6)
and "other" bands; no history/long-term Z code, malignancy, or chronic-chapter
category was cut. Demo fast-lane request after the floors: 5 574 tokens; heavy
synthetic chart 6 031 — both under the 7K on-prem ceiling that held through
round 6.

## Round 6 — full-text before/after review on nine real charts (2026-09-07)

Method change: the earlier "full lane" numbers came from the experiment
script's `GenerateClinicalContextUseCase` builder, which is **not** what the
app sends (it has no medication section, no encounter chronology, no lab
pivot). This round rendered the app's own `useClinicalAiInput` hook headlessly
(jest + provider mocks) against master `10c17a61` ("before") and this worktree
("after"), clock pinned to each chart's newest record, default profile. Five
健康存摺 fixtures and four medcloud captures (all masked, local only).

Full lane: on every chart the new text is a strict superset of the old one
(0 old lines missing), because the milestone-encounter floor and the
three-admission default add material and nothing is removed. The on-prem
window is ≥ 262K, so the new size (chart B 8 845 → 20 666 tokens) never trips
the trimmed tier.

Fast lane gaps found by reading chart B's three texts side by side, and the
fixes (all deterministic, unit-tested):

| gap in the overview snapshot | fix |
|---|---|
| no procedures at all (old text: 83 rows / 48 names incl. mastectomy, axillary dissection, Port-A, teletherapy, antineoplastic infusions) | `## Major procedures`: ancillary billing rows excluded by name (換藥, 點滴, oximetry, catheterisation, anaesthesia rows, RT planning, screening films), grouped by name with ×N / latest / first, ranked operations & implants & RT delivery → antineoplastic infusions & angiography/ERCP → others, cap 12 (ladder → 8) |
| a flagged GGT and the LDH cut from `## Labs` | GGT/LDH added to the prescribing-relevant allowlist; rows ranked abnormal → allowlisted → recency so the cap drops the least important rows |
| 病史 stripped from discharge summaries | history kept per document (1 500 chars, `[…病史 truncated]`), emitted before the omission trailer; ladder drops it newest-first only under budget pressure |
| full lane: DM regimen dispensed 2026-01 invisible (only "Currently in use (1)") | `useMedicationsContext` lists the medication floor under `Recently dispensed, supply ended (last 24 months, N) — NOT currently in use:`; floor logic shared via `selectMedicationRecords` |
| heading `## Current medicines` also listed lapsed rows | renamed `## Medicines (current first; "supply ended" = …)` |

Snapshot tokens after round 6 (budget 5 000): chart B 3 614 → 4 532;
chart C 1 472 → 1 764; chart E 1 971 → 2 557; chart F 1 910 → 2 456;
chart D 774 → 876; cloud chart W 892 → 909, cloud chart X 432 → 449, cloud chart Y 344 → 360,
cloud chart Z 211 → 306; heavy synthetic chart 3 496 (dump-script path).
Verification: tsc clean, lint 0 errors, 433 suites / 4 155 tests pass,
demo snapshots valid.

## Round 7 — the labs section becomes a time series (2026-09-07)

The clinician reviewing round 6's output called `## Labs` far too thin. It was
one line per analyte — latest value plus the previous point — capped at 30
lines and ranked abnormal → prescribing-allowlist → recency. The full lane had
already moved to a date × test pivot per panel on measured evidence
(docs/LAB-FORMAT-EXPERIMENT-2026-07-12.md: +20 pp answer accuracy, +24 pp
citation validity, ¼ the hallucinations and 0.53–0.83× the tokens versus
per-analyte trend lines), and every fast-lane snapshot measured so far sat at
300–4 500 tokens against a 5 000 budget. There was room.

**What changed**

- `## Labs` now renders the SAME table the full lane sends, from the SAME
  builder (`buildLabPivots`): one `- [chem]` / `- [cbc]` / … block per lab
  panel, `| Date | analyte (unit) [key] | … |`, one row per sampling date
  newest first, `-` where the analyte was not measured that day, and the
  source's own flag (`H`/`L`/`A`, `*` when it flagged through a structured
  reference range without naming a code) after an abnormal value. Cell and
  header rendering moved into `lab-pivot.utils.ts`
  (`formatLabValueText` / `formatLabPivotCell` / `labPivotColumnLabel`) so the
  two lanes cannot drift into different abnormal semantics.
- **Citations.** A pivot cell has no room for a key per value, so the catalog
  key of each analyte's NEWEST value goes in its column header. Because the
  kept rows are the newest sampling dates, an analyte that appears in the table
  at all has its newest value inside it, so the header key always cites a value
  the model can see. Those header keys are what `buildOverviewSnapshot` feeds
  the catalog filter.
- **Depth.** 8 sampling dates per panel — the full lane's default `labDepth`.
  The trim ladder halves it to 4, then to the latest date only, both steps
  before it drops a medicine row.
- **No analyte ranking any more.** The allowlist / abnormal-window admission
  rule, `MAX_LAB_LINES` and the abnormal-first weight are gone: a pivot column
  costs a fraction of a line, so every scoped analyte is shown and the scope
  itself (window + `labDepth` + the latest-known floors) decides what is sent.
  `PRESCRIBING_RELEVANT_ANALYTES` stays — the scope floor still uses it — and a
  floor-pulled analyte now simply appears as an older date row in its panel.
- Values the pivot builder seats in no panel (vital signs, free-standing
  measurements) get one line each under `- [no panel]`. Not `- [other]`:
  `other` is a real lab category the builder itself emits.
- **Budget 5 000 → 8 000 tokens.** Against the on-prem table (5K ≈ 10.7 s,
  13K ≈ 23.8 s) an 8K evidence budget plus the ~2K of instructions and source
  list interpolates to ~18 s — under the 20 s requirement, and the most that
  still is. The request ceiling in this document is therefore ~10K, not 7K.

**Measured on the same charts as round 6** (masked, local only; snapshot
tokens, and the labs section's `kept`/`dropped` in dated rows — a table's
sampling-date row, or one dated point on a `[no panel]` line):

| chart (masked) | round 6 | round 7 | labs kept/dropped |
|---|---|---|---|
| chart B (breast ca) | 4 532 | 4 810 | 22 / 0 |
| chart C (oncology, busy) | 1 764 | 2 964 | 36 / 0 |
| chart D (prostate ca, quiet) | 876 | 1 051 | 17 / 0 |
| chart E | 2 557 | 2 890 | 16 / 0 |
| chart F | 2 456 | 2 936 | 27 / 0 |
| cloud chart W | 909 | 3 572 | 25 / 0 |
| synthetic oncology (heavy) | 3 496 | 3 763 | 32 / 0 |

The largest chart is 4 810 tokens against the 8 000 budget, so the date cap
never bit on real data: the scope already limits each analyte to 8 points, and
a panel's distinct sampling days stayed under 8 on all seven charts. The cap
and its ladder are still what makes the size a property of the code — they are
exercised by unit tests rather than by these charts.

What the extra tokens buy, on chart B: `[cbc]` now shows the platelet drop and
the ANC across two draws instead of one latest value; `[chem]` puts the
flagged ALK-P, GGT, AST and ALT of the latest draw on one row beside
the normal LDH, with the older bilirubin and electrolyte draws beneath;
`[tumor]` carries an older CA 15-3 (a latest-known floor value) as an
older row in the same table rather than as an unexplained extra line.
