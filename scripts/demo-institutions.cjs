// Real institution name → 示範-prefixed realistic fake, shared by both demo
// builders (健康存摺 and 雲端病歷) so the same hospital carries the same fake
// name in either 試用資料. Keys are real names and must never be shipped; the
// builders' leak gates fail when any key survives in their output.

const INSTITUTION_MAP = {
  '長庚嘉義': '示範長青醫院',
  '林口長庚': '示範林楓醫學中心',
  '臺北榮總': '示範榮恩醫學中心',
  '中國附醫': '示範華佗醫學中心',
  '嘉基醫院': '示範嘉恩醫院',
  '戴德森嘉基': '示範嘉恩醫院',
  '中國北港醫': '示範北辰醫院',
  // long / narrative forms of the same hospitals → same fake, so the demo never
  // shows one real hospital under two different names.
  '財團法人嘉義長庚紀念醫院': '示範長青醫院',
  '長庚醫療財團法人嘉義長庚紀念醫院': '示範長青醫院',
  '北港媽祖醫院': '示範北辰醫院',
  '部嘉義醫院': '示範嘉惠醫院',
  '三順診所': '示範祥安診所',
  '王耳鼻喉科': '示範安心耳鼻喉科診所',
  '曾外科診所': '示範仁心外科診所',
  '北港眼科診': '示範明亮眼科診所',
  '龔顯琦診所': '示範康德診所',
  '王垂鎰牙醫': '示範微笑牙醫診所',
  '益安大藥局': '示範康健藥局',
  '南方藥局': '示範向陽藥局',
  '安麗兒藥局': '示範安寧藥局',
  // Pharmacies and providers that appear only in the 雲端病歷 export.
  '樂芯藥局': '示範樂活藥局',
  '德豐藥局': '示範德安藥局',
  '慶輝藥局': '示範慶安藥局',
  '龔顯琦': '示範康德',
}

module.exports = { INSTITUTION_MAP }
