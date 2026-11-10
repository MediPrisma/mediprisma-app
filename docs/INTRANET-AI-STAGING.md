# 北榮 Azure 院內接線

功能由 master 的一般發布流程建置，不再手動覆蓋 app-staging。
正式 `/app` 與 `/app-staging` 的發布 workflow 均設定公開入口
`NEXT_PUBLIC_INTRANET_AI_ORIGIN=https://ai-vghtpe.mediprisma.tw`。
既有 Firebase 公開設定沿用 staging，Azure key 絕不可放進任何 NEXT_PUBLIC 變數。

只有 `/app/?site=vghtpe` 或 `/app-staging/?site=vghtpe` 顯示「GPT-6 Luna（院內）」。
缺少、不同或重複的 site 參數，以及 `/app-hmc` 都不顯示；儲存的模型選擇也不能繞過呼叫端檢查。
不另加 2048 tokens 限制；
未指定長度時由 Gateway 使用 GPT-6 Luna 原生 128,000 輸出上限，明確指定長度則沿用請求值。
Gateway 仍按輸出上限先預留費用，再依實際用量結算，月額度維持 US$200。
沿用 Firebase 匿名或登入使用者 token，直接呼叫院內 Gateway `/v1/responses`，store=false。
入口的 nginx 必須限制院內來源；瀏覽器 site 參數不構成安全邊界。
所有錯誤原路回傳，不做自動重試或 Firebase fallback，避免重複付費或繞過月額度。
Gateway 使用同一持久 SQLite 帳本，缺價格、價格過期或餘額不足會在呼叫 Azure 前拒絕。
既有 Collector v10 尚未列入 GPT-6 Luna；沿用其 `unknown` 模型值，不為本次試接修改 Collector 契約。

master CI 通過後依既有流程發布 app-staging，正式 /app 仍經既有 promotion 流程。
不修改 pilot/hmc 或它的發布流程。發布後驗證實際網站 chunk 和 deploy.json。
Chrome 提示區域網路存取時需允許 mediprisma.tw；院內來源與身分檢查仍由 Gateway 執行。
此文件是操作規範，不代表已完成部署驗收。
