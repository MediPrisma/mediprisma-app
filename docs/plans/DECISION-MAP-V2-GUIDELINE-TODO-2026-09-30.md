# 決策地圖 v2 — what still needs a guideline source (hand-off, 2026-09-30)

決策地圖 v2 now draws only the Artifact 「CDSS 小麻式版面原型」
(https://claude.ai/artifact/ThfR3PQCyhY5L1fM6SFq47), full window and inside
the CDSS panel alike (owner, 2026-09-30: 「都照著CDSS小麻式版面原形，不要使用任何原本的外觀」).
The layout is done. What is left is the content the prototype draws that the
pack cannot yet defend from a governed guideline page. The owner asked for
these to be marked here and handed to the local session: 「需要guideline
resource的你註記，我請本地session接手處理」.

Nothing below is on the page today. Each item says what the Artifact draws,
what the pack has now, and the source still needed. Quote from the governed
PDF page, never from memory (`cdss-pack-authoring`). academic.oup.com is
blocked from the cloud container, so the pages have to be read locally.

## 1. HF DP-06: 「現在是乾是濕？」 — the 暖／冷 × 乾／濕 grid and 誘因

The owner, 2026-09-30: 「好吧，乾濕那個好像是小麻才有的」. On hold until
each row below has a source.

What the Artifact draws, in chapter 2 of the HF page (Main.dc.html l.115–185, l.290–300):

| Artifact element | Artifact rule | Pack today | Source needed |
|---|---|---|---|
| 鬱血徵候, four yes／no rows with 「全部皆無」: 端坐呼吸、夜間陣發性呼吸困難／頸靜脈怒張／肺部囉音／下肢水腫 | Asked on the page | The items are in ESC 2026 Table 7 (`ESC-HF-2026-SIGNS`: orthopnoea, PND, elevated JVP, pulmonary crepitations, peripheral oedema). The congestion evidence table already has them as note-prefilled rows (`evidence-tables.ts` `NOTE_SIGN_ROWS`, `congestion:orthopnea`…), but DP-06's visit decision (`congestionVisitDecision`) does not read them and the page does not ask them | Governed (`ESC-HF-2026-SIGNS`). The work is the pack's: make them DP-06 asks, written to the same rows |
| 乾／濕 | **濕** = weight up since last visit **or** any sign; **乾** = no sign **and** weight unchanged or down | `congestionVisitDecision` (`hf-visit-context.ts` l.515): **worse dyspnoea**, weight up or the R1 NT-proBNP rise → act; dyspnoea is not a sign in the Artifact's rule | A page that defines congestion from these items. Table 7 lists symptoms and signs of HF, not a wet／dry rule. Decide which rule the pack keeps, with its page |
| 暖／冷 (灌流足／灌流差) and the four cells 暖乾 穩定：維持, 暖濕 加強利尿, 冷乾／冷濕 當日處理 | 「末梢冰冷或意識改變即屬『冷』」; the line under the grid reads 血壓 and 脈壓 from the record | No hypoperfusion rule and no profile grid in the pack | **No governed source found.** ESC 2026 would need a page naming the clinical profiles (warm／cold, wet／dry) and the signs of hypoperfusion. If ESC 2026 does not state it, the card must say so, or the grid stays off |
| 為什麼現在？誘因, six yes／no rows, shown when dyspnoea is worse or 濕 | 漏藥、鹽分或水分過多／新用 NSAID、非 DHP CCB 等／AF 心率失控／感染／胸痛、缺血／血壓失控 | Only the two drug rows are governed: `ESC-HF-2026-NSAID-COX2`, `ESC-HF-2026-NON-DHP-CCB` | A page listing precipitants of worsening HF (adherence, salt／fluid, arrhythmia, infection, ischaemia, uncontrolled hypertension). Until then only the two drug rows can be drawn |
| The diuretic row in chapter 3: 「依乾濕調整：濕則加量，乾則維持或試減」 | Follows the grid | Governed: `ESC-HF-2026-LOOP` (Rec Table 5, p.37), `ESC-HF-2026-LOOP-DOSING` (§6.1.3.1, p.32, 「the lowest possible dose of diuretics to maintain euvolaemia」) | Governed. Only the 乾／濕 input it reads needs a source (row 2) |

Where it would land: the pack (`packages/personalized-care`, HF visit context
and the DP-06 asks), then the book's chapter 2 in the host
(`features/clinical-decision-support/renderers/visit/VisitBookLayout.tsx`),
drawn with the page's existing ask rows (`.askRow`, 「全部皆無」). Any new
question also needs a `docs/LAUNCH-ROUTE-GATES.md` row.

## 2. HF DP-01: the phenotype table

| Artifact | 決策地圖 v2 now | Why |
|---|---|---|
| Three columns HFrEF／HFmrEF／HFpEF, LVEF ≤40%／41–49%／≥50% ＋ 結構／舒張異常或利鈉胜肽升高 (Main.dc.html l.88–97) | ESC 2026 classes: HFrEF LVEF <50%, HFpEF ≥50% and never <50%, with symptoms and signs; no HFmrEF | The owner kept ESC 2026 (「維持 ESC 2026＋可點」, 2026-09-30). ESC 2026 removes HFmrEF. The #65 review required the symptoms-and-signs part of the HFpEF definition |

Nothing to source. It is listed so the local session does not bring back the
Artifact's HFmrEF column from the prototype.

## Not on the page for another reason

These are 不顯示 on 決策地圖 v2 by the owner's layout decision, not for want
of a source. They stay on 決策地圖 and 三區塊. See the 決策地圖 v2 table in
`docs/LAUNCH-ROUTE-GATES.md`:

- 補填／修改 and its values editor.
- 看依據's quotes and module cards.
- The chapter footers.
- AF 「完整 AF 篩檢風險檢核」.
- 複製的病歷文字.
