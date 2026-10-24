'use strict';

// 把時間線動畫匯出成 IG Reels 直式影片（1080×1920、30fps、H.264 MP4）。
// 畫面就是網頁上的 3D 地球本身：錄製時把 requestAnimationFrame／performance.now 換成虛擬時鐘，
// 一格一格推進、渲染、編碼，所以再慢的電腦也不會掉幀，輸出跟網頁播放一致。
// 編碼用瀏覽器內建 WebCodecs，封裝用 mp4-muxer，全部在本機完成。

const REEL = { W: 1080, H: 1920, FPS: 30, INTRO: 1.8, OUTRO: 5, ALT: 3.9, GLOBE_Y: 820 };
const MUXER_URL = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/build/mp4-muxer.min.js';
const REEL_FONTS = ['600 50px "Klee One"', '600 120px "Fredoka"', '500 30px "Noto Sans TC"', '700 30px "Noto Sans TC"'];

function canExportReel() {
  return 'VideoEncoder' in window && 'VideoFrame' in window;
}

async function exportReel() {
  if (reel.active) return;
  if (!canExportReel()) return toast('這個瀏覽器不支援匯出影片，請用電腦版 Chrome 或 Edge');

  reel.active = true;
  reel.cancelled = false;
  setReelProgress(0, '準備中…');
  openModal('reel-modal');

  const restore = [];
  let clock = null;
  try {
    await loadScriptOnce(MUXER_URL);
    if (document.fonts) await Promise.all(REEL_FONTS.map(f => document.fonts.load(f).catch(() => null)));
    const codec = await pickCodec();
    if (!codec) throw new Error('沒有可用的 H.264 編碼器');
    const logo = await loadReelImage('assets/logo-256.png');

    // ── 舞台：深色主題、直式尺寸、地球往上移留空間給下方文字 ──
    const prevTheme = theme;
    if (theme !== 'dark') { applyTheme('dark', false); restore.push(() => applyTheme(prevTheme, false)); }
    if (story.on) exitStory();
    stopTimelinePlay();
    const renderer = globe.renderer();
    const prevRatio = renderer.getPixelRatio();
    renderer.setPixelRatio(1);
    globe.width(REEL.W).height(REEL.H).globeOffset([0, REEL.GLOBE_Y - REEL.H / 2]);
    restore.push(() => {
      renderer.setPixelRatio(prevRatio);
      globe.width(innerWidth).height(innerHeight).globeOffset([0, 0]);
    });
    document.body.classList.add('reel-recording');
    restore.push(() => document.body.classList.remove('reel-recording'));

    enterTimeline({ autoplay: false, altitude: REEL.ALT });
    restore.push(() => exitTimeline());

    // ── 虛擬時鐘 ──
    clock = installVirtualClock();

    const mainFrames = Math.round(TIMELINE_PLAY_MS / 1000 * REEL.FPS);
    const introFrames = Math.round(REEL.INTRO * REEL.FPS);
    const outroFrames = Math.round(REEL.OUTRO * REEL.FPS);
    const total = introFrames + mainFrames + outroFrames;
    const dt = 1000 / REEL.FPS;

    const muxer = new Mp4Muxer.Muxer({
      target: new Mp4Muxer.ArrayBufferTarget(),
      video: { codec: 'avc', width: REEL.W, height: REEL.H, frameRate: REEL.FPS },
      fastStart: 'in-memory',
    });
    let encodeError = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: e => { encodeError = e; },
    });
    encoder.configure({ codec, width: REEL.W, height: REEL.H, bitrate: 12e6, framerate: REEL.FPS, avc: { format: 'avc' } });

    const comp = document.createElement('canvas');
    comp.width = REEL.W;
    comp.height = REEL.H;
    const ctx = comp.getContext('2d');
    const backdrop = paintReelBackdrop();

    // 先讓地球在起點穩定幾格，並留真實時間給日夜貼圖、點陣載入
    setTimeline(timeline.min - 1);
    for (let i = 0; i < 10; i++) { stepTimelineCamera(dt); clock.tick(dt); }
    await clock.realWait(600);
    clock.tick(dt);

    for (let f = 0; f < total; f++) {
      if (reel.cancelled) throw new Error('cancelled');
      if (encodeError) throw encodeError;

      let phase, p;
      if (f < introFrames) { phase = 'intro'; p = f / introFrames; }
      else if (f < introFrames + mainFrames) { phase = 'main'; p = (f - introFrames) / mainFrames; }
      else { phase = 'outro'; p = (f - introFrames - mainFrames) / outroFrames; }

      if (phase === 'intro') {
        setTimeline(timeline.min - 1);
        stepTimelineCamera(dt);
      } else if (phase === 'main') {
        setTimeline(timeline.min + (timeline.max - timeline.min) * p);
        stepTimelineCamera(dt);
      } else {
        if (f === introFrames + mainFrames) { setTimeline(timeline.max); setArcs([]); }
        // 片尾慢慢自轉：目標放在目前位置東邊，交給同一個彈簧帶過去，銜接不會頓
        const ll = toLatLng(timeline.cam);
        stepTimelineCamera(dt, vec3(15, ll.lng + 20));
      }

      clock.tick(dt);
      renderer.render(globe.scene(), globe.camera());   // 同一個 task 內讀取 WebGL 畫面，不需 preserveDrawingBuffer

      ctx.drawImage(backdrop, 0, 0);
      ctx.drawImage(renderer.domElement, 0, 0, REEL.W, REEL.H);
      paintReelOverlay(ctx, { phase, p, f, logo });

      const frame = new VideoFrame(comp, { timestamp: Math.round(f * 1e6 / REEL.FPS), duration: Math.round(1e6 / REEL.FPS) });
      encoder.encode(frame, { keyFrame: f % (REEL.FPS * 2) === 0 });
      frame.close();

      if (encoder.encodeQueueSize > 6 || f % 15 === 0) {
        setReelProgress(f / total, `錄製中 ${Math.round(f / total * 100)}%`);
        await clock.realWait(encoder.encodeQueueSize > 6 ? 8 : 0);
      }
    }

    setReelProgress(1, '封裝影片…');
    await encoder.flush();
    muxer.finalize();
    const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '解鎖地球_時間線_reels.mp4';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    toast(`影片已下載（${(blob.size / 1048576).toFixed(1)} MB）`);
  } catch (e) {
    if (e.message !== 'cancelled') {
      console.error('reel export failed', e);
      toast('影片匯出失敗，請再試一次（建議用電腦版 Chrome）');
    }
  } finally {
    clock?.uninstall();
    while (restore.length) { try { restore.pop()(); } catch (e) { console.error(e); } }
    reel.active = false;
    closeModal('reel-modal');
  }
}

// ── 虛擬時鐘 ──────────────────────────────────────────
// globe.gl 每格都會重新呼叫全域 requestAnimationFrame，換掉之後渲染迴圈就由我們一格一格推
function installVirtualClock() {
  const real = {
    raf: window.requestAnimationFrame, caf: window.cancelAnimationFrame,
    now: performance.now, dateNow: Date.now, setTimeout: window.setTimeout.bind(window),
  };
  const t0 = real.now.call(performance);
  const d0 = real.dateNow();
  let vnow = t0;
  let id = 0;
  const queue = new Map();

  window.requestAnimationFrame = cb => { queue.set(++id, cb); return id; };
  window.cancelAnimationFrame = i => queue.delete(i);
  performance.now = () => vnow;
  Date.now = () => d0 + (vnow - t0);

  return {
    tick(ms) {
      vnow += ms;
      const cbs = [...queue.values()];
      queue.clear();
      for (const cb of cbs) cb(vnow);
    },
    realWait: ms => new Promise(r => real.setTimeout(r, ms)),
    uninstall() {
      window.requestAnimationFrame = real.raf;
      window.cancelAnimationFrame = real.caf;
      performance.now = real.now;
      Date.now = real.dateNow;
      // 把排隊中的回呼交還真正的 rAF，globe.gl 的渲染迴圈才會繼續
      for (const cb of queue.values()) real.raf.call(window, cb);
      queue.clear();
    },
  };
}

async function pickCodec() {
  for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42e028']) {
    const { supported } = await VideoEncoder.isConfigSupported({ codec, width: REEL.W, height: REEL.H, bitrate: 12e6, framerate: REEL.FPS });
    if (supported) return codec;
  }
  return null;
}

// ── 畫面 ──────────────────────────────────────────────
function paintReelBackdrop() {
  const cv = document.createElement('canvas');
  cv.width = REEL.W;
  cv.height = REEL.H;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(REEL.W / 2, REEL.GLOBE_Y, 100, REEL.W / 2, REEL.GLOBE_Y, 1500);
  grad.addColorStop(0, '#13244a');
  grad.addColorStop(0.5, '#081227');
  grad.addColorStop(1, '#03060f');
  g.fillStyle = grad;
  g.fillRect(0, 0, REEL.W, REEL.H);
  let seed = 5;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 700; i++) {
    g.globalAlpha = 0.15 + rnd() * 0.7;
    g.fillStyle = rnd() < 0.15 ? '#ffe6b0' : rnd() < 0.3 ? '#cfe0ff' : '#ffffff';
    g.beginPath();
    g.arc(rnd() * REEL.W, rnd() * REEL.H, rnd() ** 3 * 1.8 + 0.35, 0, Math.PI * 2);
    g.fill();
  }
  return cv;
}

// IG Reels 安全區：上方約 220px、下方約 330px 會被介面擋住，資訊放在中段
function paintReelOverlay(ctx, { phase, p, f, logo }) {
  const W = REEL.W;
  const KLEE = '"Klee One", "Noto Sans TC", sans-serif';
  const SANS = '"Noto Sans TC", "PingFang TC", sans-serif';
  const NUM = '"Fredoka", "Noto Sans TC", sans-serif';
  const gold = '#F4C737', pin = '#7FD8F5', text = '#eef2fa', sub = 'rgba(238,242,250,0.62)';
  const clamp01 = x => Math.max(0, Math.min(1, x));
  const ease = t => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  const center = (str, y, font, color) => {
    ctx.font = font; ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.fillText(str, W / 2, y); ctx.textAlign = 'left';
  };

  // 品牌列
  ctx.drawImage(logo, W / 2 - 250, 232, 72, 72);
  ctx.font = `600 50px ${KLEE}`; ctx.fillStyle = gold; ctx.fillText('解鎖地球', W / 2 - 160, 282);
  ctx.font = `500 25px ${SANS}`; ctx.fillStyle = sub; ctx.fillText('我們用耳朵走過的世界', W / 2 + 60, 280);

  const y0 = new Date(timeline.min).getFullYear();
  const y1 = new Date(timeline.max).getFullYear();

  if (phase === 'intro') {
    ctx.globalAlpha = clamp01(Math.sin(Math.min(1, p * 1.15) * Math.PI) * 1.6);
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 24;
    center(`${y0} → ${y1}`, REEL.GLOBE_Y - 10, `600 96px ${NUM}`, '#ffffff');
    center('解鎖地球的旅行地圖', REEL.GLOBE_Y + 70, `600 48px ${KLEE}`, gold);
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  }

  // 日期大字（片尾先淡出，再換成總結）
  const dateOut = phase === 'outro' ? ease(clamp01(p / 0.15)) : 0;
  const outroIn = phase === 'outro' ? ease(clamp01((p - 0.15) / 0.2)) : 0;
  const d = new Date(Math.max(timeline.ms, timeline.min));
  ctx.globalAlpha = 1 - dateOut;
  center(`${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`, 1370, `600 120px ${NUM}`, gold);
  ctx.globalAlpha = 1;

  // 計數
  const counts = [[Math.max(0, timeline.nEps), '集節目'], [Math.max(0, timeline.nVisible), '個地標'], [timeline.countryCounts.size, '個國家']];
  counts.forEach(([n, label], i) => {
    const x = W / 2 + (i - 1) * 290;
    ctx.textAlign = 'center';
    ctx.font = `600 58px ${NUM}`; ctx.fillStyle = text; ctx.fillText(n.toLocaleString(), x, 1470);
    ctx.font = `500 25px ${SANS}`; ctx.fillStyle = sub; ctx.fillText(label, x, 1508);
    ctx.textAlign = 'left';
  });

  // 目前這一集
  if (phase === 'main' && timeline.lastEp) {
    const ep = timeline.lastEp;
    ctx.globalAlpha = clamp01((performance.now() - timeline.lastEpAt) / 200);
    const label = `EP.${ep.episode}`;
    ctx.font = `600 30px ${NUM}`;
    const lw = ctx.measureText(label).width;
    const title = ep.title.split('|')[0].trim();
    ctx.font = `500 30px ${SANS}`;
    let tt = title;
    while (ctx.measureText(tt).width > 760 - lw && tt.length > 2) tt = tt.slice(0, -1);
    if (tt !== title) tt = tt.slice(0, -1) + '…';
    const x0 = (W - lw - 16 - ctx.measureText(tt).width) / 2;
    ctx.font = `600 30px ${NUM}`; ctx.fillStyle = pin; ctx.fillText(label, x0, 1574);
    ctx.font = `500 30px ${SANS}`; ctx.fillStyle = text; ctx.fillText(tt, x0 + lw + 16, 1574);
    ctx.globalAlpha = 1;
  }

  // 進度條
  const barX = 140, barW = W - 280, barY = 1612;
  const prog = phase === 'intro' ? 0 : phase === 'outro' ? 1 : p;
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; reelRoundRect(ctx, barX, barY, barW, 6, 3); ctx.fill();
  ctx.fillStyle = gold; reelRoundRect(ctx, barX, barY, Math.max(6, barW * prog), 6, 3); ctx.fill();
  ctx.font = `500 19px ${NUM}`; ctx.fillStyle = 'rgba(238,242,250,0.45)'; ctx.textAlign = 'center';
  for (let y = y0 + 1; y <= y1; y++) {
    ctx.fillText(String(y), barX + barW * (Date.parse(`${y}-01-01`) - timeline.min) / (timeline.max - timeline.min), barY + 36);
  }
  ctx.textAlign = 'left';

  if (phase === 'outro') {
    ctx.globalAlpha = outroIn;
    center(`${y1 - y0} 年 · ${ix.mainEps.length} 集`, 1365, `600 72px ${KLEE}`, gold);
    ctx.globalAlpha = ease(clamp01((p - 0.4) / 0.25));
    center('Podcast 搜尋「解鎖地球」', 1574, `700 34px ${SANS}`, text);
    ctx.globalAlpha = 1;
  }
}

function reelRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ── 小工具 ────────────────────────────────────────────
function setReelProgress(ratio, label) {
  document.getElementById('reel-bar').style.width = `${Math.round(ratio * 100)}%`;
  document.getElementById('reel-status').textContent = label;
}

const loadedScripts = new Map();
function loadScriptOnce(src) {
  if (!loadedScripts.has(src)) {
    loadedScripts.set(src, new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = () => { loadedScripts.delete(src); rej(new Error(`載入失敗 ${src}`)); };
      document.head.appendChild(s);
    }));
  }
  return loadedScripts.get(src);
}

function loadReelImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}
