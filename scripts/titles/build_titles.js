/*
 * 固定標題 → SVG 外框（臺灣道路體）
 *
 * justfont 授權不允許把字型檔放上網站（網頁要用付費 Web Font 服務），但「製成圖片不需額外授權」。
 * 所以會變動的文字（集數標題、地名）用思源黑體，固定的標題用這支腳本轉成向量外框：
 * 輸出 assets/titles/<key>.svg，網頁用 CSS mask 上色（顏色跟著深淺主題走），並印出每個檔的長寬比。
 *
 * 字型檔只在本機（~/Library/Fonts/twroadfont-1.0.otf），不要 commit。
 *
 *   cd scripts/titles && npm install && node build_titles.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const opentype = require('opentype.js');

const FONT = process.env.TITLE_FONT || path.join(os.homedir(), 'Library/Fonts/twroadfont-1.0.otf');
const OUT = path.resolve(__dirname, '../../assets/titles');

// key → 文字。改文字或新增標題後重跑，再把印出的 --ar 值貼到 index.html
const TITLES = {
  'brand': '解鎖地球',
  'hero-1': '用耳朵',
  'hero-2': '走遍世界',
  'episodes': '所有集數',
  'stats': '節目統計',
  'share': '分享圖卡',
  'loading': '正在解鎖地球',
};

const font = opentype.loadSync(FONT);
const SIZE = 100;
// 每個標題的上下界都用整套字的 ascender/descender，不同標題並排時基線和高度一致
const asc = font.ascender / font.unitsPerEm * SIZE;
const desc = -font.descender / font.unitsPerEm * SIZE;

fs.mkdirSync(OUT, { recursive: true });
for (const [key, text] of Object.entries(TITLES)) {
  const missing = [...text].filter(ch => font.charToGlyphIndex(ch) === 0);
  if (missing.length) throw new Error(`字型缺字：${missing.join('')}（${key}）`);
  const p = font.getPath(text, 0, asc, SIZE);
  const box = p.getBoundingBox();
  const x0 = Math.floor(box.x1), w = Math.ceil(box.x2) - x0, h = Math.ceil(asc + desc);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} 0 ${w} ${h}"><path d="${p.toPathData(1)}"/></svg>\n`;
  fs.writeFileSync(path.join(OUT, `${key}.svg`), svg);
  console.log(`${key.padEnd(10)} ${text.padEnd(8, '　')} --ar: ${(w / h).toFixed(3)}  ${(svg.length / 1024).toFixed(1)}KB`);
}
