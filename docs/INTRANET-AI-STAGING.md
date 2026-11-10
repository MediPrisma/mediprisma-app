# 北榮 Azure 測試接線

只在獨立 `staging/azure-ai` 分支整合；不合進 master，不觸發正式 /app 或 /app-hmc 發布。
建置 `MEDIPRISMA_BASE_PATH=/app-staging`、`NEXT_PUBLIC_DEPLOY_CHANNEL=staging`、
`NEXT_PUBLIC_INTRANET_AI_ORIGIN=https://ai-vghtpe.mediprisma.tw`。
既有 Firebase 公開設定沿用 staging，Azure key 絕不可放進任何 NEXT_PUBLIC 變數。

在 `/app-staging/?site=vghtpe` 選擇「GPT-6 Luna（院內）」。每步最多輸出 2048 tokens，
沿用 Firebase 匿名或登入使用者 token，直接呼叫院內 Gateway `/v1/responses`，store=false。
入口的 nginx 必須限制院內來源；瀏覽器 site 參數不構成安全邊界。
所有錯誤原路回傳，不做自動重試或 Firebase fallback，避免重複付費或繞過月額度。
Gateway 使用同一持久 SQLite 帳本，缺價格、價格過期或餘額不足會在呼叫 Azure 前拒絕。

部署只更新 mediprisma-site 的 `static/app-staging`；發布前比對 `static/app` 與
`static/app-hmc` 的 Git tree，兩者必須不變。發布後驗證實際網站 chunk 和 deploy.json。
此文件是操作規範，不代表已完成部署驗收。
