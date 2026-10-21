# DOAC 劑量計算機與手術前後停藥計算機

- `doac-dose-nvaf`：依 EU SmPC，逐藥核對成人 apixaban、rivaroxaban、edoxaban、dabigatran 的劑量。適應症可選 NVAF（預設）、急性 DVT／PE、VTE 延長治療、髖或膝關節置換術後預防。AF CDSS 的 DP-09（DOAC 劑量）會開啟這個計算機；id 保留原名，DP-09 的連結不變。
- `doac-periop`：手術前停藥與術後恢復，依 EHRA 2021、ASRA 2025（第 5 版），並列 EU SmPC。也列在 AF 頁的計算機清單（DP-09）。

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
| rivaroxaban | 15 mg bid ×21 天 → 20 mg qd；CrCl 15–49 在 20 mg 階段，15 mg qd 列為條件式選項（PK 推論） | 10 mg qd；20 mg（高復發風險）列為條件式選項 | 10 mg qd，術後 6–10 h 且已止血；髖 5 週、膝 2 週 |
| edoxaban | 先注射抗凝 ≥5 天 → 60 mg qd；30 mg 條件同 NVAF（SmPC Table 1 本來就是 NVAF 與 VTE 共用）；不顯示 NVAF 的高 CrCl 提醒 | 同一劑量，療程個別評估 | EU SmPC 無此適應症 |
| dabigatran | 先注射抗凝 ≥5 天 → 150 mg bid；Table 2 為 SPAF 與 DVT/PE 共用；110 mg 用於 DVT/PE 屬 PK/PD 推論，附引文 | 同急性期 | 術後 1–4 h 110 mg → 220 mg qd；CrCl 30–50、≥75 歲、併用 verapamil／amiodarone／quinidine 時 75 mg → 150 mg qd；CrCl 30–50 加 verapamil 考慮 75 mg qd；髖 28–35 天、膝 10 天 |

- **注射抗凝**（`parenteral_lead_in`：已完成 ≥5 天／進行中／未使用）。edoxaban、dabigatran 未完成時，判定為「先完成注射抗凝」：顯示劑量，但處方比對不會顯示「一致」。空白列為待補。
- **急性期的注射抗凝不算「併用其他抗凝血劑」**，但必須在 `anticoagulant_switch` 明確填「是」：其他抗凝血劑只有急性 VTE 的注射劑，而且開始口服時就停用。這時改成轉換提醒（不可同時給，於下一次預定時間開始口服）。
  - 「其他抗凝血劑」也包含 warfarin 和另一種 DOAC，所以不會從注射抗凝已完成去推斷。
  - 空白時判為需個別判斷；填「否」時判為禁忌。
  - 轉換方式依各藥仿單分列皮下注射與 UFH 輸注：
    - edoxaban：由皮下注射劑轉換時，在下一次皮下注射預定時間開始；由 UFH 輸注轉換時，停止輸注 4 小時後開始。
    - rivaroxaban、dabigatran：由 LMWH 轉換時，在下一次注射預定時間前 0–2 小時開始；由 UFH 輸注轉換時，停止輸注時開始。
    - apixaban：仿單只寫下一次預定給藥時間。
- 只在部分適應症才問的欄位（注射抗凝、注射劑轉換、不穩定 PE、amiodarone、quinidine、天數）標為 `optional`，計算機清單的「待填」數不計入。規則讀到這些欄位時，空白仍視為未知。
- **不穩定 PE**（`pe_unstable`）：apixaban、rivaroxaban、edoxaban 判為不建議；dabigatran 的 SmPC 沒有這一條，判為需個別判斷。
- **apixaban 加強效誘導劑**：急性 DVT／PE 判為不建議（SmPC：should not be used），其他適應症判為謹慎。
- **條件式劑量**：仿單只在特定條件下才建議的劑量，列為「可考慮」選項，不算仿單劑量；處方是這種劑量時，比對顯示「可考慮，需確認」，不會判為「一致」。例如 rivaroxaban 在 VTE、CrCl 15–49 時的 15 mg qd（出血風險高於復發風險），以及延長期的 20 mg（高復發風險）。
- **劑量隨時間改變**：處方比對會讀天數。急性 VTE 讀口服治療第幾天（`vte_day`，從 1 起算）；dabigatran 髖膝預防讀術後第幾天（`postop_day`，手術當天為 0），手術當天是 110／75 mg（處方選項 `dabigatran:110:1`、`dabigatran:75:1`），第 1 天起是 220／150 mg qd。沒有填天數時，不會判為「一致」。

## 手術前後停藥（`doac-periop-model.ts`）

1. **不給時數**：
   - CrCl <15 或透析：EHRA Fig 14 寫 No official indication for use。
   - dabigatran CrCl <30：EHRA 寫 Not indicated，仿單也是禁忌。有阻斷時，依 ASRA 2025 建議不做，除非已測 dabigatran 濃度且 <30 ng/mL。
   - 以上都不會借用 15–29 那一列。
2. **AF 導管消融與極低風險不跳過劑量**：
   - AF 消融依 EHRA Fig 16 單獨處理，不走一般高風險流程；極低風險在谷底濃度時做。
   - 照常服用處置前最後一個排定劑量。距離短於谷底時數（消融 12 h；極低風險 bid 12 h、qd 24 h）時，提示調整服藥或處置時間，計算機不替使用者跳過該劑。
   - 例：rivaroxaban 每天 08:00、19:00 消融，最後一劑是當天 08:00（11 h），不是前一天（35 h）。
   - **處置到恢復之間到期的劑量**（各分級共用）：只有恢復前最後一劑，可依該藥仿單的漏服規則在恢復時服用；更早的都不補服。
     - rivaroxaban、edoxaban qd：恢復仍在同一天就延到恢復時服用；已跨日則不補服。兩藥仿單都寫「立即服用，隔天照常」。
     - dabigatran qd：不補服，隔天同一時間繼續（Pradaxa 仿單）。
     - bid 早上那一劑：不服用、不補服（EHRA Fig 15）。apixaban 與 rivaroxaban 15 mg bid 的仿單允許早上漏服時立即補服；畫面並列兩者，註明計算機依 EHRA，請團隊確認。
     - bid 晚上那一劑：apixaban、rivaroxaban 若恢復仍在當晚，可在恢復時服用；dabigatran 需距下一劑 ≥6 h（Pradaxa 仿單），否則不補服。
   - **依實際服藥時刻多停將近一次給藥間隔時**（例：rivaroxaban 09:00、低風險 08:00，停 47 h）：會提示可提前服用那一劑，或延後處置（EHRA Fig 15），不自動調整。
   - 消融在拔 sheath 後 3–5 h 恢復，恢復前要排除心包填塞。apixaban 另引仿單的「does not need to be interrupted」。
3. **低／高風險**：分級依 EHRA Table 12，時數依 Fig 14。仿單的時數並列顯示，不參與決定。
4. **神經軸與深部神經叢／周邊阻斷**（ASRA 2025，第 5 版；取代 2018 年第 4 版）：
   - **哪一種處置**：每一級都要檢查。脊髓／硬膜外與腰椎穿刺依 EHRA Table 12 一律視為高風險；深部神經叢／周邊阻斷套 ASRA 的時數，但不改變 EHRA 的分級。
   - **依劑量分級，不依適應症**（ASRA Table 1）：
     - 每天一次的 dabigatran、rivaroxaban 10 mg 是低劑量。
     - apixaban 2.5 mg bid 要問用途：NVAF 減量是高劑量，VTE 延長期或術後預防是低劑量。未填時以高劑量（較長間隔）計，並列為待填。
     - 其他都是高劑量。
   - **阻斷前停藥時數**：

     | 藥 | 高劑量 | 低劑量 |
     |---|---|---|
     | apixaban | 72 h | 36 h |
     | edoxaban | 72 h | ASRA 無低劑量，一律以高劑量計 |
     | rivaroxaban | 72 h | 24 h（CrCl <30 為 30 h） |
     | dabigatran | CrCl ≥50 為 72 h；30–49 為 120 h | 48 h |

     最後取 EHRA 與 ASRA 中較長者。
   - **留置導管期間意外給藥**：拔管前停藥時數同上表，或殘餘濃度 <30 ng/mL。
5. **考慮再延長**（Fig 14／15）：只提示，不自動加時數。
6. **時刻**：開始時刻（`surgery_at`；有阻斷時填穿刺時刻）與結束時刻（`surgery_end_at`）分開輸入。
   - 最晚服藥時刻 = 開始時刻 − 時數。
   - 最後一劑與跳過劑數用病人實際服藥時刻排出；開始時刻當下那一劑也算在跳過內。沒有服藥時刻時不算劑數。
7. **恢復時間**取下列條件中最晚者：
   - 結束時刻加上分級時數（極低 6 h、低 24 h、高 48（–72）h）。
   - ASRA 2025：穿刺或拔管後，高劑量 ≥24 h、低劑量 ≥6 h 才給第一劑。仿單另寫 apixaban ≥5 h、rivaroxaban ≥6 h、dabigatran ≥2 h，取較長者。
   - 脊髓／硬膜外穿刺出血：apixaban 48 h、rivaroxaban 24 h（ASRA 引仿單）。dabigatran、edoxaban 沒有給時數，需與麻醉科確認，因此不輸出最早恢復時刻。

   止血確認是每一次都要的條件。結束時刻、拔管時刻或穿刺是否出血未填，或填「尚未止血」時，不輸出最早恢復時刻。結束時刻或拔管時刻早於開始時刻時，視為輸入錯誤，要求更正，也不輸出恢復時間。
8. **殘餘藥效**：
   - 有阻斷時，照 ASRA 2025 原文列出：殘餘濃度 <30 ng/mL，Xa 抑制劑亦可用 anti-Xa ≤0.1 IU/mL，為「可接受」。同時列出 ASRA 自己註明的「未經臨床驗證」，以及 EHRA 所說「依濃度調整停藥沒有前瞻性證據」。
   - 沒有阻斷時，只寫 EHRA 的說明。
   - 兩種情況都不據以判定可否處置：沒有數值欄位，也不會輸出「可開刀」。
9. **處方本身**：
   - VTE 起始劑量（apixaban 10 mg bid、rivaroxaban 15 mg bid）：建議延後擇期處置。時數只供參考；近 3 個月內血栓事件屬少數可討論橋接的情況（EHRA）。恢復的劑量依 VTE 治療進度決定。
   - 預防劑量：提醒 EHRA 時數以治療劑量為準。恢復時給回預防劑量。
   - 治療劑量：恢復時給回術前劑量。
10. **緊急手術**：依 EHRA Fig 12。
    - dabigatran：可用 idarucizumab，也可透析移除；idarucizumab 後 24 h，若臨床穩定且已止血，可再開始（Pradaxa SmPC 4.4，p.42）。
    - Xa 抑制劑：不以 andexanet 作為術前通用逆轉。EU 只核准用於危及生命或無法控制的出血，ANNEXA-4 未納入緊急手術病人。
11. 不橋接。

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

每條規則的引文、章節與頁碼都在 `features/medical-calculator/doac-dose-model.ts` 的 `CITES`。2026-10-21 用 `pdftotext -f N -l N` 逐頁核對全部 137 段：136 段程式比對相符；dabigatran Table 2 的「300 mg or 220 mg」一格因表格欄位交錯，以 `-layout` 人工確認。更新 SmPC 時重跑同樣的核對，並提高 `DOAC_RULES_VERSION`。

### 指引（不是仿單，另列來源與頁碼）

`doac-periop-model.ts` 的 `GUIDELINE_CITES`，每段都記期刊頁碼與 PDF 實體頁碼。

| 指引 | 文件 | 頁碼依據 |
|---|---|---|
| EHRA 2021 | Steffel et al., Europace 2021;23:1612–1676（euab065.pdf，65 頁） | 實體頁 + 1611 = 期刊頁。13 段文字用 pdftotext 逐頁核對，全部相符。Figure 12、14、15、16 是圖片，從渲染後的頁面判讀（p.1641、1643、1647），判讀內容寫在 `figure` 欄位。 |
| ASRA 2025（第 5 版） | Kopp et al., Reg Anesth Pain Med 2025, doi:10.1136/rapm-2024-105766（2025-01-29 線上） | online first，頁碼 1–29，與 PDF 實體頁相同。34 段用 pdftotext 逐頁核對，全部相符。2018 年第 4 版已被取代，不再引用。 |

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
- **dabigatran 神經軸**：規格書寫 72／96／120 h。ASRA 2025 高劑量是 CrCl ≥50 為 72 h、30–49 為 120 h，低劑量是 48 h。
- **拔管後時間**：規格書寫 6 h。ASRA 2025 是高劑量 ≥24 h、低劑量 ≥6 h；仿單另寫 ≥2–6 h。計算機取較長者，並列來源。
- **≥85 歲再延長**：EHRA 原文只寫 older age，沒有年齡切點，因此只提示，不設切點。
- **anti-Xa <30 ng/mL 可開刀**：不採用。ASRA 2025 的「可接受」只照原文列出，不據以放行。
- **andexanet 作為術前逆轉**：不採用。
- **極低風險直接不停藥**：會略過神經軸規則，因此不採用。
- **術後 enoxaparin 40 mg 固定寫法**：改依 Fig 15，寫「依院內流程考慮預防劑量 heparin」。

## 不涵蓋

兒童、CAD／PAD 的 rivaroxaban 2.5 mg、內科住院病人 VTE 預防、癌症相關 VTE 的藥物選擇；也不評估機械瓣、中重度二尖瓣狹窄、抗磷脂症候群與活動性出血。
