# 一鍵複製現在用藥 — 實作計畫（2026-10-03）

設計畫布：https://claude.ai/artifact/4bLxVUqnrWJwnMtT29NdvJ

## 目前狀態（2026-10-05，以這段為準）

- 兩個地方有「複製｜編輯」：總覽「用藥」卡底部「在用藥分頁看全部 →」那一行右邊；**用藥分頁「使用中 (N)」標題列右邊**（在「成分名／商品名」切換之後；沒有使用中的藥時放在清單上方右側）。兩邊共用 `medications/components/MedCopyActions.tsx`，用藥分頁的來源是 `useCurrentMedCopySources`＝總覽同一個 hook（`useOverviewMeds`）配總覽預設 3 個月窗，所以**兩邊複製出的文字相同**（有測試比對）。用藥分頁不管搜尋／藥理類別篩選，都複製整份現在用藥。手機 375 寬加上名稱切換與兩位數項數仍在同一行。**帶回紀錄沒有用藥區**（放在檢驗模板旁邊很奇怪，已拿掉；`ips-export` 與 `right-panel.provider` 和 master 相同）。
- **只有一個用藥格式**：預設緊湊；「編輯」當場開編輯器改這一個，存了就是它；「從範本開始」可選緊湊／標準／完整當起點；「改回預設（緊湊）」取代刪除。沒有格式清單、名稱、新增。偏好存 `outpatientPrefs.medFormat`（單一，`null`＝緊湊），帳號同步時當一個選項合併。
- 不提供「慢箋」欄與「慢箋／一般」分組：雲端病歷沒有慢箋資料，印出來會讓人以為沒標＝不是慢箋。長期處方判斷仍是「慢箋或開 ≥ 28 天」。
- 院所照來源（藥局就寫藥局），不推測；頻次預設拆開黏在一起的代碼。
- 複製後的結果是**會自己消失的通知**（sonner toast，約 6 秒，滑鼠停留時暫停；2026-10-05 改定：不要還得自己關的回條），卡片／清單裡不再插入回條。通知寫放了幾項、哪些短期藥沒放、幾項長期處方已用完照放；按鈕「看複製內容」（跳出視窗完整顯示，不捲動）；有沒放入的短期藥時多一顆「另列一段放入／改回不放」。換病人或資料重新載入時通知立即收掉。

以下為當初的決策紀錄，部分已被上面取代。

## 已定案（郭醫師，2026-10-03）

- 總覽「用藥」卡片加一顆「複製現在用藥」：按一下就複製，不開對話框；複製後在卡片內出現回執，寫出放了幾項、哪幾項沒放、為什麼。
- 客製化放在「帶回紀錄」：新增「用藥」區，有自己的格式與編輯器；**和檢驗／檢查的「我的格式」分開存**，暫不合併。
- 卡片上是「複製｜編輯」兩顆，放在**卡片底部**「在用藥分頁看全部 →」那一行右邊（同檢驗卡「自訂」的位置；放標題列會在窄卡片擠到第二行，郭醫師不接受），回執在按鈕正上方。複製用目前的一鍵格式；編輯**當場跳出格式編輯器**（和帶回紀錄同一個），存檔即成為一鍵格式。標題列與 master 完全相同。（2026-10-05 改定：原本的 ▾ 選格式＋預覽、跳到帶回紀錄都拿掉；為此加的 `revealTab` targetId 也已還原，不改共用檔。）
- 預設一鍵格式是**緊湊**（2026-10-05 改定，原為標準）。
- 長期處方已用完仍算現在用藥，照放並在行尾標「已用完 N 天」。**長期＝慢箋或處方 ≥ 28 天**（2026-10-03 改定：雲端病歷沒有慢箋欄位，262/262 筆未標，medcloud bridge 也不產生 `courseOfTherapyType`；只有健康存摺有）。
- 標題用英文 `Current medication`。
- 民眾模式這次不做：按鈕與用藥區只在醫事人員模式出現（與既有「帶回紀錄」分頁、檢驗「帶回紀錄」按鈕的 audience 條件相同）。

## 什麼算「現在用藥」

來源是總覽用藥卡「使用中」那份清單（`OverviewMedItem.isCurrent`：還在用，或 14 天內用完），再分三類：

| 情況 | 放不放 | 標註 |
|---|---|---|
| 還在用（`!isInactive`） | 放 | — |
| 慢箋或處方 ≥ 28 天、已用完、狀態不是 `stopped` | 放 | 由「剩餘／已用完」欄決定：內建格式用「只標已用完」→ 行尾「（已用完 N 天）」；取消勾選就不寫任何天數（2026-10-05 改定，原本強制標註） |
| 處方 < 28 天且非慢箋的藥已用完，或狀態 `stopped`（明確停用） | 預設不放；格式可設「最後另列一段」 | 回執列出藥名 |

順序與卡片相同。同成分在兩家以上院所都有使用中處方時，兩行都放，不加標註。原本行尾標「（同成分，N 院）」，2026-10-13 依 owner 決定拿掉：它以院所字串計數，藥局給不同廠牌的同成分藥、或同一醫院的門診與急診，都會被算成兩院，在病歷裡造成重複用藥的假警報；是否重複用藥由醫師自己判斷。

**藥局領藥的院所（2026-10-05 定案）**：照來源寫藥局（例「益安大藥局 藥局」）。兩個來源都沒有藥局調劑的原開立院所（健康存摺藥局就醫列只有一組院所欄；雲端 `chr_hosp_id` 77/77 筆空白）。曾試過往回推開立院所並標「（推測）」（雲端三個月複製可推 71% 藥局行），郭醫師實際試用後判斷「（推測）」寫進病歷讓讀者看不懂、同一家藥局同天領的藥有的推得有的推不出更不一致，決定不推測、整段拿掉。

## 格式模型（存在 `outpatientPrefs`，只有設定、沒有病人資料）

```ts
interface MedCopyFormat {
  id: string; name: string
  numbering: 'dot' | 'paren' | 'dash' | 'none'
  fields: { id: MedCopyFieldId; on: boolean; style: string }[]   // 陣列順序＝欄位順序
  separator: 'space' | 'dot' | 'comma' | 'bar'
  title: 'full' | 'short' | 'none'        // Current medication / Med: / 不放
  titleMeta: boolean                       // 標題加日期與項數
  group: 'none' | 'institution' | 'date' | 'category' | 'chronic'
  groupHeader: 'bracket' | 'colon' | 'hash'
  hoistShared: boolean                     // 同組都一樣的院所／日期／天數／慢箋提到組標題
  endedAcute: 'omit' | 'list'
}
```

欄位：藥名（成分／商品／成分 (商品)，必備）、劑量、調整前劑量、頻次（原樣／中文）、途徑、院所、開立日（09/19／2026/09/19／115/09/19）、處方天數（28 天／28d）、慢箋（慢箋／（慢））、剩餘／已用完（只標已用完／餘 N 天／至 MM/DD；不勾＝完全不寫天數）、藥理類別。

- 頻次三種寫法（2026-10-05）：拆開代碼（預設，`QDACPO`→`QD AC PO`，拆不開的段照原樣）、照來源、中文（`QDACPO`→一天一次 飯前 口服；任何一段認不得就整串照原樣，不半翻譯）。黏在一起的代碼來自雲端病歷 `drug_fre`；**健康存摺沒有頻次欄位**。真實雲端 26 種代碼／262 筆：中文成功 98%，只剩 `ASOR`（疑似截斷的 ASORDER，不猜）。支援 QnH／QnD／QnW／QnMON。
- 內建三個：緊湊（預設）、標準、完整；`activeMedFormatId` 為 `builtin:*` 或自訂格式 id。
- 帳號同步沿用 `outpatient-prefs-sync.ts`：`medFormats` 依 id 三方合併（與 `formats` 同規則），`activeMedFormatId` 與其他單一選項同規則。Firestore 規則允許本人寫整份 user 文件，不需改 firebase repo。

## 檔案

| 檔案 | 內容 |
|---|---|
| `features/clinical-summary/overview/hooks/useOverviewMeds.ts` | 從 `useOverviewData` 原封搬出用藥段，讓帶回紀錄用同一份計算 |
| `features/clinical-summary/medications/utils/medication-copy-text.ts` | 純函式：分類、組字、分組、內建格式、頻次中文 |
| `src/application/stores/outpatient-prefs.store.ts`、`…/outpatient-prefs-sync.ts`、`use-outpatient-prefs.hook.ts` | `medFormats`、`activeMedFormatId` 與存取 |
| `features/clinical-summary/overview/components/OverviewMedsCopy.tsx` | 複製｜編輯按鈕、回執 |
| `features/ips-export/components/EmrMedsSection.tsx` | 帶回紀錄的用藥區 |
| `features/clinical-summary/medications/components/MedCopyFormatEditorDialog.tsx`＋`hooks/useMedCopyFormatEditor.tsx` | 逐欄＋分組編輯器（卡片與帶回紀錄共用），右側即時預覽 |
| `src/shared/i18n/locales/{zh-TW,en}.ts` | 字串 |

## 不做（這一版）

- 民眾模式。
- 「本院」改寫與本院排第一組：app 目前不知道哪家是「本院」，等院所參數進來再做。
- 藥局領藥的開立院所：不推測，照來源寫藥局（見上）。
- 用藥分頁工具列上的按鈕與「只複製搜尋結果」：先上總覽與帶回紀錄，看使用情形再說。
- 合併進檢驗的「我的格式」。

## 實作中發現、已處理

- **慢箋判斷原本跟著總覽時間窗變**：總覽只把窗內處方建成 rows，而「慢箋」是看同一藥的任一筆處方。demo 病人標慢箋的是較早的處方，3 個月窗全部不算慢箋、6 個月才算 → 卡片與帶回紀錄算出 7 項 vs 0 項。改為 `useMedicationRows(…, chronicHistory)` 用完整處方歷史判斷，總覽卡片的「慢箋」標籤因此在短時間窗也與用藥分頁一致（可見的變化，只多不少）。
- **▾ → 帶回紀錄的捲動被蓋掉**：`ips-export/Feature.tsx` 在 reveal 後把子分頁捲回頂端。`revealTab` 新增 `targetId`，由 Feature 捲到指定區塊並移交焦點；原本無 `targetId` 的呼叫行為不變。
- 帶回紀錄面板的預覽框與分段按鈕抽成 `EmrPanelParts.tsx`，三個區塊共用。

## 待決定（郭醫師）

- ~~非慢箋的長期藥~~：已定案為「慢箋或處方 ≥ 28 天」（雲端 262 筆：≤7 天 20%、8–27 天 6%、28–29 天 63%、≥30 天 11%）。
- **院所欄可能是藥局**：慢箋在社區藥局領藥時，來源的 requester 是藥局（demo：示範向陽藥局），卡片本來就這樣顯示，複製照印。要不要在複製時略過藥局、只寫開立院所？（app 目前無法可靠分辨，需另外判斷規則。）

## 驗證

- 單元測試：分類三種情況、慢箋用完標註、同成分兩院、每個欄位樣式、五種分組與提到組標題、頻次中文的全有或全無、偏好 sanitize／同步合併。
- 元件測試：按鈕複製後回執的數字、「另列一段放入」重新複製、剪貼簿失敗時的提示。
- `tsc`、lint、相關 jest、production build。
- 瀏覽器：demo 病人實際按過；390／768／1440 寬度；複製出來的文字貼回比對預覽。
