# 個人化照護與衛教：私有套件架構

## 目標架構

主程式只負責把 FHIR 資料轉成標準輸入、註冊 Pack、顯示結果；臨床規則與衛教內容由私有 npm 套件提供。

```text
FHIR 病歷
  -> 主 repo：CdssPatientProfile / PatientEducationContext
  -> 私有套件：ClinicalGuidelinePack / DiseaseEducationPack
  -> 主 repo：CdssResult / EducationPlan 畫面
```

## 目前已完成的邊界

- `@voho0000/personalization-sdk`：共用 Pack 契約、契約版本、Zod 驗證、來源紀錄與一致的錯誤格式。
- `registerCarePacks(...)`：照護 Pack 的唯一註冊入口。
- `registerEducationPacks(...)`：衛教 Pack 的唯一註冊入口。
- 主程式 UI 與 engine 不直接依賴某一個疾病規則，只向 Registry 取 Pack。
- 同一個 Pack ID 不可由不同來源悄悄覆蓋，避免臨床邏輯在建置時被意外替換。

## 私有套件拆分

目前由 private repository `voho0000/mediprisma-personalization` 管理五個 npm packages：

```text
mediprisma-personalization (private repository)
  packages/
    personalization-sdk/        # @voho0000/personalization-sdk
    personalized-care/          # @voho0000/personalized-care
    personalized-care-fhir/     # @voho0000/personalized-care-fhir
    clinical-lab-normalization/ # @voho0000/clinical-lab-normalization
    personalized-education/     # @voho0000/personalized-education
```

`personalized-care` 包含 `guideline-packs`、`knowledge-packs`、`risk-stratification` 與規則使用的 clinical modules。`personalized-education` 包含 `disease-packs`。FHIR adapter 由 `personalized-care-fhir` 提供；React 畫面與共用 UI 留在主 repo。共用檢驗由 `clinical-lab-normalization` 提供，公開部署另保留公開來源的替代實作。

## 主程式的最終組裝入口

主 repo 的兩個 `bundled.ts` 只做套件 re-export：

```ts
export {
  CARE_PACKS as BUNDLED_CARE_PACKS,
  DEFAULT_CARE_PACK_ID,
} from '@voho0000/personalized-care'
```

```ts
export {
  EDUCATION_PACKS as BUNDLED_EDUCATION_PACKS,
} from '@voho0000/personalized-education'
```

規則原始碼已從主 repo 移除，僅保留套件註冊、FHIR adapter、React 畫面與型別 facade。

## Registry 與 CI 設定

repo 提交的 `.npmrc` 不含憑證；開發者與 CI 由 `NODE_AUTH_TOKEN` 提供 token。token 至少需要 `read:packages`，發布流程另外需要 `write:packages`。

```ini
@voho0000:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

主 repo 的 `package.json` 固定精確版本，不使用 `latest`：

```json
{
  "optionalDependencies": {
    "@voho0000/clinical-lab-normalization": "1.1.1",
    "@voho0000/personalization-sdk": "1.0.0",
    "@voho0000/personalized-care": "2.14.0",
    "@voho0000/personalized-care-fhir": "1.9.13",
    "@voho0000/personalized-education": "1.4.1"
  }
}
```

院內離線版在建置階段下載套件，產出的靜態檔已包含規則，執行時不需要連外。

公開主 repo 的 GitHub Actions 應設定 repository secret `PACKAGES_TOKEN`，其內容使用只具 `read:packages` 的 token。工作流程只在 `npm ci` 階段把它映射成 `NODE_AUTH_TOKEN`，不寫入檔案或 log。

## 無私有 repo 權限的安裝與部署

主 repo 沒有私有 Git submodule，也不在安裝時 clone 另外兩個 repo。
五個 `@voho0000` 套件均列於 `optionalDependencies`；沒有 token 或沒有套件權限時，`npm ci` 會略過它們。`packages:ci`／`packages:install` 可使用既有 `NODE_AUTH_TOKEN` 或 GitHub CLI 憑證，但不要求登入才能繼續。

- SDK to FHIR：主 repo 已提交 SDK browser artifact，無需 NHI-FHIR-BRIDGE repo 權限。缺少 `vendor/nhi-fhir-bridge-sdk-json/browser.js` 或其宣告時，建置改用只接受 FHIR Bundle 的 parser，SDK JSON 匯入明確回報不可用。
- CDSS：僅當 SDK 契約、照護規則、FHIR adapter 及檢驗套件的 entrypoints 均可解析時才顯示。其餘環境不顯示照護指引與試辦 pack 控制，不用空白規則假裝完成評估。
- 共用檢驗：缺少私有套件時使用主 repo 公開歷史 `80c3a767c^` 的名稱／來源異常判讀函式。沒有複製私有 repo 的新規則；報告、累積表、AI 與計算機保持可建置。
- 個人化衛教：套件未安裝時保留原有 Beta／民眾入口，明示內容尚未安裝；套件可用時保留完整衛教。

Next.js 同時為 Turbopack、webpack 與 TypeScript 選取相同模組，生成的 `tsconfig.optional.generated.json` 不提交。SDK 與 CDSS availability 只取決於建置時 artifact／package 狀態，不以 route、角色或登入替代套件權限。

```bash
npm ci
npm run typecheck
npm run build
# 或 npm run build:gh / npm run build:mediprisma
```

私有臨床規則／串接測試須在完整套件環境執行；一般匯入、報告與計算機測試可在公開環境執行。`npm run test:optional` 核對安裝與模組選取；兩個建置模式都應驗證。

## 本機開發（完整私有功能）

若要使用完整私有功能，先確認 GitHub CLI 已登入具有私有套件讀取權限的帳號：

```bash
gh auth login -h github.com
```

接著使用專案提供的安全安裝指令：

```bash
npm run packages:install
```

若要模擬 CI 的乾淨安裝：

```bash
npm run packages:ci
```

這兩個指令只在 npm 子行程執行期間，把目前的 GitHub CLI 登入憑證放入 `NODE_AUTH_TOKEN`；不會把 token 寫入 `.npmrc`、shell profile、repo 或 log。安裝完成後，`npm run dev`、`npm test`、`npm run build` 都不需要再次提供 token。

## 臨床發布要求

每次發布至少保留：

- 套件與各 Pack 的語意化版本。
- 指引來源、適用版本與有效日期。
- 變更紀錄、審核人、審核日期與發布日期。
- golden cases 與回歸測試結果。
- 可重新建置及回復的舊版 package。

若規則本身必須對瀏覽器使用者保密，不能把規則包入前端；必須改成院內後端服務，前端只接收 `CdssResult` 或 `EducationPlan`。私有 npm 套件能避免原始碼進入主 repo，但建置進瀏覽器後的 JavaScript 仍可被檢視。
