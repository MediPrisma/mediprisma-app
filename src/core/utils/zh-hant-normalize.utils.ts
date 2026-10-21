/**
 * Deterministic Simplified → Traditional (Taiwan) repair for model-generated
 * prose. Local zh models occasionally drift into Simplified characters even
 * with an explicit Traditional-Chinese contract. Only unambiguous
 * Simplified-only code points are mapped, so already-Traditional text is
 * never changed. Never apply this to verbatim source quotes, medicine names
 * or SIG text: those must stay byte-identical to the record.
 */

// Phrase overrides for characters whose Traditional form depends on context.
const PHRASES: ReadonlyArray<readonly [string, string]> = [
  ['复诊', '複診'], ['复查', '複查'], ['复检', '複檢'], ['重复', '重複'], ['复杂', '複雜'], ['复方', '複方'],
  ['复合', '複合'], ['复数', '複數'], ['头发', '頭髮'], ['脱发', '脫髮'], ['日历', '日曆'],
  ['汇总', '彙總'], ['汇整', '彙整'], ['合并', '合併'], ['并发', '併發'], ['并用', '併用'],
]

const PAIRS =
  '这這们們个個为為来來时時会會说說对對发發经經过過还還进進现現实實与與关關开開问問题題应應从從动動学學种種长長样樣体體点點员員书書业業务務' +
  '医醫药藥疗療检檢诊診断斷历歷压壓脏臟肾腎脑腦颈頸胆膽随隨访訪记記录錄议議剂劑钙鈣钾鉀钠鈉铁鐵锌鋅镁鎂维維纤纖细細结結节節级級线線红紅绿綠蓝藍' +
  '织織组組统統给給约約续續综綜缩縮编編缓緩网網罗羅虑慮虚虛觉覺览覽规規视視认認让讓讨討论論设設评評诉訴译譯语語误誤调調谈談请請读讀课課谢謝' +
  '贝貝负負费費质質贵貴资資车車转轉轮輪较較辅輔输輸边邊达達迁遷运運远遠连連选選适適递遞遗遺释釋钟鐘钱錢错錯锁鎖镜鏡门門闭閉间間阳陽阴陰陆陸' +
  '际際陈陳险險难難页頁顶頂项項须須顾顧预預领領频頻颗顆额額风風饮飲饭飯馆館马馬验驗鱼魚鸡雞麦麥龄齡齿齒龙龍厂廠厅廳厉厲县縣变變叶葉号號吗嗎' +
  '听聽园園围圍图圖团團场場块塊坏壞声聲处處备備复復头頭夺奪奋奮妇婦宁寧宝寶审審导導将將尔爾尝嘗层層岁歲帅帥师師带帶帮幫广廣庆慶废廢异異' +
  '张張弹彈强強归歸彻徹径徑忆憶态態怀懷总總恶惡惊驚惯慣愿願战戰执執扩擴扫掃护護报報抢搶担擔拟擬择擇换換损損据據摄攝敌敵数數无無旧舊显顯' +
  '晓曉术術机機杀殺杂雜权權条條极極构構标標桥橋楼樓欢歡残殘毕畢气氣汇匯汤湯沟溝没沒泪淚洁潔浅淺测測济濟浓濃润潤涨漲渐漸湿濕满滿滤濾灭滅' +
  '灯燈灵靈炼煉烧燒热熱爱愛牵牽状狀独獨狭狹猪豬献獻环環电電画畫畅暢疮瘡疯瘋瘫癱盖蓋监監盘盤矿礦码碼础礎硕碩确確碍礙礼禮离離积積称稱稳穩' +
  '穷窮窝窩竞競笔筆笼籠筑築签簽简簡类類粮糧纠糾纪紀纯純纸紙纳納练練终終绍紹绝絕继繼缘緣缺缺罚罰聋聾职職联聯肠腸肤膚肿腫胀脹胁脅脉脈脱脫' +
  '脸臉腊臘腾騰艰艱苏蘇范範荐薦获獲营營补補装裝见見观觀触觸计計订訂训訓讲講许許证證识識词詞试試诚誠话話该該详詳谋謀谓謂谱譜财財责責' +
  '败敗货貨购購贴貼贸貿赔賠赖賴赛賽赶趕趋趨跃躍践踐踪蹤轨軌软軟轻輕载載辆輛辑輯辞辭违違迟遲邮郵邻鄰郑鄭酱醬针針钢鋼铅鉛银銀链鏈销銷锅鍋' +
  '键鍵镇鎮闻聞阀閥阅閱队隊阶階隐隱雾霧静靜顺順顽頑顿頓颜顏飞飛饥飢饰飾饱飽驱驅驾駕骤驟鲜鮮鸟鳥齐齊户戶黄黃争爭并並后後于於'

// Space-separated "簡繁" pairs (additional common clinical/general characters).
const EXTRA_PAIRS =
  '单單 华華 区區 协協 卫衛 双雙 参參 圣聖 坚堅 墙牆 壮壯 奖獎 岛島 币幣 帐帳 库庫 戏戲 扰擾 挤擠 挥揮 灾災 烦煩 疡瘍 痒癢 瘾癮 盐鹽 碱鹼 秃禿 紧緊 ' +
  '丝絲 买買 卖賣 乐樂 乡鄉 亏虧 亚亞 产產 亲親 亿億 仅僅 仓倉 价價 众眾 优優 伤傷 侧側 债債 倾傾 偿償 储儲 儿兒 兴興 养養 写寫 军軍 农農 冻凍 ' +
  '净淨 减減 凉涼 击擊 则則 刚剛 创創 别別 剧劇 办辦 劝勸 励勵 劳勞 势勢 却卻 叙敘 叠疊 吓嚇 呕嘔 响響 哑啞 唤喚 喷噴 嘱囑 国國 圆圓 垫墊 扬揚 ' +
  '抚撫 拥擁 拦攔 挂掛 挡擋 捞撈 摆擺 摇搖 撑撐 旷曠 昼晝 晒曬 晕暈 暂暫 杨楊 枪槍 柜櫃 栏欄 树樹 梦夢 欧歐 毁毀 汉漢 泻瀉 泽澤 洒灑 浆漿 浊濁 ' +
  '浑渾 涂塗 涌湧 渊淵 湾灣 溃潰 滚滾 滞滯 滥濫 潜潛 灿燦 炉爐 烂爛 烟煙 焕煥 犹猶 狱獄 猎獵 猫貓 疟瘧 痉痙 痨癆 痪瘓 瘘瘻 瘪癟 盏盞 睁睜 矫矯 ' +
  '砖磚 祸禍 窃竊 竖豎 笔筆 筛篩 类類 粪糞 纬緯 纱紗 纲綱 纵縱 纷紛 纹紋 纺紡 线線 绊絆 绑綁 绕繞 绘繪 络絡 绩績 绪緒 绳繩 绵綿 缝縫 缠纏 缴繳 ' +
  '罢罷 肃肅 胜勝 胶膠 脐臍 脓膿 脚腳 腻膩 艳豔 苍蒼 荡蕩 荣榮 萝蘿 蓝藍 虫蟲 蚀蝕 补補 衬襯 裤褲 觅覓 讯訊 讳諱 诈詐 诗詩 诞誕 询詢 诫誡 诱誘 ' +
  '诸諸 诺諾 谁誰 谅諒 谊誼 谎謊 谐諧 谜謎 谣謠 谦謙 谨謹 贞貞 贡貢 贤賢 账賬 贩販 贪貪 贫貧 贯貫 贷貸 贺賀 赋賦 赏賞 赚賺 赞贊 赠贈 轻輕 辈輩 ' +
  '辉輝 辖轄 辩辯 迈邁 逊遜 逻邏 酿釀 鉴鑑 钉釘 钝鈍 钥鑰 钩鉤 钳鉗 铃鈴 铜銅 铺鋪 锈鏽 锋鋒 锐銳 锡錫 锤錘 锦錦 锯鋸 闪閃 闯闖 闲閒 闷悶 闸閘 ' +
  '闹鬧 阁閣 阐闡 阵陣 隶隸 颁頒 颇頗 颠顛 颤顫 飘飄 饲飼 馈饋 驰馳 驶駛 驻駐 骂罵 骑騎 骗騙 鲁魯 鸣鳴 鸭鴨 鹅鵝 龟龜 丢丟 两兩 严嚴 丧喪 临臨 ' +
  '为為 举舉 义義 习習 书書 乱亂 争爭 亏虧 云雲 仪儀 们們 伞傘 传傳 体體 余餘 佥僉 侠俠 俩倆 债債 儿兒 兑兌 党黨 兰蘭 册冊 冯馮 决決 ' +
  '况況 凤鳳 凭憑 凯凱 刘劉 刍芻 剑劍 劲勁 动動 劳勞 匮匱 医醫 历歷 压壓 厌厭 厕廁 县縣 叁參 发發 叹嘆 吨噸 听聽 启啟 吴吳 员員 呛嗆 呜嗚 ' +
  '咙嚨 咸鹹 哗嘩 唠嘮 啸嘯 喽嘍 团團 园園 围圍 坛壇 坝壩 坟墳 垄壟 执執 扑撲 抛拋 拨撥 挣掙 捡撿 捣搗 掷擲 揽攬 搀攙 敛斂 构構 标標 椭橢 槛檻 ' +
  '毙斃 汤湯 沪滬 泞濘 浇澆 涛濤 渔漁 溅濺 滨濱 滩灘 烛燭 爷爺 牺犧 狈狽 狮獅 玛瑪 琐瑣 疖癤 眯瞇 窍竅 窑窯 笃篤 笋筍 笺箋 箩籮 绒絨 绢絹 绣繡 缀綴 ' +
  '羡羨 翘翹 耸聳 聂聶 舰艦 舱艙 芜蕪 茧繭 莱萊 萤螢 蒋蔣 虏虜 虾蝦 蚁蟻 蛮蠻 蜡蠟 衅釁 袄襖 誉譽 讥譏 讽諷 谍諜 赌賭 赎贖 赵趙 跷蹺 轧軋 轩軒 轰轟 ' +
  '轿轎 辫辮 邓鄧 钓釣 钞鈔 钮鈕 铭銘 铲鏟 铸鑄 锄鋤 锣鑼 锻鍛 镑鎊 镰鐮 雏雛 雳靂 霁霽 韦韋 韩韓 颂頌 饶饒 饺餃 饼餅 馒饅 驯馴 驳駁 驴驢 驼駝 骄驕 ' +
  '骆駱 骇駭 骚騷 鲸鯨 鸽鴿 鹰鷹 发發 选選'

export const SIMPLIFIED_TO_TRADITIONAL: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>()
  const chars = [...PAIRS]
  for (let i = 0; i + 1 < chars.length; i += 2) {
    if (chars[i] !== chars[i + 1]) map.set(chars[i], chars[i + 1])
  }
  for (const pair of EXTRA_PAIRS.split(/\s+/).filter(Boolean)) {
    const [simplified, traditional] = [...pair]
    if (simplified && traditional && simplified !== traditional) map.set(simplified, traditional)
  }
  return map
})()

const HAS_SIMPLIFIED = new RegExp(`[${[...SIMPLIFIED_TO_TRADITIONAL.keys()].join('')}]`)

/**
 * Mainland-China vocabulary (already in Traditional glyphs) → Taiwan clinical
 * usage. Glyph conversion alone leaves 肌酐 as 肌酐; Taiwan records write
 * 肌酸酐. Only terms that Taiwan clinical writing does not use are listed —
 * shared words such as 患者, 數據 or 冠心病 are deliberately absent. Mainland
 * Chinese drug names map back to the English generic name Taiwan records use.
 */
export const MAINLAND_TO_TAIWAN_TERMS: ReadonlyArray<readonly [string, string]> = [
  ['谷丙轉氨酶', 'ALT'], ['谷草轉氨酶', 'AST'], ['轉氨酶', '轉胺酶'],
  ['糖化血紅蛋白', '糖化血色素'], ['血紅蛋白', '血紅素'], ['甘油三酯', '三酸甘油酯'], ['肌酐', '肌酸酐'],
  ['白細胞', '白血球'], ['紅細胞', '紅血球'],
  // Full Mainland terms before their abbreviations: 腦梗死 must become 腦梗塞,
  // not 腦梗塞死 via the 腦梗 rule.
  ['心肌梗死', '心肌梗塞'], ['心梗死', '心肌梗塞'], ['腦梗死', '腦梗塞'], ['梗死', '梗塞'],
  ['心梗', '心肌梗塞'], ['腦梗', '腦梗塞'], ['房顫', '心房顫動'], ['慢阻肺', '慢性阻塞性肺病'],
  ['隨訪', '追蹤'], ['出院小結', '出院病摘'], ['B超', '超音波'], ['彩超', '彩色超音波'], ['靜滴', '靜脈輸注'],
  ['質子泵', '氫離子幫浦'],
  ['二甲雙胍', 'Metformin'], ['阿司匹林', 'Aspirin'], ['氨氯地平', 'Amlodipine'], ['硝苯地平', 'Nifedipine'],
  ['阿托伐他汀', 'Atorvastatin'], ['瑞舒伐他汀', 'Rosuvastatin'], ['氯吡格雷', 'Clopidogrel'], ['奧美拉唑', 'Omeprazole'],
  ['纈沙坦', 'Valsartan'], ['厄貝沙坦', 'Irbesartan'], ['美托洛爾', 'Metoprolol'], ['比索洛爾', 'Bisoprolol'],
  ['呋塞米', 'Furosemide'], ['螺內酯', 'Spironolactone'], ['別嘌醇', 'Allopurinol'], ['非布司他', 'Febuxostat'],
  ['信息', '資訊'], ['視頻', '影片'], ['軟件', '軟體'], ['默認', '預設'],
]

// Longest first so 谷丙轉氨酶 wins over 轉氨酶.
const TERM_RULES = [...MAINLAND_TO_TAIWAN_TERMS].sort((a, b) => b[0].length - a[0].length)

function occurrences(text: string, needle: string): number[] {
  const found: number[] = []
  for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) found.push(i)
  return found
}

/**
 * Replace Mainland vocabulary with Taiwan clinical usage (Traditional input
 * expected). A match that sits inside text already written in the Taiwan form
 * is left alone (房顫 inside 心房顫動, 腦梗 inside 腦梗塞).
 */
export function toTaiwanClinicalTerms(text: string): string {
  let out = text
  for (const [from, to] of TERM_RULES) {
    if (!out.includes(from)) continue
    const protectedRanges = occurrences(out, to).map((start) => [start, start + to.length] as const)
    let result = ''
    let cursor = 0
    for (const start of occurrences(out, from)) {
      if (start < cursor) continue
      const end = start + from.length
      if (protectedRanges.some(([s, e]) => start >= s && end <= e)) continue
      // An abbreviation already followed by the replacement's final character
      // (心梗塞, 房顫動) is part of a longer written term; expanding it would
      // duplicate that character.
      if (out[end] !== undefined && out[end] === to[to.length - 1]) continue
      result += out.slice(cursor, start) + to
      cursor = end
    }
    out = result + out.slice(cursor)
  }
  return out
}

/**
 * Model prose → Taiwan Traditional Chinese: Simplified glyphs first, then
 * Mainland vocabulary. Never apply to medicine names, SIG or source quotes.
 */
export function toTraditionalChinese(text: string): string
export function toTraditionalChinese(text: string | undefined): string | undefined
export function toTraditionalChinese(text: string | undefined): string | undefined {
  if (!text) return text
  let out = text
  if (HAS_SIMPLIFIED.test(out)) {
    for (const [from, to] of PHRASES) out = out.split(from).join(to)
    out = [...out].map((ch) => SIMPLIFIED_TO_TRADITIONAL.get(ch) ?? ch).join('')
  }
  return toTaiwanClinicalTerms(out)
}

export function containsSimplifiedChinese(text: string | undefined): boolean {
  return !!text && HAS_SIMPLIFIED.test(text)
}
