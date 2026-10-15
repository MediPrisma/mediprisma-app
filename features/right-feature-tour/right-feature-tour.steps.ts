import type { RightFeatureTourStepId } from './right-feature-tour.store'

export interface TourStep {
  id: RightFeatureTourStepId
  target: string
  fallbackTarget?: string
  fallbackGraceAttempts?: number
  lockTargetOnceResolved?: boolean
  highlightPadding?: number
  medicalOnly?: boolean
  betaOnly?: boolean
  authenticatedOnly?: boolean
  title: { 'zh-TW': string; en: string }
  body: { 'zh-TW': string; en: string }
  fallbackBody?: { 'zh-TW': string; en: string }
}

const ALL_STEPS: TourStep[] = [
  {
    id: 'overview',
    target: '[data-tour="right-tabs"]',
    title: { 'zh-TW': '右側是臨床工作區', en: 'The right side is your clinical workspace' },
    body: {
      'zh-TW': '上方分頁依使用身份集中醫療摘要、臨床對話、計算機、複製與設定；可從設定中自行開啟 Beta 功能，不需登入。取消釘選的功能會收進「更多」選單。',
      en: 'The tabs bring together the medical summary, clinical chat, calculators, copy tools, and settings. Beta features can be enabled in Settings — no sign-in needed. Unpinned tools move into More.',
    },
  },
  {
    id: 'summary',
    target: '[data-tour="medical-summary-overview"]',
    fallbackTarget: '[data-tour="right-tab-medical-summary"]',
    fallbackGraceAttempts: 0,
    lockTargetOnceResolved: true,
    highlightPadding: 4,
    title: { 'zh-TW': '先用醫療摘要掌握重點', en: 'Start with the medical summary' },
    body: {
      'zh-TW': '初診快覽依序整理：一句話摘要、問題清單與負責院所、影像與病理重點、開藥注意。點來源標籤可打開原始紀錄。內容由 AI 協助整理，仍需由醫療人員核對。',
      en: 'The first-visit summary gives a one-line overview, the problem list with the managing facility, imaging and pathology highlights, and prescribing cautions. Source tags open the original records. Always clinically verify AI-assisted content.',
    },
    fallbackBody: {
      'zh-TW': '摘要產生後，這裡會依序列出一句話摘要、問題清單、影像與病理重點與開藥注意；點來源標籤可打開原始紀錄。',
      en: 'Once generated, the summary lists a one-line overview, the problem list, imaging and pathology highlights, and prescribing cautions here; source tags open the original records.',
    },
  },
  {
    id: 'summary-settings',
    target: '[data-tour="medical-summary-controls"]',
    fallbackTarget: '[data-tour="right-tab-medical-summary"]',
    highlightPadding: 8,
    title: { 'zh-TW': '摘要模型與資料範圍都在這裡', en: 'Choose the summary model and data scope here' },
    body: {
      'zh-TW': '點模型名稱可選擇這份摘要使用的 AI 模型；點右側齒輪「設定」，再選「資料範圍」，即可決定哪些病歷資料要納入摘要。',
      en: 'Select the model name to choose the AI model for this summary. Open the Settings gear, then Data scope, to decide which records are included.',
    },
    fallbackBody: {
      'zh-TW': '目前尚未顯示摘要控制列；載入病人資料後，可從醫療摘要右上方選擇模型，並在齒輪「設定」中調整資料範圍。',
      en: 'Summary controls are not available yet. After loading patient data, choose a model at the top right and adjust Data scope from Settings.',
    },
  },
  {
    id: 'custom-summary',
    target: '[data-tour="medical-summary-custom-tab"]',
    fallbackTarget: '[data-tour="right-tab-medical-summary"]',
    highlightPadding: 6,
    title: { 'zh-TW': '用自訂摘要整理你在意的重點', en: 'Tailor custom summaries to your needs' },
    body: {
      'zh-TW': '現在已切進「自訂」分頁。這裡每個模組依自己的提示詞整理病歷，例如變化摘要或臨床快照，與標準摘要分開產生。接下來會帶你找到編輯入口，並打開模板看各個欄位；導覽不會更動內容。',
      en: 'You are now in Custom. Each module uses its own prompt to summarise the record—for example, changes or a clinical snapshot—separately from the standard summary. Next, we will open the real template editor and explain its fields without changing anything.',
    },
    fallbackBody: {
      'zh-TW': '載入病人資料後，可從醫療摘要的「自訂」分頁使用自己的模板。接下來會介紹編輯入口、提示詞、啟用設定與範本庫。',
      en: 'After loading patient data, open Custom within Medical summary. Next, we will cover the editor, prompts, activation settings, and template library.',
    },
  },
  {
    id: 'custom-summary-edit',
    target: '[data-tour="custom-summary-edit"]',
    fallbackTarget: '[data-tour="medical-summary-controls"]',
    title: { 'zh-TW': '從每個模組右側的「編輯」進入', en: 'Open Edit beside a module' },
    body: {
      'zh-TW': '模組標題右側的鉛筆「編輯」，會直接打開這個模組的設定。也可用上方「管理模組」集中管理；手機版在齒輪「設定」內。按「下一步」，導覽會替你打開目前這個模板。',
      en: 'The pencil-labelled Edit action beside a module opens that exact template. Manage modules above opens the full manager; on phones, find it in the Settings gear. Select Next to open this template for a guided preview.',
    },
    fallbackBody: {
      'zh-TW': '目前沒有顯示可編輯的模組。可從「管理模組」選擇模板並啟用；手機版入口在齒輪「設定」內。下一步會打開管理畫面，不會替你新增或啟用模組。',
      en: 'No editable module is displayed. Open Manage modules to choose and enable one; on phones, use the Settings gear. Next opens the manager without adding or enabling anything.',
    },
  },
  {
    id: 'custom-summary-fields',
    target: '[data-tour="custom-summary-manager"] [data-tour="custom-summary-fields"]',
    fallbackTarget: '[data-tour="custom-summary-manager"] [data-tour="custom-summary-add"]',
    title: { 'zh-TW': '這裡就是模板編輯畫面', en: 'This is the template editor' },
    body: {
      'zh-TW': '「模組名稱」決定摘要上顯示的標題。下方「輸出格式」可選純文字、Markdown 或 HTML；「輸出語言」可依模板要求，或跟隨介面語言。接著往下看最重要的提示詞欄位。',
      en: 'Module name is the title shown in your summary. Below it, Output format offers plain text, Markdown, or HTML. Output language can follow the template or the interface language. Next, we will look at the prompt itself.',
    },
    fallbackBody: {
      'zh-TW': '目前尚無模板可編輯。導覽結束後，可按「＋」新增模組，再填名稱、輸出格式與語言；也可先從範本庫加入現成模板。',
      en: 'There is no template to edit yet. After the tour, use + to add a module, then set its name, format, and language, or add a ready-made library template.',
    },
  },
  {
    id: 'custom-summary-prompt',
    target: '[data-tour="custom-summary-manager"] [data-tour="custom-summary-prompt"]',
    fallbackTarget: '[data-tour="custom-summary-manager"] [data-tour="custom-summary-add"]',
    title: { 'zh-TW': '在「提示」欄位編輯摘要內容要求', en: 'Edit summary instructions in Prompt' },
    body: {
      'zh-TW': '這個文字框就是編輯提示詞的地方。可寫清楚關注項目、比較方式與呈現順序，例如「比較最近兩次腎功能，列出數值、日期與變化」。內容較長時，按右側「展開編輯」可用大畫面修改。',
      en: 'The text box here is where you edit the prompt. Specify what to focus on, how to compare it, and the output order—for example, “Compare the two latest kidney function results; list values, dates, and changes.” Use Expand editor for a larger editing view.',
    },
    fallbackBody: {
      'zh-TW': '新增或選擇模板後，編輯區下方會出現「提示」文字框。把摘要要回答的問題與格式寫在這裡；「展開編輯」可放大編輯空間。',
      en: 'After adding or selecting a template, the Prompt text box appears below its settings. Write the questions and structure you want the summary to address. Expand editor gives you more writing space.',
    },
  },
  {
    id: 'custom-summary-behavior',
    target: '[data-tour="custom-summary-manager"] [data-tour="custom-summary-behavior"]',
    fallbackTarget: '[data-tour="custom-summary-manager"] [data-tour="custom-summary-add"]',
    title: { 'zh-TW': '決定是否顯示，以及何時產生', en: 'Choose visibility and when to generate' },
    body: {
      'zh-TW': '「啟用此模組」決定它是否出現在自訂摘要分頁，最多可啟用 5 個。「載入病人時自動產生」是另一個開關，最多 2 個；關閉時仍能手動產生。導覽只介紹位置，不會替你切換開關或呼叫 AI。',
      en: 'Enable this module controls whether it appears in Custom, with up to 5 enabled modules. Auto-generate on patient load is separate, with up to 2 automatic modules. Others can still run manually. This tour will not toggle settings or call AI.',
    },
    fallbackBody: {
      'zh-TW': '選好模板後，需開啟「啟用此模組」才會顯示於自訂摘要。是否載入病人時自動產生可另外選擇；導覽不會替你啟用任何功能。',
      en: 'Once you have a template, enable it to display it in Custom. You can separately choose whether to generate on patient load. The tour never enables either option for you.',
    },
  },
  {
    id: 'custom-summary-share',
    target: '[data-tour="custom-summary-manager"] [data-tour="custom-summary-share"]',
    fallbackTarget: '[data-tour="custom-summary-manager"] [data-tour="custom-summary-add"]',
    title: { 'zh-TW': '從編輯器右上方分享模板', en: 'Share from the top of the template editor' },
    body: {
      'zh-TW': '這個「分享範本」按鈕會帶入目前模板，讓你確認後選擇只自己使用或公開到範本庫。分享需要登入；訪客會看到鎖頭。儲存的是可重複使用的模板，不是這位病人的摘要，導覽不會替你登入或發布。',
      en: 'Share template opens the current template for review, then lets you keep it private or publish it to the gallery. Sign-in is required; guests see a lock. This saves a reusable template, not this patient’s summary. The tour never signs in or publishes for you.',
    },
    fallbackBody: {
      'zh-TW': '新增或選好模板後，編輯器右上方會出現分享入口。需登入才能發布；請勿在模板文字中包含病人個資。',
      en: 'After adding or selecting a template, the share action appears above the editor. Sign in to publish, and keep patient identifiers out of the template text.',
    },
  },
  {
    id: 'custom-summary-share-form',
    target: '[data-tour="custom-summary-share-form"] [data-tour="template-share-review"]',
    fallbackTarget: '[data-tour="custom-summary-manager"] [data-tour="custom-summary-share"]',
    authenticatedOnly: true,
    title: { 'zh-TW': '發布前，先確認分享內容', en: 'Review what you will publish' },
    body: {
      'zh-TW': '已打開真正的分享表單。先核對標題、說明與 Prompt，再設定用途、分類與是否公開；最後才按下方按鈕。系統不會附帶病人 FHIR 資料，但文字內若含姓名或病歷號仍須移除。導覽不會送出。',
      en: 'This is the real sharing form. Review the title, description, and prompt, then set its purpose, categories, and visibility before saving. Patient FHIR data is not attached, but remove identifiers from the text. The tour never submits this form.',
    },
    fallbackBody: {
      'zh-TW': '目前沒有可分享的模板。先新增或選擇模板，再從「分享範本」檢查發布內容；導覽不會建立或發布任何資料。',
      en: 'No template is available to share. Add or select one first, then use Share template to review it. The tour never creates or publishes data.',
    },
  },
  {
    id: 'custom-summary-library',
    target: '[data-tour="custom-summary-manager"] [data-tour="custom-summary-library"]',
    title: { 'zh-TW': '從範本庫加入，也能自己新增', en: 'Add library templates or create your own' },
    body: {
      'zh-TW': '管理模組是整理自己使用的模板；「瀏覽範本庫」則能找大家分享的範本。也可用「＋」自行新增。登入後修改會同步至帳戶；訪客修改只保留於本頁。按「下一步」實際打開範本庫。',
      en: 'Manage modules organises the templates you use. Browse Gallery finds shared templates; + creates your own. Signed-in edits sync to your account; guest edits last only on this page. Select Next to open the library.',
    },
  },
  {
    id: 'custom-summary-gallery',
    target: '[data-tour="custom-summary-gallery"] [data-tour="gallery-tabs"]',
    title: { 'zh-TW': '「所有範本」就在這裡', en: 'Find shared templates under All Prompts' },
    body: {
      'zh-TW': '已進入範本庫的「所有範本」，可瀏覽符合目前使用身份的公開內容。「我的範本」包含自己儲存的公開與私人範本，需要登入；它與管理模組裡的個人模板清單分開。',
      en: 'The library is now on All Prompts, showing public templates for your current role. My Prompts contains your public and private gallery templates and requires sign-in; it stays separate from the personal module list in the manager.',
    },
  },
  {
    id: 'custom-summary-gallery-search',
    target: '[data-tour="custom-summary-gallery"] [data-tour="gallery-filters"]',
    title: { 'zh-TW': '用搜尋與篩選找到適合的範本', en: 'Find a template with search and filters' },
    body: {
      'zh-TW': '從這裡搜尋名稱或關鍵字，並依類型、分類或專科縮小範圍。從自訂摘要進來會先篩選摘要範本；若想看其他類型，可清除類型篩選。範本尚在載入、沒有結果或連線失敗時，也可以繼續導覽。',
      en: 'Search by name or keyword and narrow the results by type, category, or specialty. Entering from Custom initially filters to summary templates; clear that type filter to see other types. You can continue the tour while results load, are empty, or unavailable.',
    },
  },
  {
    id: 'custom-summary-gallery-preview',
    target: '[data-tour="gallery-preview"] [data-tour="gallery-preview-actions"]',
    fallbackTarget: '[data-tour="custom-summary-gallery"] [data-tour="gallery-tabs"]',
    title: { 'zh-TW': '先預覽，再決定是否套用', en: 'Preview before adding a template' },
    body: {
      'zh-TW': '點一張範本卡片會打開這個預覽，先讀完整 Prompt 與適用情境，再選「加入自訂摘要」（需登入）。加入後可在管理模組裡修改、啟用或排序；加入不等於立刻產生摘要。本次只預覽，不會加入。',
      en: 'A template card opens this preview. Read the full prompt and intended use, then choose Add to Custom Summary (sign-in required). After adding it, edit, enable, or reorder it in the manager. Adding a template does not generate a summary. This tour only previews it.',
    },
    fallbackBody: {
      'zh-TW': '目前沒有可預覽的範本，可能正在載入、沒有符合結果或連線失敗。日後點範本卡片即可閱讀完整內容，登入後選「加入自訂摘要」加入自己的模組。導覽不會代替你加入或產生內容。',
      en: 'No template is available to preview: results may be loading, empty, or unavailable. When a card is available, read its full prompt, sign in, and choose Add to Custom Summary. The tour never adds a template or generates content.',
    },
  },
  {
    id: 'custom-summary-generate',
    target: '[data-tour="custom-summary-generate"]',
    fallbackTarget: '[data-tour="medical-summary-custom-tab"]',
    title: { 'zh-TW': '回到模組，按「產生」套用模板', en: 'Return to the module and select Generate' },
    body: {
      'zh-TW': '編輯完成後關閉管理畫面，再按模組右側「產生摘要」；已有內容時會顯示「重新產生摘要」。改模板不會直接改寫舊結果，需重新產生。結果可複製，但目前沒有逐項來源引註，請核對原始病歷。本次導覽不會執行產生。',
      en: 'After editing, close the manager and select Generate summary, or Regenerate summary for an existing result. Template edits do not rewrite old results until you regenerate. You can copy the output, but it has no item-level source citations—verify the original record. The tour will not generate anything.',
    },
    fallbackBody: {
      'zh-TW': '模組啟用且病歷資料就緒後，可從右側「產生」執行；若正在執行，原位置會顯示「停止」。內容沒有逐項來源引註，請核對病歷。導覽不會啟用、產生或停止任何模組。',
      en: 'Once a module is enabled and the record is ready, use Generate on its right. A running module shows Stop instead. Output has no item-level source citations; verify the record. The tour never enables, starts, or stops a module.',
    },
  },
  {
    id: 'custom-summary-read-result',
    target: '[data-tour="custom-summary-open-result"][data-result-available="true"]',
    fallbackTarget: '[data-tour="custom-summary-open-result"][data-result-available="false"]',
    // The result and prompt states share the same stable action. Resolve the
    // currently rendered state immediately instead of flashing a centred tour
    // while waiting for a result that this guide never generates.
    fallbackGraceAttempts: 0,
    title: { 'zh-TW': '用較大的閱讀視窗查看完整結果', en: 'Read the full result in a larger view' },
    body: {
      'zh-TW': '摘要產生完成後，按模組右側的斜箭頭放大按鈕，可在較寬的視窗查看完整內容；視窗會保留產生模型、時間與耗時，並沿用目前選擇的純文字、Markdown 或 HTML 顯示格式。內容仍沒有逐項來源引註，請回原始病歷核對。',
      en: 'After generation, use the diagonal-arrow expand button on the module to read the full result in a wider window. It keeps the model, completion time, duration, and your current plain-text, Markdown, or HTML display format. Item-level citations are still unavailable, so verify against the source record.',
    },
    fallbackBody: {
      'zh-TW': '目前還沒有摘要結果；按模組右側固定顯示的斜箭頭放大按鈕，可先在較大視窗檢查模板 Prompt。完成「產生摘要」後，同一按鈕會改為顯示完整摘要、產生資訊與目前的顯示格式。',
      en: 'There is no summary result yet. Use the fixed diagonal-arrow expand button on the module to inspect the template prompt in a larger window. After Generate summary finishes, the same button shows the full result, generation details, and current display format.',
    },
  },
  {
    id: 'custom-summary-finish',
    target: '[data-tour="medical-summary-custom-tab"]',
    title: { 'zh-TW': '完成！需要時可從章節重新開始', en: 'Done—revisit any chapter when you need it' },
    body: {
      'zh-TW': '你已認識自訂摘要的編輯、啟用、分享與範本庫。之後可從頁首「導覽教學」，或自訂摘要的「使用教學」重新查看。結束會還原原本畫面；導覽沒有修改模板、發布內容或呼叫 AI。',
      en: 'You have explored editing, activation, sharing, and the library. Reopen this guide from Guided tour in the header or User guide in Custom. Finishing restores your previous view; no templates were changed, published, or generated.',
    },
  },
  {
    id: 'chat',
    target: '[data-tour="medical-chat-controls"]',
    fallbackTarget: '[data-tour="right-tab-medical-chat"]',
    highlightPadding: 8,
    title: { 'zh-TW': '先認識臨床對話與上方工具', en: 'Get to know Clinical chat and its controls' },
    body: {
      'zh-TW': '可直接詢問目前病人的診斷、用藥、檢驗或照護問題，AI 會依問題查詢已載入的病歷。上方可查看對話紀錄、切換不保留本次內容的無痕模式、選擇 AI 模型，或開始新對話；登入後才能保存與查看歷史對話。回答仍需由醫療人員核對。',
      en: 'Ask directly about the current patient’s diagnoses, medications, tests, or care; AI queries the loaded record as needed. The controls above open chat history, enable a temporary unsaved chat, switch AI models, or start a new conversation. Sign in to save and revisit past chats, and clinically verify every answer.',
    },
    fallbackBody: {
      'zh-TW': '進入臨床對話後，可直接詢問目前病歷；登入後還能查看對話紀錄、使用無痕模式、切換 AI 模型或開始新對話。',
      en: 'In Clinical chat, ask about the current record. After signing in, you can also revisit chat history, use temporary mode, switch AI models, or start a new conversation.',
    },
  },
  {
    id: 'chat-compose',
    target: '[data-tour="medical-chat-composer"]',
    fallbackTarget: '[data-tour="right-tab-medical-chat"]',
    highlightPadding: 8,
    title: { 'zh-TW': '用文字、圖片、語音或範本開始對話', en: 'Start with text, images, voice, or a template' },
    body: {
      'zh-TW': '可在輸入框直接輸入問題，也能貼上或上傳圖片，或點麥克風使用語音輸入。輸入「/」可搜尋快捷範本，也可以直接點上方的範本按鈕帶入內容，再送出問題。',
      en: 'Type a question, paste or upload an image, or use the microphone for voice input. Type “/” to search shortcut templates, or click a template above the input to insert it before sending.',
    },
    fallbackBody: {
      'zh-TW': '進入臨床對話後，可用文字、圖片、語音或「/」快捷範本輸入問題。',
      en: 'In Clinical chat, enter questions with text, images, voice, or “/” shortcut templates.',
    },
  },
  {
    id: 'chat-template',
    target: '[data-tour="chat-template-tools"]',
    fallbackTarget: '[data-tour="right-tab-medical-chat"]',
    highlightPadding: 8,
    title: { 'zh-TW': '從範本庫挑選，也能建立自己的範本', en: 'Browse the library or create your own templates' },
    body: {
      'zh-TW': '點「範本庫」可瀏覽並加入現成範本；點「管理範本」可新增或編輯名稱、內容與快捷指令，也能調整順序並設為預設範本。',
      en: 'Open the Template library to browse and add ready-made templates. Use Manage templates to add or edit names, content, and shortcuts, reorder items, or choose a default.',
    },
    fallbackBody: {
      'zh-TW': '進入臨床對話後，可從輸入區上方開啟範本庫，或使用「管理範本」建立與編輯自訂範本。',
      en: 'In Clinical chat, open the Template library above the input area or use Manage templates to create and edit your own.',
    },
  },
  {
    id: 'calculator',
    target: '[data-tour="right-tab-medical-calculator"]',
    highlightPadding: 10,
    title: { 'zh-TW': '計算機會優先帶入現有資料', en: 'Calculators can use available patient data' },
    body: {
      'zh-TW': '可搜尋臨床量表與公式；「此病人」會優先顯示目前資料可協助計算的項目。使用結果前請核對帶入值與資料日期。',
      en: 'Search clinical scores and formulas. “For this patient” prioritises tools supported by loaded data; verify every value and date before using a result.',
    },
  },
  {
    id: 'guidance',
    target: '[data-tour="right-tab-clinical-decision-support"]',
    highlightPadding: 10,
    medicalOnly: true,
    betaOnly: true,
    title: { 'zh-TW': '個人化指引對照病人狀況', en: 'Guidance connects recommendations to patient context' },
    body: {
      'zh-TW': '依病人條件整理符合的臨床指引、建議與依據，協助快速檢查照護缺口；它是決策支援，不會取代醫療人員判斷。',
      en: 'Match patient context with applicable guidance, recommendations, and evidence to review care gaps. It supports—but never replaces—clinical judgement.',
    },
  },
  {
    id: 'export',
    target: '[data-tour="right-tab-ips-export"]',
    highlightPadding: 10,
    title: { 'zh-TW': '複製前先預覽並調整範圍', en: 'Preview and adjust scope before copying' },
    body: {
      'zh-TW': '可先預覽整理後的病歷內容、調整納入範圍，再複製或下載 Markdown／JSON。需要 AI 推論的項目必須由你主動啟動與確認。',
      en: 'Preview the organised record, adjust its scope, then copy or download Markdown or JSON. Any AI-inferred item requires your explicit request and confirmation.',
    },
  },
  {
    id: 'settings',
    target: '[data-tour="right-tab-settings"]',
    highlightPadding: 10,
    title: { 'zh-TW': '設定集中管理模型、金鑰與顯示', en: 'Manage models, keys, and display settings' },
    body: {
      'zh-TW': '可設定各功能使用的 AI 模型與連線方式，也能調整主題、字級與查看版本資訊；登入後還可開啟 Beta 功能。敏感金鑰只會在你設定後使用。',
      en: 'Choose AI models and connections for each feature, adjust theme and text size, and view version information. After signing in, you can also enable Beta features. Sensitive keys are used only after you configure them.',
    },
  },
  {
    id: 'finish',
    target: '[data-tour="right-tabs"]',
    title: { 'zh-TW': '完成！右側工具都能隨時切換', en: 'Done—right-side tools are always within reach' },
    body: {
      'zh-TW': '之後可從頁首「導覽教學 → Quick tour」重新播放。若想學編輯、分享模板與範本庫，可以接著看自訂摘要詳盡導覽。所有教學都不會送出對話、產生或匯出內容。',
      en: 'Replay this from Guided tour in the header. The tour only changes what is visible; it never sends chat, generates content, or exports data.',
    },
  },
]

export function getRightTourSteps(kind: 'quick' | 'custom-summary', options: {
  medical: boolean
  authenticated: boolean
  betaEnabled: boolean
}): TourStep[] {
  return ALL_STEPS.filter((step) => (
    (kind === 'custom-summary'
      ? step.id.startsWith('custom-summary')
      : !step.id.startsWith('custom-summary') || step.id === 'custom-summary')
    && (!step.medicalOnly || options.medical)
    && (!step.authenticatedOnly || options.authenticated)
    // Beta alone, no sign-in: the tab this step points at appears for anyone
    // who turned the switch on, so the step must follow the same rule or the
    // tour would skip a tab that is standing right there.
    && (!step.betaOnly || options.betaEnabled)
  )).map((step) => kind === 'quick' && step.id === 'custom-summary' ? {
    ...step,
    body: {
      'zh-TW': '「自訂」用自己的提示詞整理病歷，與標準摘要分開產生。每個模組右側都有鉛筆「編輯」。想深入學編輯、分享與範本庫，可從頁首「導覽教學」或這裡的「使用教學」開啟專屬導覽。',
      en: 'Custom summarises the record with your own prompts, separately from the standard summary. The pencil-labelled Edit action sits beside each module. For editing, sharing, and the library, open the detailed guide from Guided tour in the header or User guide here.',
    },
    fallbackBody: {
      'zh-TW': '載入資料後，可從醫療摘要的「自訂」分頁使用自己的模板。編輯、分享與範本庫的操作，可另外開啟自訂摘要詳盡導覽學習。',
      en: 'After loading a record, use your templates in Custom within Medical summary. Open the separate detailed guide to learn editing, sharing, and the library.',
    },
  } : step)
}
