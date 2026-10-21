# 醫析 MediPrisma · SMART on FHIR

**把跨院病歷整理成看得懂、查得到來源、能接續照護的臨床工作區。**

MediPrisma 整合就診、用藥、檢驗與臨床文件，提供來源可回查的 AI 摘要、臨床對話與報告解讀。支援醫療人員與民眾兩種閱讀方式，可從 SMART on FHIR 啟動，也能直接匯入本機資料。

[開啟 MediPrisma](https://mediprisma.tw/app) · [GitHub Pages](https://voho0000.github.io/medical-note-smart-on-fhir/) · [文件索引](docs/README.md) · [協作指南](CONTRIBUTING.md) · [English](#english)

> 功能核對：2026-09-08，依 v0.51.0 與目前 `master` 已提交的實作整理。登入及機構設定會影響可用功能。
>
> 本專案供研究與教學使用，非醫療器材。AI 與規則產出的內容供參考，臨床決策仍須由醫療人員確認。

## 先試用，再接自己的資料

1. 開啟 [App](https://mediprisma.tw/app)，選擇醫療人員或民眾身份。
2. 載入內建示範病人，或匯入自己的 FHIR Bundle／健康存摺 SDK JSON。
3. 從「醫療摘要」掌握重點，再查看原始報告、提出問題或套用摘要範本。

## 主要功能

### 病歷與報告：把資料放回時間與來源中

- **五個資料分頁**：病人資訊、就診紀錄、報告、用藥與文件，集中閱讀跨院資料。
- **累積檢驗報告**：依類別呈現跨日期數值，支援日期範圍、全部日期與類別快速跳轉；標準化檢驗名稱，並保留原始結果文字。
- **臨床報告閱讀**：整理影像、病理、出院病摘等內容；同份報告的相關項目可合併呈現，保留原文供核對。
- **AI 翻譯與解讀**：按需產生中文翻譯與白話說明，與原文對照閱讀。

### 醫療摘要：先看到病程、風險與待確認事項

醫療摘要是載入病人後的預設分頁，整理跨院病程、主動安全提醒、待決定事項、時間軸與資料涵蓋情形。摘要中的來源引用可回查 FHIR 資源；無法對應的引用會標示為未驗證。

- 醫療人員版著重臨床重點；民眾版調整用語，並提供「我的用藥與照護」。
- **自訂摘要模組**可新增、排序、隱藏、手動執行或設定自動生成，也可從提示範本庫加入。
- 透過 **AI 資料範圍**選擇並預覽摘要使用的病歷內容。
- 摘要結果提供展開閱讀與使用引導；生成結果可快取，減少重複請求。

### 臨床對話：依問題查資料、接續追問

- 支援 Agent 工具呼叫，按需查詢病人、診斷、用藥、過敏、檢驗、生命徵象、處置與就診資料。
- 支援透過 Perplexity 搜尋醫學文獻；是否可用取決於所選模型與服務設定。
- 輸入 `/` 套用提示範本，回答後可點選建議問題繼續追問。
- 支援 Whisper 語音口述、一般對話歷史與無痕對話。
- 可選內建模型、自備 API 金鑰，或連接院內／地端 OpenAI-compatible 端點。

### 提示範本庫：讓常用工作可以重複使用

範本可用於臨床對話、自訂摘要，或同時支援兩者。

- 依用途、專科、受眾、分類與關鍵字尋找範本；桌面以表格瀏覽，手機以卡片呈現。
- 支援系統範本、我的範本、收藏與最近使用。
- 預覽提示內容及已提供的輸出範例，套用需要填寫欄位的範本。
- 登入後可分享、管理自己的範本及收藏。
- **科常用範本**依機構／科別成員資格顯示，發布與管理依權限開放。

### 計算、匯出與個人設定

- **醫療計算機**：10 類、58 個臨床評分與公式，包括 eGFR、KFRE、CHA₂DS₂-VASc、Child-Pugh、CURB-65；可依病人檢驗自動帶入支援的數值，附使用說明並可複製結果。
- **IPS 匯出**：建立 International Patient Summary FHIR 文件與 Markdown 預覽；AI 推論的問題清單須逐項確認後才納入。
- **閱讀設定**：中英文、深色模式、字級、響應式版面與功能分頁釘選；醫療人員／民眾身份可切換。

## 資料如何進來

| 來源 | 使用方式 |
|---|---|
| SMART on FHIR | 由 EHR 啟動或 standalone launch，使用 OAuth 2.0 與 PKCE 讀取授權範圍內的 FHIR 資料 |
| 本機 FHIR Bundle | 匯入 `.json`，在瀏覽器中讀取與整理 |
| 健康存摺 SDK JSON | 在瀏覽器轉換為 FHIR，保留轉換來源資訊；SDK JSON 轉換上限為 32 MB |
| 示範病人 | 不需準備檔案即可體驗內建去識別化範例，包含臨床報告 |
| Medcloud 整合 | 配合擴充套件交接資料並執行自動摘要；需要對應的整合環境 |

## AI 服務與資料隱私

AI 功能需要可用的服務設定與網路連線。內建代理提供每日額度；自備金鑰與自訂端點可在設定中管理。對話、醫療摘要與自訂摘要模組可分別選擇模型。

目前整合 **OpenAI、Google Gemini、Anthropic Claude** 與 **OpenAI-compatible** 端點，文獻搜尋與語音轉錄另有服務設定。模型、免費代理資格及各功能預設值以 [模型清單](src/shared/constants/ai-models.constants.ts) 為準；實際可用性也取決於後端允許清單、額度及提供者狀態。

| 資料 | 儲存與傳送方式 |
|---|---|
| 本機匯入的完整病歷 | 以 AES-GCM 加密存於瀏覽器 IndexedDB，最長 12 小時；過期於載入時清除，也可手動清除或登出清除 |
| AI 請求 | 所需病歷內容會傳送至選定服務；內建代理經 Firebase Functions，自訂端點可選瀏覽器直連或受限 Gateway |
| API 金鑰 | 預設僅保留於本次瀏覽工作階段；可自行選擇在裝置記住。Gateway 模式下，自備金鑰也會經過代理 |
| 一般對話 | 登入且非無痕時，文字對話儲存於 Firestore；訪客與無痕對話不寫入雲端歷史 |
| 範本與設定 | 部分登入使用者資料可同步；分享範本的內容依公開或科別權限供他人閱讀 |
| 使用統計 | 官方部署啟用 GA4，記錄功能使用事件；不記錄病歷內容、提示詞、AI 回覆或完整啟動網址，使用隨機瀏覽器識別值估算使用情形 |

自訂模型的 Agent 模式通常須先通過使用合成資料的工具呼叫測試，且只取得瀏覽器綁定的 FHIR 工具。北榮受控啟動的院內模型採專用設定；機構憑證不會套用到一般外院路徑。

清除本地資料不會一併刪除雲端對話或第三方已收到的請求。詳見 [隱私政策](PRIVACY_POLICY.md) 與 [安全說明](docs/SECURITY.md)。

## 開發與部署

### 本機啟動

建議使用 **Node.js 24**（與 CI 一致）、npm 與 GitHub CLI。部分 `@voho0000/*` 套件來自 GitHub Packages，需要具有套件讀取權限的 GitHub 帳號。

```bash
git clone https://github.com/voho0000/medical-note-smart-on-fhir.git
cd medical-note-smart-on-fhir

npm ci
cp .env.example .env.local
npm run dev
```

不需要 clone 私有 repo 或登入 GitHub 就能安裝、開發與建置。私有 CDSS 套件未安裝時，照護指引入口不顯示；FHIR 匯入、示範資料、報告、AI 摘要與計算機仍可使用。SDK JSON 轉換器已附於 `vendor/`，不需要 SDK repo 權限；若部署未包含這份 artifact，僅接受 FHIR Bundle。個人化衛教內容也由私有套件提供，缺少時保留入口並顯示尚未安裝，不會產生替代建議。

需要完整私有功能的開發者可先 `gh auth login -h github.com`，再執行 `npm run packages:ci`。參見 [套件與權限說明](docs/personalization-private-packages.md)。

開啟 [localhost:3001](http://localhost:3001)。依 [`.env.example`](.env.example) 填入 Firebase、AI 代理與 SMART 設定；登入、雲端同步、免費代理等功能需要對應後端。

`NEXT_PUBLIC_` 變數會進入瀏覽器程式，不能用來保存私密金鑰。自架環境的 Firebase Functions 與 Firestore Rules 在獨立的 [firebase-smart-on-fhir](https://github.com/voho0000/firebase-smart-on-fhir) 專案維護。

### 常用指令

| 指令 | 用途 |
|---|---|
| `npm run dev` | 本機開發，port 3001 |
| `npm run build` | Next.js 正式建置 |
| `npm run build:gh` | GitHub Pages 靜態匯出，base path `/medical-note-smart-on-fhir` |
| `npm run build:mediprisma` | 官網靜態匯出，base path `/app` |
| `npm run lint` | 程式檢查 |
| `npm run typecheck` | 依已安裝套件檢查型別；完整環境仍涵蓋測試 |
| `npm test` | Jest 單元與元件測試 |
| `npm run test:e2e` | Playwright 瀏覽器測試，準備方式見 [E2E 文件](e2e/README.md) |
| `npm run check:lockfile` | 檢查跨平台 lockfile 完整性 |

**依賴維護**：現有套件版本更新使用 `npm run bump:dep -- <package> <version>`；新增／移除或更動依賴樹時使用 `npm run packages:install` 及對應包裝腳本，避免直接 `npm install` 遺失 Linux 所需的 lockfile 項目。詳見 [AGENTS.md](AGENTS.md)。

`master` 的程式變更通過 CI 後，工作流程會部署 GitHub Pages，並在同步憑證已設定時更新 `mediprisma.tw/app`。純 Markdown／文件變更會略過主 CI。靜態網站的安全 response headers 須由託管平台設定，不能依賴 Next.js `headers()`。

### SMART on FHIR 註冊

以 **public client + S256 PKCE** 註冊；本專案不使用 client secret。以下 `<app-url>` 必須包含部署的 base path，例如 `https://mediprisma.tw/app`。

| 項目 | 值 |
|---|---|
| Launch URL | `<app-url>/smart/launch` |
| Redirect URL | `<app-url>/smart/callback` |
| EHR launch scopes | `launch openid fhirUser patient/*.rs online_access` |
| Standalone scopes | `launch/patient openid fhirUser patient/*.rs online_access` |
| Client ID | `NEXT_PUBLIC_SMART_CLIENT_ID`，預設 `my_web_app` |

可用 [SMART Health IT Launcher](https://launch.smarthealthit.org/) 搭配 GitHub Pages Launch URL 測試：

```text
https://voho0000.github.io/medical-note-smart-on-fhir/smart/launch
```

### 技術與擴充位置

採用 **Next.js 16、React 19、TypeScript、Tailwind CSS 4、shadcn/ui、Vercel AI SDK、fhirclient、Firebase、TanStack Query 與 Zustand**；以 Jest／Testing Library 與 Playwright 驗證。

```text
app/ · features/ · components/   頁面與功能介面
src/application/                使用案例、資料流程與服務組裝
src/core/                       領域模型與介面
src/infrastructure/             FHIR、AI、儲存與外部服務
src/shared/                     共用設定、模型清單與多語系
```

- 資料分頁：[feature-registry.ts](src/shared/config/feature-registry.ts)
- 主功能與受眾設定：[right-panel-registry.ts](src/shared/config/right-panel-registry.ts)
- AI 模型與服務組裝：[模型清單](src/shared/constants/ai-models.constants.ts)、[composition.ai.ts](src/application/composition.ai.ts)

修改介面前請閱讀 [DESIGN.md](DESIGN.md) 與 [AGENTS.md](AGENTS.md)。完整文件由 [docs/README.md](docs/README.md) 進入，包含架構、AI Agent、對話、範本庫、安全與測試說明。

## English

**MediPrisma brings cross-facility records into a clinical workspace with source-linked AI summaries, conversations, and report explanations.** It supports healthcare-professional and patient views, SMART on FHIR launch, local FHIR Bundles, and Taiwan Health Bank SDK JSON imports.

[Try the app](https://mediprisma.tw/app) · [GitHub Pages](https://voho0000.github.io/medical-note-smart-on-fhir/) · [Documentation](docs/README.md)

Feature review: **September 8, 2026**, based on v0.51.0 and committed changes on `master`. For research and education; not a medical device. Outputs require clinical review.

### What you can do

- **Read the record:** patient details, encounters, reports, medications, and documents; cumulative laboratory results with date filtering, standardized names, and original result text.
- **Start with a medical summary:** cross-facility history, safety reminders, pending decisions, timeline, and source references. Add reusable custom summary modules and select the data supplied to summaries.
- **Ask clinical questions:** an AI agent can query FHIR resources on demand, with medical-literature search where supported. Prompt shortcuts, follow-up suggestions, voice dictation, and temporary conversations support repeated work.
- **Reuse prompts:** browse, filter, favorite, preview supplied example outputs, fill template fields, and revisit recently used templates. Department templates require membership and publishing permissions.
- **Calculate and export:** 58 clinical calculators across 10 categories, supported laboratory auto-fill, and IPS FHIR export with a Markdown preview. AI-inferred problems require confirmation before inclusion.
- **Adjust the workspace:** clinician/patient audience, Chinese/English interface, dark mode, font size, and pinned feature tabs.

### Data and AI

Local imports are converted and stored in the browser; the full stored Bundle is AES-GCM encrypted with a maximum 12-hour lifetime. **AI features send the required record content to the selected service.** Built-in requests may pass through Firebase Functions; custom OpenAI-compatible endpoints support direct browser access or a restricted gateway. Keys are session-scoped by default, with an optional remember setting.

Signed-in regular text conversations are stored in Firestore; guest and temporary conversations are not. Official deployments collect allow-listed GA4 usage events without record content, prompts, AI answers, or full launch URLs. Clearing local data does not delete cloud history or data already sent to providers. See the [privacy policy](PRIVACY_POLICY.md) and [security notes](docs/SECURITY.md).

The app integrates OpenAI, Gemini, Claude, and custom OpenAI-compatible models. The [model catalog](src/shared/constants/ai-models.constants.ts) defines selectable models and defaults; backend configuration and quotas determine actual availability.

### Development

Use Node.js 24 and a GitHub CLI account with access to the project's GitHub Packages. Clone the repository, run `gh auth login -h github.com`, then `npm run packages:ci`. Copy [`.env.example`](.env.example) to `.env.local`, configure the required services, and run `npm run dev` at port 3001.

Use `npm run build:gh` or `npm run build:mediprisma` for static exports. Register SMART as a public client with S256 PKCE; launch and callback URLs must include the deployment base path. Dependency changes should follow [AGENTS.md](AGENTS.md) to preserve cross-platform lockfile entries. Backend Functions and Rules live in [firebase-smart-on-fhir](https://github.com/voho0000/firebase-smart-on-fhir).

## 作者與授權 · Author & License

**郭宜欣醫師｜臺北榮總醫療人工智慧發展中心**

Yi-Hsin Kuo, MD · Taipei Veterans General Hospital

聯絡：[voho0000@gmail.com](mailto:voho0000@gmail.com)。問題與建議可透過 [GitHub Issues](https://github.com/voho0000/medical-note-smart-on-fhir/issues) 或 App 內回報功能提出。

本專案採 [Apache License 2.0](LICENSE)。作者與貢獻署名見 [NOTICE](NOTICE)。

再散布本專案或衍生作品時，請依 Apache 2.0 第 4 條提供授權副本、標示檔案修改，並保留適用的版權與署名資訊。NOTICE 中適用的署名可依第 4(d) 條保留於 NOTICE、原始碼、文件或適當的介面中。

Authorship and contributor credits are recorded in [NOTICE](NOTICE). When redistributing this project or derivative works, follow Section 4 of the [Apache License 2.0](LICENSE), including its requirements for license copies, modification notices, and applicable attribution notices.
