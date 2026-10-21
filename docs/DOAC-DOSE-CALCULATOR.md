# DOAC 劑量計算機（NVAF，依仿單）

`doac-dose-nvaf`：依 EU SmPC，逐藥核對成人 NVAF 的 apixaban、rivaroxaban、edoxaban、dabigatran 劑量。AF CDSS 的 DP-09（DOAC 劑量）會開啟這個計算機。

## 分工（owner decision 2026-10-21）

- **AF CDSS**：只依 guideline（ESC 2024 Table 11、ACC/AHA 2023）判斷。Table 11 決定不了的情況，例如併用有交互作用規則的藥、肝硬化、edoxaban 15 mg，CDSS 卡會寫「劑量請用 DOAC 劑量計算機核對」。
- **本計算機**：依仿單規則判斷。結果只供核對，不改變 CDSS 建議。
- **入口**：AF 頁頁首的「計算機」按鈕列出 AF 的計算機（CHA₂DS₂-VA、CrCl、HAS-BLED、DOAC 劑量）。CDSS 卡上寫到「DOAC 劑量計算機」時，也會變成連結。心衰竭頁的清單不變。

## 計算內容

- **CrCl**：Cockcroft–Gault（實際體重），用未四捨五入的值比較；可手動覆寫，覆寫時會標示。
- **四藥依序判斷**
  - 各藥的禁忌、不建議、應避免：腎功能、透析、肝功能、交互作用、懷孕／哺乳、其他抗凝血劑。
  - 減量條件。
  - 與目前處方比對：一致、不同、仿單禁忌／不建議、或尚無法判定。
- **未填的欄位視為未知，不當作「無」**：
  - 可能改變劑量的未知值（例如 edoxaban 的 4 種 P-gp 抑制劑、dabigatran 的 verapamil 與胃腸出血風險、apixaban 的減量條件）：不給劑量。
  - 可能讓該藥變成禁忌或不建議的未知值（透析、肝功能、ALT/AST、懷孕、各藥的交互作用藥）：仍顯示劑量，列為待填；處方比對不會顯示「一致」，只會顯示「劑量數字相同，尚待確認」。
- **判定順序**：禁忌 > 不建議 > 需個別判斷（不顯示數字）> 待補資料 > 應避免（顯示劑量，處方比對標示應避免）> 仿單劑量。
- **自動帶入**：目前 DOAC 處方與 13 類併用藥，用 CDSS 同一個判斷「目前用藥」的函式（`currentMedicationRecords`，含供藥期滿後 30 天寬限）。只看全身性用藥；藥膏、眼藥、heparin 沖洗液不算。

## 來源

| 藥 | 文件 | 頁碼依據 |
|---|---|---|
| apixaban | Eliquis 5 mg SmPC（EMA PDF 2026-03-26） | 實體頁 36–66 |
| rivaroxaban | Xarelto 20 mg SmPC（EMA PDF 2026-08-07） | 實體頁 86–117 |
| edoxaban | Lixiana SmPC（EMA PDF 2025-05-14） | 實體頁 1–31 |
| dabigatran | Pradaxa 110／150 mg SmPC（EMA PDF 2025-10-09） | 實體頁 31–109 |

四份 SmPC 的「Date of revision of the text」都是空白，所以版本以 EMA PDF 檔案日期記錄（見 `LABEL_SOURCES`）。

每條規則的引文、章節與頁碼都在 `features/medical-calculator/doac-dose-model.ts` 的 `CITES`。2026-10-21 用 `pdftotext -f N -l N` 逐頁核對：58 段中 57 段程式比對相符；dabigatran Table 2 的「300 mg or 220 mg」一格因表格欄位交錯，以 `-layout` 人工確認。更新 SmPC 時重跑同樣的核對，並提高 `DOAC_RULES_VERSION`。

## 與規格書（2026-10-20）不同之處（依 SmPC 原文）

- **Edoxaban 高 CrCl**：SmPC 沒有 >95 的切點。§4.4 只寫「需仔細評估」，§5.1 把高 CrCl 定為 >100，因此本計算機在 >100 時提醒。
- **Edoxaban 15 mg**：SmPC 只用於轉換成 VKA。
- **Dabigatran 75 mg**：SmPC 的 75 mg 不含 NVAF。
- **Rivaroxaban 透析**：SmPC 沒有劑量建議，所以顯示「需個別判斷」，不給數字。
- **Apixaban 併用 clarithromycin、verapamil，edoxaban 併用 verapamil、amiodarone、quinidine**：SmPC 寫明不調整劑量。

## 臺灣仿單：上線前需藥學部核對

計算機每次顯示結果時都附上這些提醒（`TAIWAN_LABEL_CHECKS`），而且不套用：

- [ ] 臺灣 Lixiana（2025 年版）的高齡 edoxaban 15 mg qd 用法：條件原文
- [ ] 臺灣 Eliquis 對強效 CYP3A4＋P-gp 雙重抑制劑的寫法（不建議，或減量）
- [ ] 臺灣 Pradaxa 75 mg 的適應症
- [ ] 其餘條文是否與 EU SmPC 一致

## 不涵蓋

VTE 治療、預防用藥、手術前後停藥、兒童；也不評估機械瓣、中重度二尖瓣狹窄、抗磷脂症候群與活動性出血。
