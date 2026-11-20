# CDSS 儲存欄位與 master 接入更新

狀態：規劃更新；未修改執行程式、Firebase Rules／Functions，未部署。  
核對日：2026-09-12（Asia/Taipei）。  
App 基準：已 fetch 的 `origin/master`，`1c17761f4a12712efc0d8f9a74afeffced846770`，PR #83。  
套件：`@voho0000/personalized-care` 2.0.0、`personalized-care-fhir` 1.6.0；宿主 HFpEF 計算機版本 `v1`。本輪依 App 原始碼確認輸入與保存接線，未重新稽核套件所有臨床規則。  
總體設計：[CDSS 病人紀錄與跨電腦同步](CDSS-PATIENT-HISTORY-SYNC-2026-09-11.md)。

## 1. 這次更新的結論

保留使用者已確認的規則：同帳號跨電腦、遮蔽身分證＋全名＋完整生日比對、每日一份最新狀態、回診自動帶入、各欄位保留真正修改日、每次直接修改都留歷程。

新版 master 已有「看診流程／原版」兩種 HF 畫面，並有逐欄日期與加密 session cache。保存設計沿用這些 store 的局部更新與回填接縫，不按畫面五區塊另存五份資料。畫面排序、問題拆分及版型切換不能改變欄位識別。

本次應接入五個資料來源：門診量測／問答、HF 分型回答、HFpEF 人工補填、醫師處置、證據納入／排除。表單展開狀態、計算機分頁、捲動位置、複製按鈕和下一步進度不屬於臨床輸入。

以下 `fieldId` 是**本次建議的新保存契約**，不是宣稱 master 已有這些鍵。選項以現有程式碼值為依據；型別、單位與許可欄位需由共同 manifest 產生前後端驗證器。

## 2. 每個可保存欄位的共通資料

| 要存什麼 | 規則 |
|---|---|
| `scopeId`、`fieldId` | 疾病／共用 scope＋固定語意欄位碼；獨立於 UI label、module 排序 |
| `value`、`unit` | 原始答案；數值使用契約定義的數字與標準單位；不把整個畫面或 profile 寫入 |
| `status` | 有值 `recorded` 或曾撤回 `withdrawn`；從未填寫沒有紀錄；`not-assessed` 是可記錄的答案 |
| `modifiedAt` | 直接修改欄位值或其量測日期／來源的時間；相同內容儲存不變 |
| `modifiedTimeZone`、`recordDate` | 保留操作時區；每日 key 固定使用 Asia/Taipei；不能直接截取 UTC 字串前十字元 |
| `measuredOn`／`measuredAt`、`datePrecision` | 檢查／量測／觀察日與修改日分開；只知道日期不補造時間；不知道就記未知 |
| `confirmedAt`（選用） | 本次明確確認舊值的時間；不重設 modifiedAt |
| `origin`、來源參照／指紋 | 區分人工輸入、人工覆寫、匯入資料；來源參照須版本化且不夾帶 raw patient.id 或病人識別文字 |
| `schemaVersion`、`inputSchemaVersion` | 共用 envelope 與該疾病輸入契約分開版本 |
| `packVersion`、`appVersion` | 當時臨床規則與 App 版本 |
| `calculatorId`／`calculatorVersion`（適用時） | HFpEF 分數由宿主計算機產生，不能只記 packVersion |
| `revision`、`lastEventId` | 欄位跨日版本與最後修改事件，防止舊資料覆蓋 |
| `operationId`、`actorUid`、`receivedAt` | 一次操作關聯、伺服器認定的登入帳號、伺服器接收時間 |
| `timestampProvenance` | 精確修改時間、舊版整組時間或未知；保留資料的實際可信程度 |

修改事件另存 before／after（包含原本有無值、狀態、日期、來源差異）、action、原操作日期、欄位 revision 與版本。before 由後端讀取；事件只能追加。每日快照可覆寫，事件不能跟著覆寫。

## 3. 已有介面：門診量測與臨床問答

### 3.1 六項門診量測

來源：`ClinicVitals.entries`，目前每項已有 `{ value, measuredOn, modifiedAt }`。這次保留結構優點，以 adapter 接共同契約。

| 顯示欄位 | master key | 建議 scope／fieldId | 單位 |
|---|---|---|---|
| 收縮壓 | `systolic` | `shared / systolic-bp` | mmHg |
| 舒張壓 | `diastolic` | `shared / diastolic-bp` | mmHg |
| 心率 | `heartRate` | `shared / heart-rate` | bpm |
| SpO₂ | `oxygenSaturation` | `shared / oxygen-saturation` | % |
| 體重 | `bodyWeight` | `shared / body-weight` | kg |
| 身高 | `bodyHeight` | `shared / body-height` | cm |

BP 可一起儲存，但兩個欄位各自比對差異；同一 operationId 保證原子提交。BMI 從身高／體重計算，不另造第二個人工 BMI 答案；保留當時實際採用來源供結果追溯。

### 3.2 NYHA 與代償

| 顯示欄位 | master key | 建議 fieldId（HF scope） | 允許值 |
|---|---|---|---|
| NYHA | `nyhaClass.value` | `nyha-class` | `I`／`II`／`III`／`IV`／`not-assessed` |
| 代償狀態 | `compensationStatus.value` | `compensation-status` | `compensated`／`decompensated`／`not-assessed` |

兩者都已有各自 modifiedAt。缺值代表尚未問；明確「未評估」是一筆回答；清除既有回答是一筆撤回事件。回診顯示舊值與原修改日，是否可當本次有效答案另由 carryForwardPolicy 處理，不能把日期換成今天。

### 3.3 症狀九項：每題一個欄位

來源：`ClinicVitals.signAnswers[term]`；建議 `fieldId = symptom--{term}`，值為 `present`／`absent`／`not-assessed`。

| 顯示欄位 | master term |
|---|---|
| 勞力性呼吸困難 | `exertional-dyspnea` |
| 端坐呼吸 | `orthopnea` |
| 夜間陣發性呼吸困難 | `paroxysmal-nocturnal-dyspnea` |
| 疲倦／運動耐受下降 | `fatigue-exercise-intolerance` |
| 腳腫（自述） | `reported-ankle-swelling` |
| 腹脹／吃一點就飽 | `abdominal-bloating` |
| 夜咳／喘鳴 | `nocturnal-cough` |
| 彎腰呼吸困難 | `bendopnea` |
| 近期體重增加（自述） | `reported-weight-gain` |

### 3.4 理學徵象七項：每題一個欄位

相同 store；建議 `fieldId = sign--{term}`，同樣保留有／無／未評估／未填／撤回。

| 顯示欄位 | master term |
|---|---|
| 肺部濕囉音 | `rales` |
| 頸靜脈怒張 | `jvp` |
| 凹陷性水腫 | `pitting-edema` |
| 第三心音 | `third-heart-sound` |
| 肝頸反流 | `hepatojugular-reflux` |
| 腹水 | `ascites` |
| 肝腫大 | `hepatomegaly` |

「自述腳腫」與「檢查發現凹陷性水腫」是兩個不同輸入，不能合併；自述體重增加亦不是體重數值。舊版群組按鈕只作一次操作的快捷入口，不另保存第三份群組答案。群組寫入幾個 term，就對實際改變的 term 追加幾筆事件；已無法辨識的舊群組資料不能推定每題都由醫師個別確認。

## 4. 已有介面：HF 懷疑、LVEF 與 HFpEF 確認

來源：`PhenotypeAnswer`。

| 顯示欄位 | master key | 建議 fieldId | 保存值 |
|---|---|---|---|
| 是否懷疑 HF | `hfSuspicion` | `hf-suspicion` | `suspected`／`not-suspected` |
| 已知 LVEF 分型回答 | `choice` | `lvef-phenotype` | `reduced`／`preserved`／`unknown` |
| 人工 LVEF 與檢查日期 | `lvef`＋`measuredOn` | `lvef` | 數值 %＋原檢查日期 |
| HFpEF 確认回答 | `hfpEfConfirmed` | `hfpef-confirmation` | `true`＝確認；`not-assessed`＝暫不確認 |

- 新的 LVEF 與分型各自保存日期；同一表單內的 choice、LVEF、檢查日作一個原子操作，清除 choice 或不再適用的人工 LVEF 時須明列撤回欄位，不能殘留不一致的答案。
- master 的 `modifiedAt.phenotype` 目前同時代表 choice／LVEF／檢查日期。舊資料拆成新欄位時只保留「來源整組最後修改時間」，不宣稱能還原各欄實際修改日；新操作起才有各欄精確歷程。
- `answeredOn` 仍為 adapter 相容資料；不得代替所有欄位的 modifiedAt。
- 型別仍接受舊 `hfpEfConfirmed=false`。不能自動把它翻成「排除 HFpEF」或猜成新的明確回答；保留原始值與來源版本，標為需確認的舊答案。新 UI 的「暫不確認」沿用 `not-assessed` 語意。

## 5. 已有介面：HFpEF 人工心超補填

來源：`HfpefInputs.entries[key]`，master 目前保存字串值＋可選 measuredOn＋modifiedAt。真正可編輯的是下列 **11 項**，不是計算機出現的每個欄位。

| 顯示欄位 | master key | 建議 fieldId | 標準單位 |
|---|---|---|---|
| 平均 E/e′ | `averageEe` | `echo-average-e-over-e-prime` | 比值 |
| 二尖瓣 E 波速度 | `e` | `echo-mitral-e-velocity` | cm/s |
| Septal e′ | `septalE` | `echo-septal-e-prime` | cm/s |
| Lateral e′ | `lateralE` | `echo-lateral-e-prime` | cm/s |
| TR peak velocity | `trv` | `echo-tr-vmax` | m/s |
| PASP／RVSP | `pasp` | `echo-pasp-rvsp` | mmHg |
| GLS（絕對值） | `gls` | `echo-gls-absolute` | % |
| LAVI | `lavi` | `echo-lavi` | mL/m² |
| LVMI | `lvmi` | `echo-lvmi` | g/m² |
| RWT | `rwt` | `echo-rwt` | 比值 |
| 最大 LV 舒張末期壁厚 | `wall` | `echo-lv-wall-thickness` | mm |

新契約將數字字串依規格正規化；例如 `11` 與 `11.0` 在數值、單位及日期相同時不算臨床內容修改。保存前仍需逐欄型別／範圍驗證，不能因 store 接受任意 string key 就開放後端任意寫入。

`averageEe` 可提供 H₂FPEF 的 `ee`；這是來源映射，不存兩份獨立人工值、也不新增第二筆人工事件。PASP／RVSP 與壁厚保留實際報告量名／來源；未來拆成更細欄位時不能猜測舊值是哪一種。

### 必須同時處理的日期與來源問題

1. `HfpefInputsDialog` 目前套用時以 `todayIsoDate(now)` 作 measuredOn，沒有真正檢查日控制。接入儲存時應保留原來源日期或讓醫師填檢查日；未知就標未知，修改日另記。
2. 目前人工 override 優先於自動帶入。跨次沿用後必須比較來源版本／日期；有更新報告時，呈現人工舊值並標示需核對，不讓舊 override 無條件蓋過新報告。不能因 master 的 session 行為直接套到永久保存。
3. 清空補填＝撤回人工 override；本次有效值可回到當下報告，來源標示切回報告。雲端保存 tombstone，後續不可復活前次人工值；不禁止合法報告值回填。
4. 自動帶入、開啟計算機、切換 HFA-PEFF／H₂FPEF 分頁，不產生人工事件。

### 有顯示／參與計算，但這個 CDSS 補填介面目前不能編輯

`rhythm`、`ntprobnp`、`bnp`、`bmi`、`age`、`sex`、`af`、`antihypertensives`、`ee`。其中 `ee` 可接受 averageEe 的映射，BMI 可由門診身高體重衍生。不能把 `physicianRhythm` fact 名稱或計算機底層支援誤認為已有 CDSS 手動心律按鈕。

NT-proBNP 的相關入口目前會定位到對應處置列，不是立即下單；跳轉點擊不保存成 `ordered`。只有醫師在處置列真正選擇的回答才保存。

## 6. 已有介面：處置、理由、備註

來源：`PhysicianDecisionMap[moduleId]`。master 已有資料，不再列為整套待新增功能。

| 保存子欄位 | 目前內容 | 新契約處理 |
|---|---|---|
| `decision` | `prescribed`、`dose-adjusted`、`contraindicated`、`deferred`、`patient-preference`、`ordered` | `decision--{targetId}--kind`，按語意目標保存 |
| `reasons` | `high-potassium`、`symptomatic-hypotension`、`low-egfr`、`bradycardia`、`patient-refused`、`cost`、`other` | `decision--{targetId}--reasons`；無序集合正規化、去重，相同選項換順序不算修改 |
| `note` | 自由文字；調藥內容目前寫在此處 | `decision--{targetId}--note`；以 UI 已套用／儲存為事件邊界 |
| `recordedAt` | 每次 recordDecision 都更新 | 新資料改為各子欄 modifiedAt；整列最後更新可由最大時間求得，不回寫到未變欄位 |
| `packVersion`、`moduleId` | 當時規則版本、目前 recommendation key | 保存為來源 metadata；另由 manifest 明確對應穩定 targetId |

更改理由不能把 1/1 選的處置重設為 4/1；改備註也不能改處置／理由的原日期。一次決策操作用同一 operationId 原子提交有變更的子欄。清除整列時保留各欄撤回事件；未修改的欄位不補假歷史。

目標映射必須列到實際 recommendation，不只四大支柱，也包含檢驗及其他可處置模組。畫面列改名／合併／拆分只更新 adapter；無法無損對應的舊 module 紀錄保留為「舊版處置」，不可硬套在新的建議上。目標鍵不能直接拼任意外來字串成 Firestore 路徑。

master 的處置目前不重新輸入臨床 pack，也不是實際醫囑。跨次回填不能因此宣稱患者仍服用、檢查已執行、藥物已開立到 HIS，或讓新出現缺口永久消失。

## 7. 證據切換與結果摘要

證據選擇保存 `enabled`／`disabled`／撤回至預設，以及語意 criterionId、原 itemId、來源指紋、原來源日期、規則版本、modifiedAt。恢復預設不等於明確選擇 enabled；itemId 相同但來源報告不同時不能盲目沿用。規劃使用 `evidence--{stableCriterionId}--{sourceFingerprint}`，由 manifest 與經驗證編碼建立，不直接使用任意 itemId 作永久鍵。

每日結果摘要與輸入分開。最低追溯內容包括 HF 判讀、兩種 HFpEF 分數／已知下限與缺項、分數來源、calculatorVersion、packVersion、使用欄位 revision、評估時間與有限的來源參照。分數是計算結果，不是醫師手填答案，不新增人工修改事件。只存有限依據不能宣稱完整重現原始 Bundle 的全部計算。

看診流程完成度、下一步、待辦數量由當前輸入重算；不能直接保存成永久「已完成」。`followUpNote` 目前由 recommendation 推導，並非獨立的醫師追蹤計畫輸入；若後續加入可編輯追蹤日期／計畫，另建語意欄位。

## 8. 之前建議的其他輸入：保留擴充，不誤列為 master 已有

| 輸入 | master 現況／後續方向 |
|---|---|
| 手動評估時心律、AF 病史 | 計算機有讀取路徑，CDSS 尚無直接編輯；兩者分開 fieldId 與觀察日期 |
| K、Na、eGFR、NT-proBNP／BNP 人工補值 | 目前門診表單限定六項量測，心超 dialog 不開放檢驗值；後續加 shared measurement 契約與來源／日期 |
| 實際服藥、劑量、頻次、暫停／停用 | 現有 prescribed／dose-adjusted 只是處置，劑量未完整結構化；需獨立 medication-state 欄位 |
| 最高可耐受劑量、分藥不耐受 | 現有理由不是每種藥物的長期耐受事實；另設按藥物／類別的欄位 |
| 乾重、容量判斷、利尿反應 | 原型曾示意，但不在 master 的六項 entries／問答 store；後續新增 |
| 追蹤日期、追蹤計畫、病人意願詳情 | 現有處置理由／備註可保存；新的結構化資料仍需新欄位與真正操作接線 |

先完整保存目前實際可操作的欄位；已同意新增的欄位保留在擴充清單，正式加入時提升 inputSchemaVersion，不把未輸入值補成無、正常或已完成。

## 9. Firebase 與共用服務修訂

| 工作 | 需如何調整 |
|---|---|
| 病人對應 | 沿用帳號專用 HMAC 比對＋隨機 patientRef；四個 cache 和 evidence 全接同一 resolver，不各自使用匯入 patient.id |
| 目前狀態 | 新增 `currentScopes/{scopeId}/fields/{fieldId}`，逐欄跨日 revision；最新日期沒改過 HF 時仍找得到 HF |
| 每日狀態 | `days/{Asia/Taipei YYYY-MM-DD}/scopes/{scopeId}/fields/{fieldId}`；同日只存最新狀態，含撤回欄位；scope 首次快照需完整且原子建立 |
| 直接修改歷程 | `events/{eventId}`；逐欄 before／after，按 fieldId 查詢；同一天改十次仍保留十次有效修改 |
| 重送去重 | `commits/{operationId}` 保存請求摘要與結果；成功後斷線重送不重複事件，同 ID 不同內容拒絕 |
| Rules／Functions | 使用 `mediprisma`，精確 owner-only 讀取；client 不直接寫 state／events；後端驗證真實登入、App Check、欄位與版本 |
| HFpEF／處置驗證 | whitelist 11 個可編輯心超鍵與數值單位；處置／理由使用已定義選項，備註限制長度；後續新增需版本化 |
| 事件佇列 | 沿用加密技術，但獨立可靠 outbox。現有 cache 的最後寫入勝出機制不能代替逐次事件保存 |
| 初次載入 | 讀取 current baseline 時可先收集本地 patch，完成後逐欄 rebase；不能像 session cache 一樣因記憶體有任意新值，就略過整位病人的其餘舊資料 |
| 登出／切病人 | session cache、載入 token、訂閱、記憶體均以 uid＋patientRef 隔離；clear UI cache 不等於清除雲端歷史；登入後不自動認領登入前的資料 |
| 索引／刪除 | 新增欄位歷程查詢索引、每日列表；清理 patient 時一併處理 current、commits、events、days 與 aliases |

Firebase 原始設定已只讀核對於 `../firebase-smart-on-fhir` 本機 commit `327dd62a34161b09972860a4cb555028dcdef1db`；其 Rules／indexes 尚未有 CDSS 路徑。尚未 fetch 該 repo、未核對線上權限；正式實作需先固定它的最新來源。

舊 `phenotype-answer.firestore.ts` 只提供單一 load/save/clear 接縫；可作 compatibility adapter，但仍需共用訂閱、hydration、revision 與 outbox。只把這個檔案接 Firestore，無法同步另外四類輸入。

## 10. 這次新增的必要驗收

1. 同一病人在 flow、board、證據表修改同一題，讀到相同值／日期；版面切換不追加事件。
2. 六項量測、九項症狀、七項徵象、NYHA、代償、四個分型欄位、11 項心超、所有實際可操作處置與 evidence 都有對應欄位。
3. 「還沒問」「有」「無」「明確未評估」「撤回」互不混淆；HFpEF 暫不確認不是排除診斷。
4. 1/1 選處置、2/1 改理由、4/1 改備註，三個子欄各留自己的日期及完整歷程；原值儲存不改日期。
5. 心超 1/1 檢查、4/1 補填，分別呈現檢查日與修改日；不知道檢查日時不自動標今天。相同數字、不同真實檢查日仍是有效修改。
6. averageEe 同時供兩種分數使用，只記一個人工值；自動計算 BMI、分數變化不新增醫師事件。
7. 撤回心超人工值後回到當前報告；下一次不復活撤回的人工值。新報告出現時，舊覆寫需依來源政策重新確認。
8. 另一 CDSS 在最新一天有修改但 HF 沒修改，回診仍載入 HF 舊值與原日期；共享量測只存一份語意輸入。
9. 一次點按修改數個 term、連續切理由或清除再填，都不被 cache 合併成只剩最後一筆；未套用草稿不寫入。
10. 雲端還原途中先填 NYHA，讀取完成後保留新的 NYHA 與其他舊欄位；讀取失敗不能被當成空資料成功，不能覆蓋雲端。
11. 相同內容處置重存、理由集合只換順序、心超 `11` 改寫成 `11.0` 不產生假修改；真正修改日期／來源則留下事件。
12. 台灣跨午夜、兩裝置首次建當日快照、前一日離線晚到及舊 revision 重送皆不覆蓋新狀態，也不把前一日事件改歸隔日。
13. 當前 cache 只可匯入可解密且病人／帳號歸屬已確認的資料；舊整組時間、舊 recordedAt、心超可能錯置的檢查日均標出來源限制，不補造更早修改歷程。
14. 舊版讀到新欄位、停用項目或未知 module 對應時保留資料；更新版本不把未知欄位刪除，不把舊歷史變成今天的新修改。

## 11. 固定來源位置

下列連結均固定至本次核對的 App SHA，避免誤連到目前仍有其他修改的工作目錄。

- [門診量測／問答與局部更新](https://github.com/MediPrisma/mediprisma-app/blob/1c17761f4a12712efc0d8f9a74afeffced846770/features/clinical-decision-support/stores/clinic-vitals.store.ts)
- [分型回答與三組修改時間](https://github.com/MediPrisma/mediprisma-app/blob/1c17761f4a12712efc0d8f9a74afeffced846770/features/clinical-decision-support/stores/phenotype-answer.store.ts)
- [HFpEF 補值儲存](https://github.com/MediPrisma/mediprisma-app/blob/1c17761f4a12712efc0d8f9a74afeffced846770/features/clinical-decision-support/stores/hfpef-inputs.store.ts)
- [真正可編輯的心超鍵、分數版本與來源映射](https://github.com/MediPrisma/mediprisma-app/blob/1c17761f4a12712efc0d8f9a74afeffced846770/features/clinical-decision-support/utils/hfpef-scores.ts)
- [補填視窗目前的檢查日行為](https://github.com/MediPrisma/mediprisma-app/blob/1c17761f4a12712efc0d8f9a74afeffced846770/features/clinical-decision-support/renderers/HfpefInputsDialog.tsx)
- [處置記錄與 recordedAt](https://github.com/MediPrisma/mediprisma-app/blob/1c17761f4a12712efc0d8f9a74afeffced846770/features/clinical-decision-support/stores/physician-decisions.store.ts)
- [症狀／徵象目錄、處置理由、紀錄摘要](https://github.com/MediPrisma/mediprisma-app/blob/1c17761f4a12712efc0d8f9a74afeffced846770/features/clinical-decision-support/renderers/heart-failure-visit-flow.ts)
- [處置點擊與備註套用邊界](https://github.com/MediPrisma/mediprisma-app/blob/1c17761f4a12712efc0d8f9a74afeffced846770/features/clinical-decision-support/renderers/HeartFailureVisitFlow.tsx)
- [證據切換仍為本機 boolean](https://github.com/MediPrisma/mediprisma-app/blob/1c17761f4a12712efc0d8f9a74afeffced846770/features/clinical-decision-support/stores/evidence-overrides.store.ts)
- [加密 session cache 與寫入去重行為](https://github.com/MediPrisma/mediprisma-app/blob/1c17761f4a12712efc0d8f9a74afeffced846770/src/application/services/encrypted-answer-cache.service.ts)
- [目前 Firestore 接縫仍未實作](https://github.com/MediPrisma/mediprisma-app/blob/1c17761f4a12712efc0d8f9a74afeffced846770/features/clinical-decision-support/stores/phenotype-answer.firestore.ts)
