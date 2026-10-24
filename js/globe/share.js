'use strict';

// 分享圖卡：1080×1920（IG 限動比例），在瀏覽器裡用 canvas 合成，不需要伺服器。
// 集數封面放在 Firstory CDN、沒有 CORS 標頭，畫進 canvas 會汙染畫布無法匯出，所以圖卡不放封面。

const CARD_W = 1080;
const CARD_H = 1920;
const CARD_FONTS = ['600 64px "Klee One"', '700 40px "Noto Sans TC"', '600 40px "Fredoka"'];
let lastCard = null;   // { blob, url, file, title, link }

async function openShareCard(kind, id) {
  openModal('share-modal');
  const preview = document.getElementById('share-preview');
  preview.removeAttribute('src');
  preview.closest('.share-stage').classList.add('loading');

  try {
    const { canvas, title, link, filename } = await drawCard(kind, id);
    const blob = await new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/png'));
    if (lastCard?.url) URL.revokeObjectURL(lastCard.url);
    lastCard = { blob, url: URL.createObjectURL(blob), file: new File([blob], filename, { type: 'image/png' }), title, link };
    preview.src = lastCard.url;
    document.getElementById('share-native').hidden = !(navigator.canShare && navigator.canShare({ files: [lastCard.file] }));
  } catch (e) {
    console.error('share card failed', e);
    closeModal('share-modal');
    toast('圖卡產生失敗，請再試一次');
  } finally {
    preview.closest('.share-stage').classList.remove('loading');
  }
}

async function shareCardNative() {
  if (!lastCard) return;
  try {
    await navigator.share({ files: [lastCard.file], title: lastCard.title, text: lastCard.link });
  } catch (e) { /* 使用者取消 */ }
}

function downloadCard() {
  if (!lastCard) return;
  const a = document.createElement('a');
  a.href = lastCard.url;
  a.download = lastCard.file.name;
  a.click();
}

// ── 繪製 ──────────────────────────────────────────────
async function drawCard(kind, id) {
  if (document.fonts) await Promise.all(CARD_FONTS.map(f => document.fonts.load(f).catch(() => null)));
  const cv = document.createElement('canvas');
  cv.width = CARD_W;
  cv.height = CARD_H;
  const ctx = cv.getContext('2d');

  paintBackground(ctx);
  await paintHeader(ctx);
  paintGlobe(ctx, 250, 760);

  let out;
  if (kind === 'visited') out = await paintVisited(ctx);
  else if (kind === 'episode') out = await paintEpisode(ctx, id);
  else out = await paintCountry(ctx, id);

  paintFooter(ctx, out.cta);
  return { canvas: cv, ...out };
}

function paintBackground(ctx) {
  const g = ctx.createRadialGradient(CARD_W / 2, 640, 80, CARD_W / 2, 760, 1400);
  g.addColorStop(0, '#13244a');
  g.addColorStop(0.55, '#081227');
  g.addColorStop(1, '#040813');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 420; i++) {
    ctx.globalAlpha = 0.2 + rnd() * 0.7;
    ctx.fillStyle = rnd() < 0.2 ? '#ffe6b0' : '#ffffff';
    ctx.beginPath();
    ctx.arc(rnd() * CARD_W, rnd() * CARD_H, rnd() ** 3 * 2.2 + 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

async function paintHeader(ctx) {
  const logo = await loadImage('assets/logo-256.png').catch(() => null);
  if (logo) ctx.drawImage(logo, 72, 84, 104, 104);
  ctx.fillStyle = '#F4C737';
  ctx.font = '600 58px "Klee One", "Noto Sans TC", sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('解鎖地球', 200, 140);
  ctx.fillStyle = 'rgba(238,242,250,0.6)';
  ctx.font = '500 26px "Noto Sans TC", sans-serif';
  ctx.fillText('旅 行 · 歷 史 · 文 化　PODCAST', 202, 182);
}

// 把目前地球畫面裁成正方形放進圖卡（同一幀先 render 再讀，不必開 preserveDrawingBuffer）
function paintGlobe(ctx, y, size) {
  const r = globe.renderer();
  r.render(globe.scene(), globe.camera());
  const src = r.domElement;
  const side = Math.min(src.width, src.height) * 0.92;
  const sx = (src.width - side) / 2;
  const sy = (src.height - side) / 2;
  const x = (CARD_W - size) / 2;

  const glow = ctx.createRadialGradient(CARD_W / 2, y + size / 2, size * 0.3, CARD_W / 2, y + size / 2, size * 0.62);
  glow.addColorStop(0, 'rgba(111,180,255,0.18)');
  glow.addColorStop(1, 'rgba(111,180,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, y - 80, CARD_W, size + 160);
  ctx.drawImage(src, sx, sy, side, side, x, y, size, size);
}

async function paintVisited(ctx) {
  const n = visited.size;
  const pct = Math.round(n / TOTAL_COUNTRIES * 100);
  const tier = getTier(pct);
  let y = 1040;

  const art = await loadImage(`assets/tiers/tier-${TIERS.indexOf(tier)}.webp`)
    .catch(() => loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(tier.svg)}`))
    .catch(() => null);
  if (art) ctx.drawImage(art, CARD_W / 2 - 80, y, 160, 160);
  y += 222;

  centerText(ctx, tier.title, y, '600 76px "Klee One", "Noto Sans TC", sans-serif', tier.color);
  y += 56;
  centerText(ctx, tier.sub, y, '500 32px "Noto Sans TC", sans-serif', 'rgba(238,242,250,0.7)');
  y += 128;
  centerText(ctx, `${pct}%`, y, '600 128px "Fredoka", sans-serif', '#F4C737');
  y += 58;
  centerText(ctx, `我去過 ${n} / ${TOTAL_COUNTRIES} 個國家`, y, '500 34px "Noto Sans TC", sans-serif', '#eef2fa');
  y += 36;
  await drawFlags(ctx, [...visited], y, 46, 2);

  const codes = [...visited].sort().join(',');
  return {
    title: `我解鎖了 ${pct}% 的地球`,
    link: `${SITE_URL}?visited=${codes}`,
    filename: `unlock-earth-${pct}pct.png`,
    cta: '你解鎖了多少地球？',
  };
}

async function paintEpisode(ctx, epNum) {
  const ep = ix.epMeta.get(epNum);
  const lms = ix.lmByEp.get(epNum) || [];
  const codes = [...new Set(lms.map(l => l.a2).filter(Boolean))];
  let y = 1110;

  centerText(ctx, `EP.${ep.episode}`, y, '600 40px "Fredoka", sans-serif', '#F4C737');
  const [main, sub] = splitTitle(ep.title);
  y = wrapCentered(ctx, main, y + 92, 78, 940, 3, '600 62px "Klee One", "Noto Sans TC", sans-serif', '#ffffff');
  if (sub) y = wrapCentered(ctx, sub, y + 66, 46, 900, 2, '500 31px "Noto Sans TC", sans-serif', 'rgba(238,242,250,0.72)');

  y += 44;
  y = await drawFlags(ctx, codes, y, 40, 1);
  centerText(ctx, `${lms.length} 個地標${codes.length ? ` · ${codes.length} 個國家` : ''}`, y + 46, '500 34px "Noto Sans TC", sans-serif', '#eef2fa');
  y += 46;

  const quote = (lms[0]?.appearances || []).find(a => a.ep === epNum)?.quote;
  if (quote && y < 1560) wrapCentered(ctx, `「${quote}」`, y + 96, 54, 860, 2, '600 40px "Klee One", "Noto Sans TC", sans-serif', '#7FD8F5');

  return {
    title: `Ep.${ep.episode} ${ep.title}`,
    link: `${SITE_URL}ep/${ep.episode}.html`,
    filename: `unlock-earth-ep${ep.episode}.png`,
    cta: '轉動地球，跟著這集出發',
  };
}

async function paintCountry(ctx, key) {
  const c = ix.countries.get(key);
  let y = 1090;
  const big = c.a2 ? await loadImage(flagUrl(c.a2), 4000, true).catch(() => null) : null;
  if (big) {
    ctx.save();
    roundRect(ctx, CARD_W / 2 - 80, y, 160, 120, 14);
    ctx.clip();
    ctx.drawImage(big, CARD_W / 2 - 80, y, 160, 120);
    ctx.restore();
  }
  y += 200;
  centerText(ctx, c.key, y, '600 84px "Klee One", "Noto Sans TC", sans-serif', '#ffffff');
  y += 76;
  const y0 = new Date(c.firstMs).getFullYear(), y1 = new Date(c.lastMs).getFullYear();
  centerText(ctx, `${c.eps.size} 集 · ${c.landmarks.length} 個地標 · ${y0 === y1 ? y0 : `${y0}–${y1}`}`, y, '500 36px "Noto Sans TC", sans-serif', '#F4C737');
  y += 90;
  for (const lm of c.landmarks.slice(0, 4)) {
    centerText(ctx, lm.name, y, '500 38px "Noto Sans TC", sans-serif', 'rgba(238,242,250,0.85)');
    y += 58;
  }
  return {
    title: `解鎖地球去過的${c.key}`,
    link: `${SITE_URL}?country=${encodeURIComponent(c.key)}`,
    filename: `unlock-earth-${c.a2 || 'country'}.png`,
    cta: `跟著節目走一趟${c.key}`,
  };
}

function paintFooter(ctx, cta) {
  ctx.fillStyle = 'rgba(244,199,55,0.14)';
  roundRect(ctx, 72, CARD_H - 210, CARD_W - 144, 120, 60);
  ctx.fill();
  centerText(ctx, cta, CARD_H - 160, '600 38px "Klee One", "Noto Sans TC", sans-serif', '#F4C737');
  centerText(ctx, 'deromanx.github.io/unlock-the-earth', CARD_H - 112, '500 26px "Fredoka", sans-serif', 'rgba(238,242,250,0.7)');
}

// ── 國旗 ──────────────────────────────────────────────
const flagUrl = a2 => `https://cdn.jsdelivr.net/npm/flag-icons@7.2.3/flags/4x3/${a2.toLowerCase()}.svg`;

// 置中排列的國旗格，最多 maxRows 行，放不下的顯示「+N」；回傳最後一行底部的 y
async function drawFlags(ctx, codes, y, h, maxRows) {
  if (!codes.length) return y;
  const w = Math.round(h * 4 / 3), gap = Math.round(h * 0.28);
  const perRow = Math.floor((CARD_W - 160 + gap) / (w + gap));
  const capacity = perRow * maxRows;
  const shown = codes.length > capacity ? codes.slice(0, capacity - 1) : codes;
  const imgs = await Promise.all(shown.map(a2 => loadImage(flagUrl(a2), 4000, true).catch(() => null)));
  const items = [...imgs.map((img, i) => ({ img, a2: shown[i] })), ...(codes.length > shown.length ? [{ more: codes.length - shown.length }] : [])];

  let bottom = y;
  for (let r = 0; r * perRow < items.length; r++) {
    const row = items.slice(r * perRow, (r + 1) * perRow);
    const rowW = row.length * w + (row.length - 1) * gap;
    let x = (CARD_W - rowW) / 2;
    const ry = y + r * (h + gap);
    for (const it of row) {
      ctx.save();
      roundRect(ctx, x, ry, w, h, Math.round(h * 0.14));
      ctx.clip();
      if (it.img) ctx.drawImage(it.img, x, ry, w, h);
      else { ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x, ry, w, h); }
      ctx.restore();
      if (it.more) {
        ctx.font = `600 ${Math.round(h * 0.45)}px "Fredoka", sans-serif`;
        ctx.fillStyle = '#eef2fa';
        ctx.textAlign = 'center';
        ctx.fillText(`+${it.more}`, x + w / 2, ry + h * 0.66);
        ctx.textAlign = 'left';
      }
      x += w + gap;
    }
    bottom = ry + h;
  }
  return bottom;
}

// ── 文字工具 ──────────────────────────────────────────
function centerText(ctx, text, y, font, color) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.fillText(text, CARD_W / 2, y);
  ctx.textAlign = 'left';
}

// 中文逐字換行，各行寬度平均（避免最後一行只剩一兩個字），超過行數以「…」收尾；回傳最後一行的 y
function wrapCentered(ctx, text, y, lineH, maxW, maxLines, font, color) {
  ctx.font = font;
  const breakAt = w => {
    const out = [];
    let line = '';
    for (const ch of [...text]) {
      if (ctx.measureText(line + ch).width > w && line) {
        out.push(line);
        line = ch.trim() ? ch : '';
      } else line += ch;
    }
    if (line) out.push(line);
    return out;
  };
  let lines = breakAt(maxW);
  if (lines.length > 1 && lines.length <= maxLines) {
    const even = breakAt(ctx.measureText(text).width / lines.length + ctx.measureText('字').width);
    if (even.length === lines.length) lines = even;
  }
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…';
  }
  lines.forEach((l, i) => centerText(ctx, l, y + i * lineH, font, color));
  return y + (lines.length - 1) * lineH;
}

// 集數標題「主標 | 副標」拆兩段，主標用大字
function splitTitle(title) {
  const i = title.indexOf('|');
  return i < 0 ? [title.trim(), ''] : [title.slice(0, i).trim(), title.slice(i + 1).trim()];
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 4 秒沒載入就放棄，圖卡少一張圖也不要卡住
function loadImage(src, timeout = 4000, cors = false) {
  return new Promise((res, rej) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';   // 跨網域圖要帶 CORS，否則畫布會被汙染無法匯出
    const timer = setTimeout(() => rej(new Error(`timeout: ${src}`)), timeout);
    img.onload = () => { clearTimeout(timer); res(img); };
    img.onerror = e => { clearTimeout(timer); rej(e); };
    img.src = src;
  });
}
