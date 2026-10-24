'use strict';
// 視覺加強：聲波地標、首頁聲紋環、護照入境章、七年光軌、封面拼貼世界地圖、降落轉場、集數配色。
// 和 app.js 共用全域狀態（globe、ix、landmarks、theme…），由 app.js 在對應時機呼叫。

// ── 聲波地標 ──────────────────────────────────────────
// 被越多集提到的地標，聲波越大圈、越慢；只在一般瀏覽時出現（時間線、足跡、導覽各自有光圈）
let ambientRings = [];
function buildAmbientRings() {
  ambientRings = landmarks
    .filter(lm => lm.epNums.length >= 3)
    .sort((a, b) => b.epNums.length - a.epNums.length)
    .slice(0, 36)
    .map(lm => {
      const n = Math.min(lm.epNums.length, 10);
      return { lat: lm.lat, lng: lm.lon, maxR: 0.9 + n * 0.32, speed: 0.5 + n * 0.06, period: 3400 - n * 140, alpha: 0.32 + n * 0.03 };
    });
}

function ambientRingData() {
  if (REDUCED_MOTION || perfLevel >= 2 || timeline.on || visitedOn || story.on) return [];
  const rgb = hexToRgb(THEMES[theme].pin);
  return ambientRings.map(r => ({ ...r, rgb }));
}

// ── 首頁聲紋環 ────────────────────────────────────────
// 地球外圍一圈用最新一集真實音量曲線畫的聲紋（data/waveform.json，scripts/build_waveform.py 產生），
// 只在首頁開場時畫；資料每次上新集數就換
const wave = { cv: null, ctx: null, bins: null, ep: null, last: 0, cleared: true };
function startWaveRing(data) {
  if (!data?.bins?.length || REDUCED_MOTION) return;
  // 鄰近三段平均，邊緣比較圓潤
  wave.bins = data.bins.map((v, i, a) => (a[(i - 1 + a.length) % a.length] + v * 2 + a[(i + 1) % a.length]) / 4);
  wave.ep = data.ep;
  wave.cv = document.getElementById('wave');
  wave.ctx = wave.cv.getContext('2d');
  const note = document.getElementById('hero-wave-note');
  if (note && ix.epMeta.get(data.ep)) {
    note.textContent = `地球外圈是 Ep.${data.ep} 的聲音起伏`;
    note.hidden = false;
  }
  requestAnimationFrame(drawWave);
}

function drawWave(now) {
  requestAnimationFrame(drawWave);
  const show = globe && document.body.classList.contains('intro') && perfLevel < 2 && !document.hidden;
  const { cv, ctx } = wave;
  if (!show) {
    if (!wave.cleared) { ctx.clearRect(0, 0, cv.width, cv.height); wave.cleared = true; }
    return;
  }
  if (now - wave.last < 33) return;   // 30fps 就夠
  wave.last = now;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  if (cv.width !== innerWidth * dpr || cv.height !== innerHeight * dpr) {
    cv.width = innerWidth * dpr;
    cv.height = innerHeight * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  wave.cleared = false;

  // 地球在螢幕上的半徑：相機距離（地球半徑 100）與視角換算
  const cam = globe.camera();
  const d = 100 * (1 + globe.pointOfView().altitude);
  const r = (innerHeight / 2) * Math.tan(Math.asin(Math.min(1, 100 / d))) / Math.tan(cam.fov * Math.PI / 360);
  const [ox, oy] = globe.globeOffset?.() || [0, 0];
  const cx = innerWidth / 2 + ox, cy = innerHeight / 2 + oy;

  const color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#F4C737';
  const n = wave.bins.length;
  const rot = now / 60000 * Math.PI * 2 / 3;   // 三分鐘轉一圈
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1.4, r / 260);
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + i / n * Math.PI * 2;
    const breathe = 0.82 + 0.18 * Math.sin(now / 1100 + i * 0.35);
    const inner = r * 1.07, len = r * (0.025 + 0.15 * wave.bins[i] * breathe);
    const cos = Math.cos(a), sin = Math.sin(a);
    ctx.moveTo(cx + cos * inner, cy + sin * inner);
    ctx.lineTo(cx + cos * (inner + len), cy + sin * (inner + len));
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// ── 護照入境章 ────────────────────────────────────────
// 依國名雜湊決定章的形狀、墨色、角度，同一國每次都長一樣；邊緣用 SVG 濾鏡做出蓋印的毛邊
const STAMP_INKS = ['#b23a2e', '#2c5d8f', '#2f7a4f', '#6b3f8f', '#9a5b13'];
let stampSeq = 0;
function hashStr(s) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}

function countryStampInfo(a2, key) {
  const c = (a2 && ix.countryByA2.get(a2)) || (key && ix.countries.get(key)) || null;
  const name = c?.key || key || ZH_BY_A2[a2] || a2;
  if (!c || !c.eps.size) return { name, date: '', ep: '' };
  const first = [...c.eps].map(n => ix.epMeta.get(n)).filter(Boolean)
    .sort((a, b) => Date.parse(a.pubDate) - Date.parse(b.pubDate))[0];
  const d = new Date(first.pubDate);
  return { name, date: `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`, ep: `EP.${first.episode}` };
}

function stampSvg({ name, date, ep }, { faded = false } = {}) {
  const h = hashStr(name);
  const ink = faded ? '#8a8a8a' : STAMP_INKS[h % STAMP_INKS.length];
  const rot = (h >> 3) % 25 - 12;
  const id = `st${++stampSeq}`;
  const nameSize = Math.min(34, Math.floor(112 / name.length));   // 長國名（聖克里斯多福及尼維斯）縮小到框得住
  const font = `font-family="Noto Sans TC, PingFang TC, sans-serif" fill="${ink}" text-anchor="middle" font-weight="900"`;
  const font7 = font.replace('font-weight="900"', 'font-weight="700"');
  const shape = (h >> 7) % 3;
  let frame, extra;
  if (shape === 0) {
    frame = `<circle cx="80" cy="80" r="72" fill="none" stroke="${ink}" stroke-width="4"/><circle cx="80" cy="80" r="62" fill="none" stroke="${ink}" stroke-width="1.6"/>
      <path id="${id}t" d="M 26 80 A 54 54 0 0 1 134 80" fill="none"/><path id="${id}b" d="M 22 80 A 58 58 0 0 0 138 80" fill="none"/>`;
    extra = `<text ${font} font-size="10" letter-spacing="2"><textPath href="#${id}t" xlink:href="#${id}t" startOffset="50%">解鎖地球 · 入境</textPath></text>
      <text ${font} font-size="11" letter-spacing="1"><textPath href="#${id}b" xlink:href="#${id}b" startOffset="50%">${date || '節目還沒去'}</textPath></text>
      <text ${font} x="80" y="${88 + (nameSize - 27) / 3}" font-size="${nameSize}">${escHtml(name)}</text>
      <text ${font7} x="80" y="108" font-size="11">${ep}</text>`;
  } else if (shape === 1) {
    frame = `<rect x="10" y="30" width="140" height="100" rx="12" fill="none" stroke="${ink}" stroke-width="4"/><rect x="18" y="38" width="124" height="84" rx="7" fill="none" stroke="${ink}" stroke-width="1.4"/>`;
    extra = `<text ${font} x="80" y="56" font-size="10" letter-spacing="3">ARRIVAL · 入境</text>
      <text ${font} x="80" y="${87 + (nameSize - 27) / 3}" font-size="${nameSize}">${escHtml(name)}</text>
      <text ${font7} x="80" y="111" font-size="11">${date || '節目還沒去'}${ep ? ` · ${ep}` : ''}</text>`;
  } else {
    const pts = Array.from({ length: 8 }, (_, i) => { const a = Math.PI / 8 + i * Math.PI / 4; return `${80 + 72 * Math.cos(a)},${80 + 72 * Math.sin(a)}`; }).join(' ');
    frame = `<polygon points="${pts}" fill="none" stroke="${ink}" stroke-width="4"/><circle cx="80" cy="80" r="56" fill="none" stroke="${ink}" stroke-width="1.4" stroke-dasharray="3 3"/>`;
    extra = `<text ${font} x="80" y="54" font-size="8.5" letter-spacing="1">UNLOCK THE EARTH</text>
      <text ${font} x="80" y="${88 + (nameSize - 27) / 3}" font-size="${nameSize}">${escHtml(name)}</text>
      <text ${font7} x="80" y="112" font-size="10.5">${date || '節目還沒去'}</text>
      <text ${font7} x="80" y="126" font-size="10">${ep}</text>`;
  }
  return `<svg class="stamp" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 160 160" aria-label="${escHtml(name)} 入境章" role="img" style="--rot:${rot}deg">
    <defs><filter id="${id}f"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${h % 97}"/>
      <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.1 1.5"/>
      <feComposite in="SourceGraphic" operator="in"/></filter></defs>
    <g filter="url(#${id}f)" opacity="${faded ? 0.6 : 0.95}">${frame}${extra}</g></svg>`;
}

// ── 七年光軌 ──────────────────────────────────────────
// 時間線播完不清空：每一集從台灣出發的航線留成發光軌跡，像長時間曝光，最後疊成這幾年飛過的網
let trailTimer = 0;
function showTrails() {
  clearTimeout(trailTimer);
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#F4C737';
  const pin = THEMES[theme].pin;
  const eps = timeline.epsAsc.filter(e => (ix.lmByEp.get(e.episode) || []).length);
  const trails = eps.map((e, i) => {
    const v = viewFor(ix.lmByEp.get(e.episode).map(l => ({ lat: l.lat, lng: l.lon })));
    const age = i / Math.max(1, eps.length - 1);   // 越新的越亮
    return {
      startLat: HOME.lat, startLng: HOME.lng, endLat: v.lat, endLng: v.lng, solid: true,
      stroke: 0.14 + age * 0.1,
      colors: [hexToRgba(pin, 0.04 + age * 0.1), hexToRgba(accent, 0.25 + age * 0.45)],
    };
  });
  setRings([]);
  let shown = 0;
  (function grow() {
    shown = Math.min(trails.length, shown + 10);
    globe.arcsData(trails.slice(0, shown));
    if (shown < trails.length) trailTimer = setTimeout(grow, 45);
  })();
  globe.pointOfView({ lat: 28, lng: 70, altitude: IS_SMALL ? 3.4 : 2.7 }, 2400);
  timeline.trails = true;
  const box = document.getElementById('tl-trails');
  const years = Math.round((timeline.max - timeline.min) / (365.25 * 864e5));   // 2019.08 → 2026.10 是 7 年，不是 8 個年份
  document.getElementById('tl-trails-text').textContent = `${years} 年、${eps.length} 趟從台灣出發的旅程`;
  box.hidden = false;
}

function clearTrails() {
  clearTimeout(trailTimer);
  if (!timeline.trails) return;
  timeline.trails = false;
  document.getElementById('tl-trails').hidden = true;
  globe.arcsData([]);
}

// ── 封面拼貼世界地圖 ──────────────────────────────────
// 288 集封面縮圖（assets/covers，scripts/build_cover_thumbs.py）依主要地點擺在等距圓柱投影地圖上；
// 同一格被占就往外找最近的空格，台灣的幾十集會自然散到周圍海面上
const MOSAIC_COLS = 48, MOSAIC_ROWS = 24;
let mosaicBuilt = false;
function openMosaic() {
  openModal('mosaic-modal');
  if (mosaicBuilt) return;
  mosaicBuilt = true;
  const map = document.getElementById('mosaic-map');
  drawMosaicLand(document.getElementById('mosaic-land'));

  const taken = new Set();
  const cellOf = (lat, lng) => [
    Math.min(MOSAIC_COLS - 1, Math.max(0, Math.floor((lng + 180) / 360 * MOSAIC_COLS))),
    Math.min(MOSAIC_ROWS - 1, Math.max(0, Math.floor((90 - lat) / 180 * MOSAIC_ROWS))),
  ];
  const nearestFree = (cx, cy) => {
    for (let ring = 0; ring < MOSAIC_COLS; ring++) {
      let best = null, bestD = Infinity;
      for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const x = (cx + dx + MOSAIC_COLS) % MOSAIC_COLS, y = cy + dy;
        if (y < 0 || y >= MOSAIC_ROWS || taken.has(`${x},${y}`)) continue;
        const dist = dx * dx + dy * dy * 1.6;   // 偏好橫向擴散，不要往極區疊
        if (dist < bestD) { bestD = dist; best = [x, y]; }
      }
      if (best) return best;
    }
    return null;
  };

  // 地點集中的集數先放，越分散、沒地點的越晚放
  const placed = ix.mainEps.map(ep => {
    const lms = ix.lmByEp.get(ep.episode) || [];
    const v = lms.length ? viewFor(lms.map(l => ({ lat: l.lat, lng: l.lon }))) : { lat: HOME.lat, lng: HOME.lng, altitude: 9 };
    return { ep, v };
  }).sort((a, b) => a.v.altitude - b.v.altitude);

  const html = [];
  for (const { ep, v } of placed) {
    const cell = nearestFree(...cellOf(v.lat, v.lng));
    if (!cell) continue;
    taken.add(cell.join(','));
    html.push(`<button class="mz" data-ep="${ep.episode}" style="left:${cell[0] / MOSAIC_COLS * 100}%;top:${cell[1] / MOSAIC_ROWS * 100}%"
      title="Ep.${ep.episode} ${escHtml(ep.title)}"><img src="assets/covers/${ep.episode}.jpg" alt="" loading="lazy" decoding="async"
      onerror="this.src='${escHtml(epCover(ep))}'"></button>`);
  }
  map.insertAdjacentHTML('beforeend', html.join(''));
  document.getElementById('mosaic-count').textContent = `${html.length} 集`;
  map.addEventListener('click', e => {
    const b = e.target.closest('.mz');
    if (!b) return;
    closeModal('mosaic-modal');
    showEpisode(Number(b.dataset.ep));
  });
  map.addEventListener('pointerover', e => {
    const b = e.target.closest('.mz');
    document.getElementById('mosaic-caption').textContent = b ? b.title : '把滑鼠移到封面上看是哪一集，點下去就飛過去';
  });
}

function drawMosaicLand(cv) {
  const W = 1920, H = 960;
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--card-hover').trim() || 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  for (const f of countryFeatures) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) for (const ring of poly) {
      ring.forEach(([lng, lat], i) => {
        const x = (lng + 180) / 360 * W, y = (90 - lat) / 180 * H;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.closePath();
    }
  }
  ctx.fill('evenodd');
}

// ── 降落到現場 ────────────────────────────────────────
// 點地標：鏡頭從高空俯衝到地面，同時淡入那裡的照片，再拉回來看周圍
let landingTimers = [];
function landOn(lm) {
  landingTimers.forEach(clearTimeout);
  const el = document.getElementById('landing');
  el.style.backgroundImage = `url("${lm.image.replace(/"/g, '%22')}")`;
  el.querySelector('span').textContent = lm.name;
  el.classList.remove('on');
  globe.pointOfView({ lat: lm.lat, lng: lm.lon, altitude: 0.16 }, 1300);
  landingTimers = [
    setTimeout(() => el.classList.add('on'), 850),
    setTimeout(() => {
      el.classList.remove('on');
      globe.pointOfView({ lat: lm.lat, lng: lm.lon, altitude: 0.5 }, 1600);
    }, 2500),
  ];
}

function cancelLanding() {
  landingTimers.forEach(clearTimeout);
  document.getElementById('landing')?.classList.remove('on');
}

// ── 集數配色 ──────────────────────────────────────────
// 打開某一集，介面強調色換成那集封面的代表色（data/episode_colors.json，scripts/build_episode_colors.py 先算好）。
// 依深淺主題調亮度，確保文字對比；國家頁、關掉面板就換回品牌金
let episodeColors = {};
let accentEp = null;
function applyEpisodeAccent(epNum) {
  const hex = epNum != null ? episodeColors[epNum] : null;
  const root = document.documentElement.style;
  const vars = ['--accent', '--accent-deep', '--accent-text', '--accent-soft', '--line'];
  if (!hex) {
    accentEp = null;
    vars.forEach(v => root.removeProperty(v));
    if (globe) globe.atmosphereColor(THEMES[theme].atmosphere);
    return;
  }
  accentEp = epNum;
  const [h, s] = rgbToHsl(...hexToRgb(hex).split(',').map(Number));
  const sat = Math.max(0.42, Math.min(0.8, s));
  const dark = theme === 'dark';
  const accent = hslHex(h, sat, dark ? 0.66 : 0.42);
  root.setProperty('--accent', accent);
  root.setProperty('--accent-deep', hslHex(h, sat, dark ? 0.56 : 0.34));
  root.setProperty('--accent-text', hslHex(h, sat, dark ? 0.72 : 0.32));
  root.setProperty('--accent-soft', hexToRgba(accent, dark ? 0.16 : 0.18));
  root.setProperty('--line', hexToRgba(accent, dark ? 0.2 : 0.22));
  if (globe && dark) globe.atmosphereColor(hslHex(h, sat, 0.62));
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslHex(h, s, l) {
  const f = n => {
    const k = (n + h * 12) % 12;
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// ── 細密小點：國家呈現 ────────────────────────────────
// 每個國家鋪滿一格一格的細小圓點（蜂巢排列、依緯度修正成等面積），點的顏色依去過幾集走色階，台灣主場綠，
// 沒去過的是淡灰小點。點的大小跟著地球縮放（拉近點跟著變大，像印在地表上）。
// 自己建一層 THREE.Points（建構子借地標粒子物件的），全部點分成幾十組、每組一次繪製。
// globe.gl 的 hexPolygon 點陣每個點都是一片幾何，細密到十萬點會卡；粒子一點只是一個頂點
let dotSamples = null;
const dotFeatureByKey = new Map();
function buildDotSamples() {
  dotSamples = new Map();
  const inRing = (lng, lat, ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  for (const f of countryFeatures) {
    if (f.country) dotFeatureByKey.set(f.country.key, f);
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let x0 = 180, x1 = -180, y0 = 90, y1 = -90;
    for (const poly of polys) for (const [x, y] of poly[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    // 小國點距減半再減半，至少鋪得出幾十點（點距只取幾個固定值，同色同距的國家才能併成一組畫）
    let step = IS_SMALL ? 0.5 : 0.36;   // 大國的點距（度）
    while (step > 0.03 && Math.sqrt((x1 - x0) * (y1 - y0)) / step < 7) step /= 2;
    const pts = [];
    for (const poly of polys) {
      const outer = poly[0];
      const before = pts.length;
      let row = 0;
      for (let lat = Math.floor(y0 / step) * step; lat <= y1; lat += step * 0.866, row++) {
        const dLng = step / Math.max(0.2, Math.cos(lat * Math.PI / 180));   // 高緯度經線收攏，間距放寬維持等面積
        for (let lng = Math.floor(x0 / dLng) * dLng + (row % 2) * dLng / 2; lng <= x1; lng += dLng) {
          if (inRing(lng, lat, outer) && !poly.slice(1).some(h => inRing(lng, lat, h))) pts.push({ lat, lon: lng });
        }
      }
      // 太小的島國（馬爾地夫）格點落不進去：放一點在輪廓中心
      if (pts.length === before && outer.length > 2 && polys.length < 4) {
        const c = outer.reduce((s, [x, y]) => [s[0] + x / outer.length, s[1] + y / outer.length], [0, 0]);
        pts.push({ lat: c[1], lon: c[0] });
      }
    }
    dotSamples.set(f, { pts, step });
  }
}

const solidHex = (rgba, bg, boost = 1) => {   // rgba 疊在地球底色上的實色
  const [r, g, b, a = 1] = rgba.match(/[\d.]+/g).map(Number);
  return mixHex(bg, '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join(''), Math.min(1, a * boost));
};

function dotSets() {
  if (!dotSamples || !dotTexCtor()) return [];   // 貼圖建構子還沒好：先不畫，好了 setPoints 會重畫
  const t = THEMES[theme];
  const buckets = new Map();
  const offColor = solidHex(t.landOff, t.globe, 2.6);
  for (const f of countryFeatures) {
    const { pts, step } = dotSamples.get(f);
    if (!pts.length) continue;
    let color, on;
    if (visitedOn) {
      on = !!(f.a2 && visited.has(f.a2));
      color = on ? solidHex(t.visitedOn, t.globe) : offColor;
    } else {
      const h = heat(f);
      on = h >= 0;
      if (!on) color = offColor;
      else if (f.country.key === HOME_COUNTRY) color = t.home;
      else color = '#' + rampColor(t.ramp, Math.round(h * 20) / 20).map(v => v.toString(16).padStart(2, '0')).join('');
    }
    if (focus.countryKey && f.country?.key !== focus.countryKey) color = mixHex(color, t.globe, 0.6);
    const key = `${theme}|${color}|${step}|${on}`;
    if (!buckets.has(key)) {
      let set = dotSetCache.get(key);
      if (!set) {
        // 點的直徑：去過的約點距 6 成、沒去過的 4 成（世界座標，地球半徑 100）
        set = { key, alt: 0.0045, world: step * Math.PI / 180 * 100 * (on ? 0.6 : 0.4), tex: dotTexture(color) };
        dotSetCache.set(key, set);
      }
      set.items = [];
      set.sig = '';
      buckets.set(key, set);
    }
    const set = buckets.get(key);
    set.items.push(...pts);
    set.sig += f.properties.name + ',';
  }
  return [...buckets.values()];
}
const dotSetCache = new Map();

const dotObjs = new Map();   // 組 key → THREE.Points
let dotPending = null, dotRetry = 0;
const noRaycast = () => {};
function drawCountryDots(sets) {
  dotPending = sets;
  if (!globe) return;
  let proto = null;
  globe.scene().traverse(o => { if (!proto && o.__globeObjType === 'particles' && o.geometry?.getAttribute?.('position')) proto = o; });
  if (!proto) {   // 地標粒子還沒建好：稍後再畫
    if (!dotRetry) dotRetry = setTimeout(() => { dotRetry = 0; drawCountryDots(dotPending); }, 300);
    return;
  }
  const Points = proto.constructor, Geom = proto.geometry.constructor, Mat = proto.material.constructor;
  const Attr = proto.geometry.getAttribute('position').constructor;
  // 粒子大小隨距離縮放時，three 的換算等於 90° 視角；依實際視角換回世界座標的直徑（貼圖圓只佔 30/32）
  const fovK = 1 / Math.tan(((globe.camera()?.fov || 50) / 2) * Math.PI / 180) * 32 / 30;
  const used = new Set();
  for (const set of sets) {
    used.add(set.key);
    let o = dotObjs.get(set.key);
    if (!o) {
      o = new Points(new Geom(), new Mat({ size: set.world * fovK, sizeAttenuation: true, map: set.tex, alphaTest: 0.5 }));
      o.frustumCulled = false;
      o.raycast = noRaycast;   // 點不攔滑鼠：國家的滑過／點擊交給底下的填色層
      proto.parent.add(o);
      dotObjs.set(set.key, o);
    }
    o.visible = set.items.length > 0;
    if (o.__sig === set.sig) continue;   // 同一組國家沒變就不重算位置
    o.__sig = set.sig;
    const xyz = new Float32Array(set.items.length * 3);
    set.items.forEach((p, i) => {
      const c = p.xyz || (p.xyz = globe.getCoords(p.lat, p.lon, set.alt));
      xyz[i * 3] = c.x; xyz[i * 3 + 1] = c.y; xyz[i * 3 + 2] = c.z;
    });
    o.geometry.dispose();
    o.geometry = new Geom();
    o.geometry.setAttribute('position', new Attr(xyz, 3));
  }
  for (const [key, o] of dotObjs) if (!used.has(key)) o.visible = false;
}
