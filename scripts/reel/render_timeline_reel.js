#!/usr/bin/env node
'use strict';

/*
 * 把網站的「時間線」動畫渲染成 IG Reels 直式影片（1080×1920、30fps、H.264）。
 * 不開瀏覽器：用 d3-geo 正射投影在 canvas 上逐格畫地球，raw frame 直接 pipe 給 ffmpeg。
 *
 * Usage:
 *   cd scripts/reel && npm install
 *   node render_timeline_reel.js                    # → exports/timeline-reel.mp4
 *   node render_timeline_reel.js --out x.mp4 --preview 0,300,600   # 只輸出指定格的 PNG 檢查
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createCanvas, GlobalFonts, loadImage } = require('@napi-rs/canvas');
const d3 = require('d3-geo');
const h3 = require('h3-js');

const SITE = path.resolve(__dirname, '../..');
const UTE = require(path.join(SITE, 'js/globe/data.js'));

// ── 參數 ──────────────────────────────────────────────
const W = 1080, H = 1920, FPS = 60;   // 60fps：旋轉比 30fps 順，接近螢幕錄影的觀感
const INTRO_S = 3, MAIN_S = 50, OUTRO_S = 7;   // 共 60 秒
const TOTAL = Math.round((INTRO_S + MAIN_S + OUTRO_S) * FPS);
const GLOBE = { x: W / 2, y: 820, r: 430 };
const HOME_COUNTRY = '台灣';
const C = {
  gold: '#F4C737', pin: '#7FD8F5', text: '#eef2fa', sub: 'rgba(238,242,250,0.62)',
  land: [150, 162, 180], ramp: ['#574b37', '#80663b', '#ab813a', '#da9c34', '#ffb823'],
};

const args = process.argv.slice(2);
const argOf = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const OUT = path.resolve(argOf('--out') || path.join(SITE, 'exports/timeline-reel.mp4'));
const PREVIEW = argOf('--preview')?.split(',').map(Number);
const CAMLOG = args.includes('--camlog');   // 只算鏡頭路徑、印出平滑度，不渲染

// ── 字型（Klee One／Fredoka 沒裝就從 Google Fonts repo 抓）──
const FONT_DIR = path.join(__dirname, 'fonts');
const FONTS = {
  'Klee One': 'https://raw.githubusercontent.com/google/fonts/main/ofl/kleeone/KleeOne-SemiBold.ttf',
  'Fredoka': 'https://raw.githubusercontent.com/google/fonts/main/ofl/fredoka/Fredoka%5Bwdth,wght%5D.ttf',
};
async function ensureFonts() {
  fs.mkdirSync(FONT_DIR, { recursive: true });
  for (const [family, url] of Object.entries(FONTS)) {
    const file = path.join(FONT_DIR, `${family.replace(/\s/g, '')}.ttf`);
    if (!fs.existsSync(file)) {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`字型下載失敗 ${family}: ${r.status}`);
      fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    }
    GlobalFonts.registerFromPath(file, family);
  }
}
const KLEE = '"Klee One", "Noto Sans TC", "Noto Sans CJK TC"';
const SANS = '"Noto Sans TC", "Noto Sans CJK TC", "PingFang TC"';
const NUM = '"Fredoka", "Noto Sans TC"';

// ── 資料 ──────────────────────────────────────────────
function loadData() {
  const read = f => JSON.parse(fs.readFileSync(path.join(SITE, f), 'utf8'));
  const landmarks = read('data/landmarks_global.json');
  const ix = UTE.buildIndex(read('data/episodes.json'), landmarks);
  const geo = read('data/countries.json');

  const eps = [...ix.mainEps].sort((a, b) => Date.parse(a.pubDate) - Date.parse(b.pubDate));
  const epMs = eps.map(e => Date.parse(e.pubDate));
  const lmTimes = landmarks.map(lm => ix.lmFirstMs.get(lm)).filter(Number.isFinite);
  const t0 = Math.min(epMs[0], ...lmTimes), t1 = Math.max(epMs.at(-1), ...lmTimes);

  // 每個國家各集的上架時間（遞增），用來算「到時間 t 為止去過幾集」
  const countryEpTimes = new Map();
  for (const c of ix.countries.values()) {
    countryEpTimes.set(c.key, [...c.eps].map(n => Date.parse(ix.epMeta.get(n).pubDate)).sort((a, b) => a - b));
  }
  const maxEps = Math.max(...[...ix.countries.values()].filter(c => c.key !== HOME_COUNTRY).map(c => c.eps.size));

  // 國家點陣：沿用網站預算好的 h3 解析度，取每格中心
  const dots = [];
  geo.features.forEach((f, fi) => {
    const { a2, zh } = UTE.featureCountry(f);
    f.countryKey = ((a2 && ix.countryByA2.get(a2)) || ix.countries.get(zh))?.key || null;
    const res = Math.max(3, f.properties.hexRes || 3);
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const p of polys) {
      for (const cell of h3.polygonToCells(p, res, true)) {
        const [lat, lng] = h3.cellToLatLng(cell);
        dots.push({ lng, lat, v: vec(lat, lng), fi, small: res > 3 });
      }
    }
  });

  const lms = landmarks
    .filter(lm => Number.isFinite(ix.lmFirstMs.get(lm)))
    .map(lm => ({ lm, t: ix.lmFirstMs.get(lm), v: vec(lm.lat, lm.lon) }))
    .sort((a, b) => a.t - b.t);

  return { ix, geo, eps, epMs, t0, t1, countryEpTimes, maxEps, dots, lms };
}

// ── 數學小工具 ────────────────────────────────────────
const RAD = Math.PI / 180;
function vec(lat, lng) {
  return [Math.cos(lat * RAD) * Math.cos(lng * RAD), Math.cos(lat * RAD) * Math.sin(lng * RAD), Math.sin(lat * RAD)];
}
function toLatLng([x, y, z]) {
  return { lat: Math.atan2(z, Math.hypot(x, y)) / RAD, lng: Math.atan2(y, x) / RAD };
}
const norm = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const ease = t => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
function countLE(sorted, t) {   // sorted 中 <= t 的個數
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; sorted[m] <= t ? lo = m + 1 : hi = m; }
  return lo;
}
function rampColor(h) {
  const x = clamp(h) * (C.ramp.length - 1);
  const i = Math.min(C.ramp.length - 2, Math.floor(x));
  const a = hexRgb(C.ramp[i]), b = hexRgb(C.ramp[i + 1]);
  return a.map((v, k) => Math.round(v + (b[k] - v) * (x - i)));
}
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

// ── 時間軸 ────────────────────────────────────────────
function makeClock(D) {
  return frame => {
    const s = frame / FPS;
    if (s < INTRO_S) return { phase: 'intro', p: s / INTRO_S, t: D.t0 - 1 };
    if (s < INTRO_S + MAIN_S) {
      const p = (s - INTRO_S) / MAIN_S;
      return { phase: 'main', p, t: D.t0 + (D.t1 - D.t0) * p };
    }
    return { phase: 'outro', p: (s - INTRO_S - MAIN_S) / OUTRO_S, t: D.t1 };
  };
}
// 某個時間點在影片中的第幾格（地標冒出的光圈動畫用）
const frameOfTime = (D, t) => Math.round((INTRO_S + (t - D.t0) / (D.t1 - D.t0) * MAIN_S) * FPS);

// ── 靜態圖層（只畫一次）──────────────────────────────
function paintStatic() {
  const bg = createCanvas(W, H), g = bg.getContext('2d');
  const grad = g.createRadialGradient(W / 2, GLOBE.y, 100, W / 2, GLOBE.y, 1500);
  grad.addColorStop(0, '#13244a'); grad.addColorStop(0.5, '#081227'); grad.addColorStop(1, '#03060f');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  let seed = 5;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 700; i++) {
    g.globalAlpha = 0.15 + rnd() * 0.7;
    g.fillStyle = rnd() < 0.15 ? '#ffe6b0' : rnd() < 0.3 ? '#cfe0ff' : '#ffffff';
    g.beginPath(); g.arc(rnd() * W, rnd() * H, rnd() ** 3 * 1.8 + 0.35, 0, 7); g.fill();
  }
  g.globalAlpha = 1;
  // 大氣光暈
  const atm = g.createRadialGradient(GLOBE.x, GLOBE.y, GLOBE.r * 0.96, GLOBE.x, GLOBE.y, GLOBE.r * 1.22);
  atm.addColorStop(0, 'rgba(111,180,255,0.42)'); atm.addColorStop(0.35, 'rgba(111,180,255,0.12)'); atm.addColorStop(1, 'rgba(111,180,255,0)');
  g.fillStyle = atm; g.beginPath(); g.arc(GLOBE.x, GLOBE.y, GLOBE.r * 1.22, 0, 7); g.fill();
  // 球體
  const sph = g.createRadialGradient(GLOBE.x - GLOBE.r * 0.35, GLOBE.y - GLOBE.r * 0.4, GLOBE.r * 0.1, GLOBE.x, GLOBE.y, GLOBE.r);
  sph.addColorStop(0, '#1d3666'); sph.addColorStop(0.7, '#0c1a36'); sph.addColorStop(1, '#070f22');
  g.fillStyle = sph; g.beginPath(); g.arc(GLOBE.x, GLOBE.y, GLOBE.r, 0, 7); g.fill();
  return bg;
}

// ── 每一格 ────────────────────────────────────────────
async function main() {
  await ensureFonts();
  const D = loadData();
  const clock = makeClock(D);
  const staticLayer = paintStatic();
  const logo = await loadImage(path.join(SITE, 'assets/logo-256.png'));
  const projection = d3.geoOrthographic().scale(GLOBE.r).translate([GLOBE.x, GLOBE.y]).clipAngle(90).precision(0.3);
  const graticule = d3.geoGraticule10();

  const home = UTE.HOME;
  let cam = vec(home.lat, home.lng);
  let vel = [0, 0, 0];
  // 臨界阻尼彈簧：位置與速度都連續，鏡頭會慢慢加速、慢慢停（一階平滑會讓速度瞬間跳變，看起來就是卡）
  const OMEGA = 1.1;   // 越小鏡頭越慢、越柔
  const springTo = target => {
    const s = 1 / FPS;
    vel = vel.map((v, i) => v + ((target[i] - cam[i]) * OMEGA * OMEGA - 2 * OMEGA * v) * s);
    cam = norm(cam.map((x, i) => x + vel[i] * s));
  };
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const geoPath = d3.geoPath(projection, ctx);
  const lmAppear = D.lms.map(x => frameOfTime(D, x.t));
  console.log(`dots ${D.dots.length}, landmarks ${D.lms.length}, frames ${TOTAL}, ${(TOTAL / FPS).toFixed(1)}s`);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const camPath = [];
  let ff = null;
  if (!PREVIEW && !CAMLOG) {
    ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart', OUT],
      { stdio: ['pipe', 'inherit', 'inherit'] });
  }

  let lastEp = null, epChangeFrame = 0;
  const frames = PREVIEW || [...Array(TOTAL).keys()];
  for (const frame of frames) {
    const { phase, p, t } = clock(frame);

    // 鏡頭：追最近 6 集地點的加權平均，平滑移動；片尾慢慢自轉
    if (phase === 'main') {
      const k = countLE(D.epMs, t);
      let target = [0, 0, 0], wsum = 0;
      for (let i = k - 1, w = 1, n = 0; i >= 0 && n < 6; i--) {
        const lms = D.ix.lmByEp.get(D.eps[i].episode) || [];
        if (!lms.length) continue;
        const c = norm(lms.reduce((s, l) => { const v = vec(l.lat, l.lon); return [s[0] + v[0], s[1] + v[1], s[2] + v[2]]; }, [0, 0, 0]));
        target = target.map((x, j) => x + c[j] * w); wsum += w; w *= 0.6; n++;
      }
      if (wsum) springTo(norm(target));
    } else if (phase === 'outro') {
      // 片尾自轉：目標放在東邊，交給同一個彈簧，銜接不頓
      const ll = toLatLng(cam);
      springTo(vec(15, ll.lng + 20));
    } else {
      springTo(vec(home.lat, home.lng));
    }
    if (PREVIEW) cam = previewCam(D, t, phase);   // 單格預覽沒有前一格可平滑
    const { lat: cLat, lng: cLng } = toLatLng(cam);
    if (CAMLOG) { camPath.push(cam); continue; }
    projection.rotate([-cLng, -cLat]);

    ctx.drawImage(staticLayer, 0, 0);
    const globeIn = phase === 'intro' ? ease(clamp(p * 1.4)) : 1;

    // 經緯網
    ctx.globalAlpha = 0.07 * globeIn;
    ctx.strokeStyle = '#9fc4ff'; ctx.lineWidth = 1;
    ctx.beginPath(); geoPath(graticule); ctx.stroke();
    ctx.globalAlpha = 1;

    // 國家點陣：依「到 t 為止去過幾集」上色
    const featColor = D.geo.features.map(f => {
      const n = f.countryKey ? countLE(D.countryEpTimes.get(f.countryKey) || [], t) : 0;
      if (!n) return null;
      const h = f.countryKey === HOME_COUNTRY ? 1 : Math.sqrt(clamp((n - 1) / (D.maxEps - 1)));
      return rampColor(h);
    });
    const buckets = new Map();
    for (const d of D.dots) {
      const cos = dot3(d.v, cam);
      if (cos < 0.03) continue;
      const lit = featColor[d.fi];
      const b = Math.min(15, Math.floor(cos * 16));   // 16 階：旋轉時跨階不會明顯跳動
      const key = `${lit ? lit.join(',') : 'base'}|${b}`;
      if (!buckets.has(key)) buckets.set(key, { lit, b, pts: [] });
      buckets.get(key).pts.push(projection([d.lng, d.lat]), d.small);
    }
    for (const { lit, b, pts } of buckets.values()) {
      const limb = 0.35 + 0.65 * ((b + 0.5) / 16);
      ctx.fillStyle = lit ? `rgba(${lit},${(0.95 * (0.55 + 0.45 * limb) * globeIn).toFixed(3)})` : `rgba(${C.land},${(0.34 * limb * globeIn).toFixed(3)})`;
      ctx.beginPath();
      const rr = (lit ? 2.9 : 2.5) * (0.55 + 0.45 * limb);
      for (let i = 0; i < pts.length; i += 2) {
        const [x, y] = pts[i];
        const r = pts[i + 1] ? rr * 0.6 : rr;
        ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    // 地標：青色光點，剛出現的放光圈
    ctx.fillStyle = C.pin;
    const rings = [];
    ctx.beginPath();
    for (let i = 0; i < D.lms.length && D.lms[i].t <= t; i++) {
      const { lm, v } = D.lms[i];
      const cos = dot3(v, cam);
      if (cos < 0.05) continue;
      const [x, y] = projection([lm.lon, lm.lat]);
      const r = 2.6 * (0.6 + 0.4 * cos);
      ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2);
      const age = (frame - lmAppear[i]) / FPS;
      if (age >= 0 && age < 1.1) rings.push({ x, y, age, cos });
    }
    ctx.fill();
    for (const { x, y, age, cos } of rings) {
      ctx.strokeStyle = `rgba(127,216,245,${((1 - age / 1.1) * 0.9 * cos).toFixed(3)})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(x, y, 4 + age * 26, 0, Math.PI * 2); ctx.stroke();
    }

    // 最新一集：從台灣拉弧線到這集的地點
    const k = countLE(D.epMs, t);
    const curEp = k ? D.eps[k - 1] : null;
    if (curEp !== lastEp) { lastEp = curEp; epChangeFrame = PREVIEW ? frame - 18 : frame; }   // 預覽單格時假裝弧線已畫一半
    if (phase === 'main' && curEp) {
      const prog = clamp((frame - epChangeFrame) / (FPS * 0.9));
      const fade = 1 - clamp((frame - epChangeFrame - FPS * 1.4) / (FPS * 0.6));
      const targets = (D.ix.lmByEp.get(curEp.episode) || []).slice(0, 10);
      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(127,216,245,${(0.85 * fade).toFixed(3)})`;
      for (const l of targets) {
        const interp = d3.geoInterpolate([home.lng, home.lat], [l.lon, l.lat]);
        const coords = Array.from({ length: 33 }, (_, i) => interp((i / 32) * prog));
        ctx.beginPath(); geoPath({ type: 'LineString', coordinates: coords }); ctx.stroke();
      }
    }
    // 台北起點
    if (dot3(vec(home.lat, home.lng), cam) > 0.05) {
      const [hx, hy] = projection([home.lng, home.lat]);
      ctx.strokeStyle = C.gold; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(hx, hy, 7, 0, Math.PI * 2); ctx.stroke();
    }

    paintOverlay(ctx, D, { frame, phase, p, t, curEp, epChangeFrame, logo });

    if (PREVIEW) {
      const f = path.join(path.dirname(OUT), `preview-${frame}.png`);
      fs.writeFileSync(f, await canvas.encode('png'));
      console.log(f);
    } else {
      const ok = ff.stdin.write(Buffer.from(ctx.getImageData(0, 0, W, H).data.buffer));
      if (!ok) await new Promise(r => ff.stdin.once('drain', r));
      if (frame % 180 === 0) process.stdout.write(`\r${frame}/${TOTAL}`);
    }
  }

  if (CAMLOG) {
    const ang = (a, b) => Math.acos(Math.min(1, dot3(a, b))) / RAD;
    const speed = camPath.slice(1).map((c, i) => ang(camPath[i], c) * FPS);          // 度／秒
    const jerk = speed.slice(1).map((s, i) => Math.abs(s - speed[i]));               // 相鄰兩格速度差
    console.log(`camera: max ${Math.max(...speed).toFixed(1)}°/s, mean ${(speed.reduce((a, b) => a + b) / speed.length).toFixed(1)}°/s, max speed change ${Math.max(...jerk).toFixed(2)}°/s per frame`);
  }
  if (ff) {
    ff.stdin.end();
    await new Promise((res, rej) => ff.on('close', code => code === 0 ? res() : rej(new Error(`ffmpeg exit ${code}`))));
    console.log(`\n完成：${OUT}`);
  }
}

// 預覽單格時直接用目標位置當鏡頭
function previewCam(D, t, phase) {
  const k = countLE(D.epMs, t);
  for (let i = k - 1; i >= 0; i--) {
    const lms = D.ix.lmByEp.get(D.eps[i].episode) || [];
    if (lms.length && phase === 'main') return norm(lms.reduce((s, l) => { const v = vec(l.lat, l.lon); return [s[0] + v[0], s[1] + v[1], s[2] + v[2]]; }, [0, 0, 0]));
  }
  return vec(UTE.HOME.lat - 8, UTE.HOME.lng - 25);
}

// ── 文字與介面層 ──────────────────────────────────────
// IG Reels 安全區：上方約 220px、下方約 330px 會被介面擋住，重要資訊放在中段
function paintOverlay(ctx, D, { frame, phase, p, t, curEp, epChangeFrame, logo }) {
  const center = (text, y, font, color) => { ctx.font = font; ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.fillText(text, W / 2, y); ctx.textAlign = 'left'; };

  // 頂部品牌
  ctx.drawImage(logo, W / 2 - 250, 232, 72, 72);
  ctx.font = `600 50px ${KLEE}`; ctx.fillStyle = C.gold; ctx.fillText('解鎖地球', W / 2 - 160, 282);
  ctx.font = `500 25px ${SANS}`; ctx.fillStyle = C.sub; ctx.fillText('我們用耳朵走過的世界', W / 2 + 60, 280);

  const year0 = new Date(D.t0).getFullYear(), year1 = new Date(D.t1).getFullYear();
  if (phase === 'intro') {
    const a = clamp(Math.sin(Math.min(1, p * 1.15) * Math.PI) * 1.6);
    ctx.globalAlpha = a;
    center(`${year0} → ${year1}`, GLOBE.y - 10, `600 96px ${NUM}`, '#ffffff');
    center('解鎖地球的旅行地圖', GLOBE.y + 70, `600 48px ${KLEE}`, C.gold);
    ctx.globalAlpha = 1;
  }

  const k = countLE(D.epMs, t);
  const nLms = countLE(D.lms.map(x => x.t), t);
  const nCty = [...D.countryEpTimes].filter(([key, ts]) => key && ts.length && ts[0] <= t && D.ix.countries.get(key)?.a2).length;

  // 日期大字
  const d = new Date(Math.min(t, D.t1));
  const dateText = phase === 'intro' ? `${year0}.${String(new Date(D.t0).getMonth() + 1).padStart(2, '0')}` : `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
  // 片尾：日期先完全淡出，總結再淡入，兩段文字不重疊
  const dateOut = phase === 'outro' ? ease(clamp(p / 0.15)) : 0;
  const outroA = phase === 'outro' ? ease(clamp((p - 0.15) / 0.2)) : 0;
  ctx.globalAlpha = 1 - dateOut;
  center(dateText, 1370, `600 120px ${NUM}`, C.gold);
  ctx.globalAlpha = 1;

  // 三個計數
  const stats = [[phase === 'intro' ? 0 : k, '集節目'], [phase === 'intro' ? 0 : nLms, '個地標'], [phase === 'intro' ? 0 : nCty, '個國家']];
  stats.forEach(([n, label], i) => {
    const x = W / 2 + (i - 1) * 290;
    ctx.textAlign = 'center';
    ctx.font = `600 58px ${NUM}`; ctx.fillStyle = C.text; ctx.fillText(n.toLocaleString(), x, 1470);
    ctx.font = `500 25px ${SANS}`; ctx.fillStyle = C.sub; ctx.fillText(label, x, 1508);
    ctx.textAlign = 'left';
  });

  // 目前這一集
  if (phase === 'main' && curEp) {
    const a = clamp((frame - epChangeFrame) / (FPS * 0.2));
    ctx.globalAlpha = a;
    const title = curEp.title.split('|')[0].trim();
    ctx.font = `600 30px ${NUM}`;
    const label = `EP.${curEp.episode}`;
    const lw = ctx.measureText(label).width;
    ctx.font = `500 30px ${SANS}`;
    let tt = title;
    while (ctx.measureText(tt).width > 760 - lw && tt.length > 2) tt = tt.slice(0, -1);
    if (tt !== title) tt = tt.slice(0, -1) + '…';
    const total = lw + 16 + ctx.measureText(tt).width;
    const x0 = (W - total) / 2;
    ctx.font = `600 30px ${NUM}`; ctx.fillStyle = C.pin; ctx.fillText(label, x0, 1574);
    ctx.font = `500 30px ${SANS}`; ctx.fillStyle = C.text; ctx.fillText(tt, x0 + lw + 16, 1574);
    ctx.globalAlpha = 1;
  }

  // 進度條
  const barX = 140, barW = W - 280, barY = 1612;
  const prog = phase === 'intro' ? 0 : phase === 'outro' ? 1 : p;
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; roundRect(ctx, barX, barY, barW, 6, 3); ctx.fill();
  ctx.fillStyle = C.gold; roundRect(ctx, barX, barY, Math.max(6, barW * prog), 6, 3); ctx.fill();
  ctx.font = `500 19px ${NUM}`; ctx.fillStyle = 'rgba(238,242,250,0.45)'; ctx.textAlign = 'center';
  for (let y = year0 + 1; y <= year1; y++) {
    const px = barX + barW * (Date.parse(`${y}-01-01`) - D.t0) / (D.t1 - D.t0);
    ctx.fillText(String(y), px, barY + 36);
  }
  ctx.textAlign = 'left';

  // 片尾
  if (phase === 'outro') {
    ctx.globalAlpha = outroA;
    center(`${year1 - year0} 年 · ${D.eps.length} 集`, 1365, `600 72px ${KLEE}`, C.gold);
    ctx.globalAlpha = ease(clamp((p - 0.4) / 0.25));
    center('Podcast 搜尋「解鎖地球」', 1574, `600 34px ${SANS}`, C.text);
    ctx.globalAlpha = 1;
  }
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

main().catch(e => { console.error(e); process.exit(1); });
