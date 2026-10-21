# DOAC 劑量計算機與手術前後停藥計算機

- `doac-dose-nvaf`：依 EU SmPC，逐藥核對成人 apixaban、rivaroxaban、edoxaban、dabigatran 的劑量。適應症可選 NVAF（預設）、急性 DVT／PE、VTE 延長治療、髖或膝關節置換術後預防。AF CDSS 的 DP-09（DOAC 劑量）會開啟這個計算機；id 保留原名，DP-09 的連結不變。
- `doac-periop`：手術前停藥與術後恢復，依 EHRA 2021、ASRA 2018，並列 EU SmPC。也列在 AF 頁的計算機清單（DP-09）。

## 分工（owner decision 2026-10-21）

- **AF CDSS**：只依 guideline（ESC 2024 Table 11、ACC/AHA 2023）判斷。Table 11 決定不了的情況，例如併用有交互作用規則的藥、肝硬化、edoxaban 15 mg，CDSS 卡會寫「劑量請用 DOAC 劑量計算機核對」。
- **本計算機**：依仿單規則判斷。結果只供核對，不改變 CDSS 建議。
- **入口**：AF 頁頁首的「計算機」按鈕列出 AF 的計算機（CHA₂DS₂-VA、CrCl、HAS-BLED、DOAC 劑量）。CDSS 卡上寫到「DOAC 劑量計算機」時，也會變成連結。心衰竭頁的清單不變。

## 計算內容（NVAF）

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

## VTE（`indication` 不是 `nvaf` 時）

VTE 的三種適應症各有自己的規則（`doac-dose-model.ts`），不呼叫 NVAF 的減量判斷。

| 藥 | 急性 DVT／PE | 延長治療（完成 ≥6 個月後） | 髖／膝置換後預防 |
|---|---|---|---|
| apixaban | 10 mg bid ×7 天 → 5 mg bid；不依年齡、體重、Cr 減量；CrCl 15–29 謹慎 | 2.5 mg bid | 2.5 mg bid，術後 12–24 h；髖 32–38 天、膝 10–14 天 |
| rivaroxaban | 15 mg bid ×21 天 → 20 mg qd；CrCl 15–49 在 20 mg 階段「可考慮」15 mg qd（PK 推論，不自動套用） | 10 mg qd；高復發風險考慮 20 mg | 10 mg qd，術後 6–10 h 且已止血；髖 5 週、膝 2 週 |
| edoxaban | 先注射抗凝 ≥5 天 → 60 mg qd；30 mg 條件同 NVAF（SmPC Table 1 本來就是 NVAF 與 VTE 共用）；不顯示 NVAF 的高 CrCl 提醒 | 同一劑量，療程個別評估 | EU SmPC 無此適應症 |
| dabigatran | 先注射抗凝 ≥5 天 → 150 mg bid；Table 2 為 SPAF 與 DVT/PE 共用；110 mg 用於 DVT/PE 屬 PK/PD 推論，附引文 | 同急性期 | 術後 1–4 h 110 mg → 220 mg qd；CrCl 30–50、≥75 歲、併用 verapamil／amiodarone／quinidine 時 75 mg → 150 mg qd；CrCl 30–50 加 verapamil 考慮 75 mg qd；髖 28–35 天、膝 10 天 |

- **注射抗凝**（`parenteral_lead_in`：已完成 ≥5 天／進行中／未使用）。edoxaban、dabigatran 未完成時，判定為「先完成注射抗凝」：顯示劑量，但處方比對不會顯示「一致」。空白列為待補。
- **急性期的注射抗凝不算「併用其他抗凝血劑」**：會改成轉換提醒（不可同時給，於下一次預定時間開始口服）。若空白，判定為需個別判斷；若填「未使用」，仍判為禁忌。
- **不穩定 PE**（`pe_unstable`）：apixaban、rivaroxaban、edoxaban 判為不建議；dabigatran 的 SmPC 沒有這一條，判為需個別判斷。
- **apixaban 加強效誘導劑**：急性 DVT／PE 判為不建議（SmPC：should not be used），其他適應症判為謹慎。
- **劑量隨時間改變**：處方比對會讀「口服治療第幾天」（`vte_day`）。沒有填時，不會判為「一致」。

## 手術前後停藥（`doac-periop-model.ts`）

1. **不給時數**：CrCl <15 或透析（EHRA Fig 14：No official indication for use），以及 dabigatran CrCl <30（Not indicated；仿單禁忌；神經軸時依 ASRA 11.1.4 建議不做）。不會借用 15–29 那一列。
2. **AF 導管消融**：依 EHRA Fig 16 單獨處理，不走一般高風險流程。最後一劑預設術前 12 h（可到 24 h），拔 sheath 後 3–5 h 恢復，恢復前要排除心包填塞。apixaban 另引仿單的「does not need to be interrupted」。
3. **極低／低／高風險**：分級依 EHRA Table 12，時數依 Fig 14。極低風險在谷底濃度時做（bid 12 h、qd 24 h），術後 ≥6 h 恢復。仿單的時數並列顯示，不參與決定。
4. **神經軸**（ASRA 2018）：每一級都要檢查，有神經軸時一律視為高風險（Table 12）。Xa 抑制劑停 72 h。dabigatran 預設 120 h，只有在腎功能已可靠評估、年齡 ≤65、無高血壓、無抗血小板藥都明確時，才依 CrCl 分級為 72／96／120 h。最後取 EHRA 與 ASRA 中較長者。
5. **考慮再延長**（Fig 14／15）：只提示，不自動加時數。
6. **時刻**：最晚服藥時刻 = 手術時刻 − 時數。最後一劑與跳過劑數用病人實際服藥時刻排出；手術當下那一劑也算在跳過內。沒有服藥時刻時不算劑數。
7. **恢復時間**取下列條件中最晚者：分級時數（極低 6 h、低 24 h、高 48（–72）h）、拔管 + 6 h（ASRA；仿單 apixaban ≥5 h、rivaroxaban ≥6 h、dabigatran ≥2 h）、穿刺出血 + 24 h（rivaroxaban 仿單；以手術時刻當作穿刺時刻）。
   - 止血確認是每一次都要的條件。
   - 拔管時刻、穿刺是否出血未填，或填「尚未止血」時，不輸出最早恢復時刻。
8. **殘餘藥效**：以該藥校正的 anti-Xa（dabigatran 用 dTT／ECT）可估計濃度。ASRA 寫明可接受的殘餘濃度未定，EHRA 寫明依濃度調整沒有前瞻性證據。計算機沒有數值欄位、沒有閾值，也不會輸出「可開刀」。
9. **緊急手術**：依 EHRA Fig 12。dabigatran 可用 idarucizumab，也可透析移除。Xa 抑制劑不以 andexanet 作為術前通用逆轉：EU 只核准用於危及生命或無法控制的出血，ANNEXA-4 未納入緊急手術病人。
10. 不橋接。

新增的輸入型別 `datetime`／`time`（`types.ts` 的 `DateTimeInput`）由手動輸入，不會自動帶入。

## 來源

| 藥 | 文件 | 頁碼依據 |
|---|---|---|
| apixaban | Eliquis 5 mg SmPC（EMA PDF 2026-03-26） | 實體頁 36–66 |
| rivaroxaban | Xarelto 20 mg SmPC（EMA PDF 2026-08-07） | 實體頁 86–117 |
| edoxaban | Lixiana SmPC（EMA PDF 2025-05-14） | 實體頁 1–31 |
| dabigatran | Pradaxa 110／150 mg SmPC（EMA PDF 2025-10-09） | 實體頁 31–109 |

四份 SmPC 的「Date of revision of the text」都是空白，所以版本以 EMA PDF 檔案日期記錄（見 `LABEL_SOURCES`）。

同一份 PDF 中，其他劑量的 SmPC 會在引文的 `document` 欄位標明，例如 apixaban 髖膝預防的「Eliquis 2.5 mg」（p.2–5、10），以及 rivaroxaban 髖膝預防的「Xarelto 10 mg」（p.29–31）。

每條規則的引文、章節與頁碼都在 `features/medical-calculator/doac-dose-model.ts` 的 `CITES`。2026-10-21 用 `pdftotext -f N -l N` 逐頁核對全部 118 段：117 段程式比對相符；dabigatran Table 2 的「300 mg or 220 mg」一格因表格欄位交錯，以 `-layout` 人工確認。更新 SmPC 時重跑同樣的核對，並提高 `DOAC_RULES_VERSION`。

### 指引（不是仿單，另列來源與頁碼）

`doac-periop-model.ts` 的 `GUIDELINE_CITES`，每段都記期刊頁碼與 PDF 實體頁碼。

| 指引 | 文件 | 頁碼依據 |
|---|---|---|
| EHRA 2021 | Steffel et al., Europace 2021;23:1612–1676（euab065.pdf，65 頁） | 實體頁 + 1611 = 期刊頁。12 段文字用 pdftotext 逐頁核對，全部相符。Figure 12、14、15、16 是圖片，從渲染後的頁面判讀（p.1641、1643、1647），判讀內容寫在 `figure` 欄位。 |
| ASRA 2018 | Horlocker et al., Reg Anesth Pain Med 2018;43:263–309 | PDF p.17 = 期刊 p.279，p.19 = p.281。15 段用出版社 PDF 的逐頁文字（pdf.js）核對，全部相符。 |

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

## 與規格書（2026-10-20）不同之處：VTE 與手術前後

- **edoxaban 髖膝預防**：EU SmPC 沒有這個適應症（規格書也寫臺灣未核准）。
- **電生理檢查與非複雜消融**：規格書歸為低風險，EHRA Table 12 歸為 minor。AF 消融另走 Fig 16。
- **dabigatran 神經軸**：規格書寫 72／96／120 h，ASRA 預設 120 h，有條件才分級。
- **dabigatran 拔管後時間**：規格書寫 6 h。仿單是 ≥2 h、ASRA 是 6 h，計算機取 6 h 並列兩個來源。
- **≥85 歲再延長**：EHRA 原文只寫 older age，沒有年齡切點，因此只提示，不設切點。
- **anti-Xa <30 ng/mL 可開刀**：不採用。
- **andexanet 作為術前逆轉**：不採用。
- **極低風險直接不停藥**：會略過神經軸規則，因此不採用。
- **術後 enoxaparin 40 mg 固定寫法**：改依 Fig 15，寫「依院內流程考慮預防劑量 heparin」。

## 不涵蓋

兒童、CAD／PAD 的 rivaroxaban 2.5 mg、內科住院病人 VTE 預防、癌症相關 VTE 的藥物選擇；也不評估機械瓣、中重度二尖瓣狹窄、抗磷脂症候群與活動性出血。
