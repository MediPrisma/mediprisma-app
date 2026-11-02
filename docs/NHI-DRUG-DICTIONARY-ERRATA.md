# 健保藥典勘誤與北榮院內藥表

北榮院內藥表（`src/infrastructure/fhir/data/vghtpe-medication-index.generated.json`）由本機的院內藥品身分表產生（`scripts/build-vghtpe-medication-index.ts`）。身分表由本機比對工具依健保藥典（`vendor/nhi-fhir-bridge-nhi-drug-terminology`，目前 `nhi-drug-terminology-20260728`）推得；藥典本身有錯的列，比對前先以勘誤檔更正。

## 勘誤檔
- 內容：[`docs/data/nhi-dictionary-errata.json`](data/nhi-dictionary-errata.json)（本機比對工具使用同一份 `work/nhi-dictionary-errata.json`，身分表的 `sourceHashes.errata` 記錄其雜湊）。
- 每筆記錄：健保碼、欄位、藥典原值（`original`）、更正值（`corrected`）、類別、理由、證據、發現日期、是否已回報健保署（`reportedToNhi`）。
- 套用規則：只有藥典該列仍等於 `original` 時才改成 `corrected`。建表時會列出三種狀況並需人工處理：
  - `already_corrected_upstream`：新版藥典已更正，可把該筆標為已解決。
  - `original_changed_recheck`：新版藥典改成別的值，需重新核對是否仍有錯。
  - `code_absent`：新版藥典已無此代碼。

## 目前的勘誤（2026-11-03，快照 20260728）

| 健保碼 | 產品 | 原值 → 更正值 | 類別 |
|---|---|---|---|
| B020144289、BC20144289 | UNASYN 0.75 g | AMPICILLIN SODIUM .5 GM → SULBACTAM (SODIUM) .25 GM+AMPICILLIN (SODIUM) .5 GM | 漏登成分 |
| B020144210、BC20144210 | UNASYN 1.5 g | AMPICILLIN SODIUM 1 GM → SULBACTAM (SODIUM) .5 GM+AMPICILLIN (SODIUM) 1 GM | 漏登成分 |
| A015748100、AC15748100 | ALDIOXA TABLETS "PATRON" | ALUMINUM CHLORHYDROXYALLANTOINATE (=ALCOXA) 100 MG → ALUMINUM DIHYDROXYALLANTOINATE (=ALDIOXA) 100 MG | 成分錯誤 |
| A036167209 | TRAMADOL INJECTION 50MG/ML "S.Y" | TRAMADOL HCL 50 MG → TRAMADOL HCL 50 MG/ML | 漏單位 |
| B018290100 | DEPAKINE CHRONO 500 mg | VALPROATE SODIUM 500 MG+VALPROIC ACID 145 MG → VALPROATE SODIUM 333 MG+VALPROIC ACID 145 MG | 含量錯誤 |
| B022008100、A048878100、AC48878100 | DEPAKINE CHRONO／Vakin Chrono 500 mg | VALPROATE SODIUM 500 MG → VALPROATE SODIUM 333 MG+VALPROIC ACID 145 MG | 同產品基準不一致 |

## 由比對規則處理、未改資料的藥典不一致
- 187 個健保碼的英文品名寫 CREAM／OINTMENT／GEL，劑型欄卻是另一種半固體劑型：比對以英文品名為準，品名未寫才用劑型欄。
- 同一成分的鹽類、水合物寫法不一（MESILATE、SULFATE、HEPTAHYDRATE、DI MALEATE、AMOXYCILLIN／AMOXICILLIN 等）：比對時視為同一成分；酯類（ACETATE、SUCCINATE、PHOSPHATE 等）仍視為不同產品。
- 微脂體／脂質複合劑型以藥典自身中英文品名（微脂、LIPOSOM、LIPID）判斷，與一般劑型分開。

## 更換藥典版本時
1. 更新 vendored 藥典，並同步本機比對工具使用的藥典路徑。
2. 重建本機身分表，處理建表時列出的勘誤狀態（見上）。
3. 重建 `vghtpe-medication-index.generated.json`，對全部院內品名比較新舊結果再送 PR。
4. 回報健保署後，把對應項目的 `reportedToNhi` 改為回報日期；健保署更正後於新版確認為 `already_corrected_upstream` 再移除。
