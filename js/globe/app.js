'use strict';

const {
  TIERS, REGION_COLORS, DEFAULT_COLOR, HOME, TOTAL_COUNTRIES, ZH_BY_A2,
  getTier, buildIndex, filterEpisodes, viewFor, angularDistance,
  formatDuration, escHtml,
} = window.UTE;

const PODCAST_COVER = 'https://d3mww1g1pfq2pt.cloudfront.net/Avatar/cjzryn64q34i607580oyblh1u/1616036848631.jpg';
const SITE_URL = 'https://deromanx.github.io/unlock-the-earth/';
const GLOBE_LIB = 'https://cdn.jsdelivr.net/npm/globe.gl@2.46.2/dist/globe.gl.min.js';   // index.html 也有一行 preload，改版本要一起改
// 資料版本：scripts/stamp_data_version.py 依資料檔內容算出、寫進 index.html，資料一更新瀏覽器就不會拿到舊快取
const DATA_V = '?v=' + (document.querySelector('meta[name="data-version"]')?.content || '1');
const HOME_COUNTRY = '台灣';   // 主場集數遠超其他國，不參與刻度上限，填獨立的綠色（THEMES.*.home）
const REGIONS = ['亞洲', '歐洲', '美洲', '非洲', '大洋洲', '台灣', '極地'];
const IS_TOUCH = matchMedia('(hover: none)').matches;
const IS_SMALL = matchMedia('(max-width: 760px)').matches;
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;

// 國旗用 flag-icons 的 SVG（Windows 不支援國旗 emoji，會顯示成兩個字母）
const flag = (a2, cls = '') => a2 ? `<span class="fi fi-${a2.toLowerCase()} ${cls}" aria-hidden="true"></span>` : '';

// 線條圖示（24×24、描邊 currentColor），取代 emoji 讓介面風格一致
const svgIcon = d => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  dice: svgIcon('<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>'),
  headphones: svgIcon('<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>'),
  history: svgIcon('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>'),
  plane: svgIcon('<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>'),
  chart: svgIcon('<path d="M3 3v18h18"/><path d="M7 16v-5M12 16V7M17 16v-8"/>'),
  moon: svgIcon('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>'),
  sun: svgIcon('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  link: svgIcon('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
  image: svgIcon('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>'),
  share: svgIcon('<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/>'),
  compass: svgIcon('<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>'),
  grid: svgIcon('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  download: svgIcon('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>'),
};

const THEMES = {
  dark: {
    globe: '#0b1830', night: 'rgba(0,3,12,0.55)', lights: 0.95, atmosphere: '#6fb4ff',
    landOff: 'rgba(150,162,180,0.40)', dim: 0.16, home: '#4cc38a',
    // OKLCH 線性內插：亮度 0.42→0.84、彩度 0.035→0.17 同步遞增，越多集越「濃」
    ramp: ['#574b37', '#80663b', '#ab813a', '#da9c34', '#ffb823'],
    pin: '#7FD8F5',
    visitedOn: 'rgba(244,199,55,0.92)', visitedOff: 'rgba(150,162,180,0.30)',
    stroke: 'rgba(170,185,210,0.20)',
    cap: 'rgba(90,105,130,0.12)', capHover: 'rgba(160,175,200,0.32)',
  },
  light: {
    globe: '#f4e8cc', night: 'rgba(40,40,80,0.20)', lights: 0.55, atmosphere: '#e6a82a',
    landOff: 'rgba(70,55,35,0.34)', dim: 0.22, home: '#2e8b57',
    // 淺色底：亮度 0.86→0.50 遞減、彩度 0.04→0.14 遞增
    ramp: ['#ddd0b4', '#cab085', '#b99056', '#a86f21', '#974d00'],
    pin: '#0E6F82',
    visitedOn: 'rgba(214,150,20,0.92)', visitedOff: 'rgba(70,55,35,0.26)',
    stroke: 'rgba(70,55,35,0.22)',
    cap: 'rgba(120,95,55,0.08)', capHover: 'rgba(120,95,55,0.22)',
  },
  // 復古探險地圖：羊皮紙地球、經緯線、深褐墨水色階、朱紅地標，沒有日夜和城市燈火
  vintage: {
    globe: '#e9d8b0', night: 'rgba(0,0,0,0)', lights: 0, atmosphere: '#c9a46b', paper: true,
    landOff: 'rgba(92,60,28,0.30)', dim: 0.2, home: '#4f7a3a',
    ramp: ['#d6bf90', '#c09a5f', '#a26f37', '#82451c', '#5c210b'],
    pin: '#a3301f',
    visitedOn: 'rgba(163,48,31,0.75)', visitedOff: 'rgba(92,60,28,0.24)',
    stroke: 'rgba(70,42,18,0.4)',
    cap: 'rgba(120,85,40,0.07)', capHover: 'rgba(120,85,40,0.2)',
  },
};
const THEME_ORDER = ['dark', 'light', 'vintage'];
const THEME_META = {
  dark: { icon: 'moon', color: '#060b18', label: '深色' },
  light: { icon: 'sun', color: '#fbf3df', label: '淺色' },
  vintage: { icon: 'compass', color: '#efe2c4', label: '探險地圖' },
};

// ── 狀態 ──────────────────────────────────────────────
let globe;
let ix;                       // buildIndex() 結果
let landmarks = [];
let countryFeatures = [];
let theme = readStore('ute-theme-v2') || 'dark';
if (!THEMES[theme]) theme = 'dark';

const filters = { query: '', region: 'all', year: null, tag: null };
let tagList = [];             // 主題標籤（data/episode_tags.json）
const focus = { lms: null, countryKey: null };   // 目前高亮的地標集合／國家
let detailStack = [];
let hoverRings = [];
let idleTimer = null;

const timeline = { on: false, playing: false, ms: 0, min: 0, max: 0, raf: 0, lastEp: null, countryCounts: new Map() };
const story = { on: false, ep: null, stops: [], i: 0, playing: true, timer: null };
let visitedOn = false;
let extractedEps = null;      // 已抽過地標的集數（data/extracted_eps.json）；沒抽過的顯示「地點整理中」
let visited = new Set(JSON.parse(readStore('ute-visited') || '[]'));

// ── 啟動 ──────────────────────────────────────────────
init();

async function init() {
  document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = ICONS[el.dataset.icon] || ''; });
  applyTheme(theme, false);
  if (!hasWebGL()) {
    showFatal('你的瀏覽器不支援 3D 繪圖，請換用較新版本的 Chrome、Safari 或 Edge。');
    return;
  }

  // 地球引擎（globe.gl，約 1.9MB）和資料同時下載；資料先到就先顯示標題和集數列表，不必等地球
  const globeLib = loadScript(GLOBE_LIB);
  globeLib.catch(() => {});
  let episodes, geo, tagData, waveData;
  try {
    [episodes, landmarks, geo, extractedEps, tagData, episodeColors, waveData] = await Promise.all([
      fetchJson(`data/episodes.json${DATA_V}`),
      fetchJson(`data/landmarks_global.json${DATA_V}`),
      fetchJson(`data/countries.json${DATA_V}`),
      fetchJson(`data/extracted_eps.json${DATA_V}`).then(a => new Set(a)).catch(() => null),
      fetchJson(`data/episode_tags.json${DATA_V}`).catch(() => ({ tags: [], episodes: {} })),
      fetchJson(`data/episode_colors.json${DATA_V}`).catch(() => ({})),
      fetchJson(`data/waveform.json${DATA_V}`).catch(() => null),
    ]);
  } catch (e) {
    console.error('Failed to load data:', e);
    showFatal('資料載入失敗，請重新整理。');
    return;
  }

  landmarks.forEach((lm, i) => { lm.id = i; });
  ix = buildIndex(episodes, landmarks);
  // 主題標籤：篩選用，也加進搜尋文字（搜「美食」找得到）
  tagList = tagData.tags;
  ix.tagsByEp = new Map(Object.entries(tagData.episodes).map(([n, t]) => [Number(n), t]));
  for (const [n, t] of ix.tagsByEp) if (ix.searchText.has(n)) ix.searchText.set(n, `${ix.searchText.get(n)} ${t.join(' ')}`);
  ix.maxCountryEps = Math.max(1, ...[...ix.countries.values()].filter(c => c.key !== HOME_COUNTRY).map(c => c.eps.size));

  // data/countries.json：world-atlas 110m＋50m/10m 補的小國，已清掉退化多邊形並驗證 h3 不會丟錯
  // （globe.gl 遇到一國丟錯，之後所有國家都不畫點陣）。hexRes 是預先算好鋪得出點的解析度
  countryFeatures = geo.features;
  for (const f of countryFeatures) f.hexRes = f.properties.hexRes || 3;
  for (const f of countryFeatures) {
    const { a2, zh } = window.UTE.featureCountry(f);
    f.a2 = a2;
    f.zh = zh;
    f.country = (a2 && ix.countryByA2.get(a2)) || ix.countries.get(zh) || null;
  }

  renderFilters();
  renderEpList();
  renderHero();
  renderLegend();
  countUpHero();
  document.body.classList.add('globe-pending');
  document.getElementById('loading').classList.add('done');

  try {
    await globeLib;
  } catch (e) {
    showFatal('地球載入失敗，請重新整理。');
    return;
  }
  initGlobe();
  bindEvents();
  refreshPoints();
  buildAmbientRings();
  pulseLatest();
  startWaveRing(waveData);
  if (document.body.classList.contains('intro')) setIntro(true);
  updateCountryLabels(globe.pointOfView().altitude);

  if (new URLSearchParams(location.search).get('visited')) loadVisitedFromUrl();
  handleDeepLink();
}

function initGlobe() {
  const el = document.getElementById('globe');
  globe = new Globe(el, { animateIn: true, rendererConfig: { antialias: true, alpha: true } })
    .backgroundColor('rgba(0,0,0,0)')
    .showAtmosphere(true)
    .atmosphereAltitude(0.2)
    .width(innerWidth)
    .height(innerHeight)

    // 半色調網點：去過越多集點越大越亮，沒去過只剩細點（使用者從參考圖選定）
    .hexPolygonsData(countryFeatures)
    .hexPolygonResolution(f => (IS_SMALL && f.hexRes === 3) ? 2 : f.hexRes)
    .hexPolygonMargin(dotMargin)
    .hexPolygonCurvatureResolution(3)
    .hexPolygonUseDots(true)
    .hexPolygonAltitude(0.006)
    .hexPolygonColor(countryColor)

    // 底層淡色填色＋國界：滑鼠偵測也由這層負責（點陣不參與，見 muteHexRaycast）
    .polygonsData(countryFeatures)
    .polygonAltitude(0.003)
    .polygonCapColor(capColor)
    .polygonSideColor(() => 'rgba(0,0,0,0)')
    .polygonStrokeColor(() => THEMES[theme].stroke)
    .polygonsTransitionDuration(0)
    .onPolygonHover(onCountryHover)
    .onPolygonClick(onCountryClick)

    // 地標用粒子層：一組點一次畫完。原本每個地標是一根立體圓柱，1,900 根就是 1,900 次繪製，電腦上會卡
    .particlesData([])
    .particlesList(set => set.items)
    .particleLat('lat')
    .particleLng('lon')
    .particleAltitude(set => set.alt)
    .particlesSize(set => set.size)
    .particlesSizeAttenuation(false)
    .particlesColor(set => set.color)
    .onParticleHover(lm => onPointHover(lm?.items ? null : lm))
    .onParticleClick(lm => { if (!lm?.items) showLandmark(lm); })

    .ringsData([])
    .ringColor(r => t => `rgba(${r.rgb},${(r.alpha ?? 1) * (1 - t)})`)
    .ringMaxRadius(r => r.maxR || 3)
    .ringPropagationSpeed(r => r.speed || 2)
    .ringRepeatPeriod(r => r.period || 1100)

    .arcsData([])
    .arcColor(a => a.colors)
    .arcStroke(a => a.stroke || 0.35)
    .arcAltitudeAutoScale(0.45)
    .arcDashLength(a => a.solid ? 1 : 0.45)
    .arcDashGap(a => a.solid ? 0 : 0.25)
    .arcDashInitialGap(() => Math.random())
    .arcDashAnimateTime(a => a.solid ? 0 : 2600)
    .arcsTransitionDuration(0)

    .htmlElementsData([])
    .htmlLat('lat')
    .htmlLng('lng')
    .htmlAltitude(d => d.alt || 0.02)
    .htmlElement(d => d.el)
    .htmlTransitionDuration(0)

    .onGlobeClick(() => { if (!visitedOn && !story.on) { clearFocus(); closeDetail(); } })
    .onZoom(onZoom)
    .onGlobeReady(() => {
      document.body.classList.remove('globe-pending');
      muteHexRaycast();
      setInterval(muteHexRaycast, 3000);   // 足跡模式、降級時點陣會重建
      setTimeout(watchPerformance, 1500);
    });

  applyPixelRatio();
  setupLights();
  applyGlobeTheme();
  updateDayNight();
  setInterval(updateDayNight, 10 * 60 * 1000);

  const controls = globe.controls();
  controls.autoRotate = !REDUCED_MOTION;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.autoRotateSpeed = 0.45;
  controls.minDistance = 102;
  controls.maxDistance = 600;
  controls.addEventListener('start', onUserInteract);

  globe.pointOfView({ lat: HOME.lat - 5, lng: HOME.lng - 20, altitude: IS_SMALL ? 2.8 : 2.4 }, 0);

  addEventListener('resize', () => { globe.width(innerWidth).height(innerHeight); applyPixelRatio(); drawStars(); });
  drawStars();
}

// 國家點陣不參與滑鼠偵測：globe.gl 每次移動滑鼠都會對場景所有物件做射線檢測，
// 點陣有幾萬個三角形，是電腦上拖曳、滑過時卡頓的主因。國家的 hover／點擊由底下的填色層負責
const noRaycast = () => {};
function muteHexRaycast() {
  globe.scene().traverse(o => {
    if (o.__globeObjType !== 'hexPolygon' || o.raycast === noRaycast) return;
    o.traverse(c => { c.raycast = noRaycast; });
  });
}

// Retina 螢幕用高解析度線條才不會糊，但總像素數要設上限：大螢幕全幅 2 倍等於畫 4 倍像素，電腦會卡
const MAX_RENDER_PIXELS = 4.2e6;
function applyPixelRatio() {
  if (perfLevel > 0) return;
  const budget = Math.sqrt(MAX_RENDER_PIXELS / (innerWidth * innerHeight));
  globe.renderer().setPixelRatio(Math.max(1, Math.min(devicePixelRatio || 1, 2, budget)));
}

// ── 地球外觀 ──────────────────────────────────────────
function applyGlobeTheme() {
  if (!globe) return;
  const t = THEMES[theme];
  const mat = globe.globeMaterial();
  // 地球底色畫在貼圖裡（含日夜），材質本身用白色才不會再被染色
  mat.color.set('#ffffff');
  mat.emissive.set('#000000');
  mat.shininess = 0;
  globe.atmosphereColor(t.atmosphere);
  refreshHex();
  updateDayNight();
}

// 以環境光為主、方向光很弱：點陣顏色不會因為朝向不同而忽明忽暗，色階才讀得準
function setupLights() {
  const lights = globe.lights();
  for (const l of lights) {
    if (l.isAmbientLight) { l.color.set('#ffffff'); l.intensity = Math.PI * 1.05; }
    if (l.isDirectionalLight) l.intensity = Math.PI * 0.12;
  }
}

// ── 日夜線＋城市燈火 ─────────────────────────────────
// 依目前時間算太陽直射點，把夜半球陰影與城市燈火畫進 equirectangular 貼圖
let nightLightsImg = null;
function updateDayNight() {
  if (!globe) return;
  if (!nightLightsImg) {
    nightLightsImg = new Image();
    nightLightsImg.onload = updateDayNight;
    nightLightsImg.src = 'assets/earth-night.jpg';
    return;
  }
  if (!nightLightsImg.complete || !nightLightsImg.naturalWidth) return;

  const t = THEMES[theme];
  const W = IS_SMALL ? 1024 : 2048, H = W / 2;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = t.globe;
  ctx.fillRect(0, 0, W, H);
  if (t.paper) {
    paintParchment(ctx, W, H);
    globe.globeImageUrl(cv.toDataURL('image/jpeg', 0.86));
    return;
  }

  // 夜半球遮罩（低解析度算完再放大，邊緣自然柔和）
  const mw = 360, mh = 180;
  const mask = document.createElement('canvas');
  mask.width = mw; mask.height = mh;
  const mctx = mask.getContext('2d');
  const img = mctx.createImageData(mw, mh);
  const sun = subsolarPoint(new Date());
  const rad = Math.PI / 180;
  for (let y = 0; y < mh; y++) {
    const lat = (90 - (y + 0.5)) * rad;
    for (let x = 0; x < mw; x++) {
      const lng = (x + 0.5 - 180) * rad;
      const cosZ = Math.sin(lat) * Math.sin(sun.lat * rad) + Math.cos(lat) * Math.cos(sun.lat * rad) * Math.cos(lng - sun.lng * rad);
      const night = Math.max(0, Math.min(1, (0.08 - cosZ) / 0.2));   // 晨昏帶約 ±6°
      img.data[(y * mw + x) * 4 + 3] = Math.round(night * 255);
    }
  }
  mctx.putImageData(img, 0, 0);

  // 城市燈火只留在夜半球
  const lights = document.createElement('canvas');
  lights.width = W; lights.height = H;
  const lctx = lights.getContext('2d');
  lctx.drawImage(nightLightsImg, 0, 0, W, H);
  lctx.globalCompositeOperation = 'destination-in';
  lctx.drawImage(mask, 0, 0, W, H);

  // 夜色陰影
  const shade = document.createElement('canvas');
  shade.width = W; shade.height = H;
  const sctx = shade.getContext('2d');
  sctx.fillStyle = t.night;
  sctx.fillRect(0, 0, W, H);
  sctx.globalCompositeOperation = 'destination-in';
  sctx.drawImage(mask, 0, 0, W, H);

  ctx.drawImage(shade, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = t.lights;
  ctx.drawImage(lights, 0, 0);
  globe.globeImageUrl(cv.toDataURL('image/jpeg', 0.86));
}

// 探險地圖的地球貼圖：紙張斑點＋每 15° 一條經緯線，赤道和本初子午線加粗
function paintParchment(ctx, W, H) {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < W * 3; i++) {
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(92,60,28,0.06)' : 'rgba(255,250,235,0.08)';
    ctx.beginPath();
    ctx.arc(rnd() * W, rnd() * H, rnd() * W / 260, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(92,60,28,0.28)';
  for (let lng = -180; lng <= 180; lng += 15) {
    ctx.lineWidth = lng === 0 ? W / 700 : W / 1400;
    const x = (lng + 180) / 360 * W;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    ctx.lineWidth = lat === 0 ? W / 700 : W / 1400;
    const y = (90 - lat) / 180 * H;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
}

// 太陽直射點（NOAA 簡化公式，誤差 < 1°）
function subsolarPoint(date) {
  const rad = Math.PI / 180;
  const d = (date - Date.UTC(2000, 0, 1, 12)) / 864e5;
  const g = (357.529 + 0.98560028 * d) * rad;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad;
  const e = (23.439 - 0.00000036 * d) * rad;
  const decl = Math.asin(Math.sin(e) * Math.sin(L)) / rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / rad;
  const eqTime = (q - ra) / 15;                                       // 小時
  const utcH = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  let lng = -15 * (utcH - 12 + ((eqTime + 12) % 24 + 24) % 24 - 12);
  lng = ((lng + 540) % 360) - 180;
  return { lat: decl, lng };
}

// 點的顏色：去過的依集數走色階、台灣綠色，沒去過的灰；聚焦某國時其他國家變淡
function countryColor(f) {
  const t = THEMES[theme];
  if (visitedOn) return f.a2 && visited.has(f.a2) ? t.visitedOn : t.visitedOff;
  const h = heat(f);
  if (h < 0) return focus.countryKey ? fade(t.landOff, 0.6) : t.landOff;
  // 台灣是主場，用獨立的綠色，不跟海外國家比濃淡
  const [r, g, b] = f.country.key === HOME_COUNTRY ? hexToRgb(t.home).split(',').map(Number) : rampColor(t.ramp, h);
  const a = focus.countryKey && f.country.key !== focus.countryKey ? 0.3 : 0.95;
  return `rgba(${r},${g},${b},${a})`;
}

// 國家熱度：依「去過幾集」開根號，1 集 = 0、海外最多集的國家 = 1；沒去過回傳 -1
// （開根號在 1–22 集之間的視覺變化最接近線性，對數會把前段班擠在一起）
function countryEps(f) {
  const c = f.country;
  if (!c) return 0;
  return timeline.on ? (timeline.countryCounts.get(c.key) || 0) : c.eps.size;
}
function heat(f) {
  const n = countryEps(f);
  if (!n) return -1;
  if (f.country.key === HOME_COUNTRY) return 1;
  return ix.maxCountryEps > 1 ? Math.min(1, Math.sqrt((n - 1) / (ix.maxCountryEps - 1))) : 1;
}

function rampColor(stops, h) {
  const x = Math.max(0, Math.min(1, h)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const a = hexToRgb(stops[i]).split(',').map(Number);
  const b = hexToRgb(stops[i + 1]).split(',').map(Number);
  return a.map((v, k) => Math.round(v + (b[k] - v) * (x - i)));
}

function fade(rgba, mul) {
  return rgba.replace(/[\d.]+\)$/, a => `${Math.min(1, parseFloat(a) * mul).toFixed(3)})`);
}

// 半色調：點的大小（hexPolygonMargin 越大點越小）。沒去過 0.86 只剩細點，去最多集的 0.22。
// 時間線播放中只換顏色、不換大小：改大小會讓整層點陣重建，每集都重建會卡
function dotMargin(f) {
  if (visitedOn) return f.a2 && visited.has(f.a2) ? 0.3 : 0.86;
  const c = f.country;
  if (!c || !c.eps.size) return 0.86;
  const h = c.key === HOME_COUNTRY ? 1 : Math.min(1, Math.sqrt((c.eps.size - 1) / Math.max(1, ix.maxCountryEps - 1)));
  return 0.72 - 0.5 * h;
}

// 底層填色：一律淡淡一層，滑過時亮一點；足跡模式去過的國家帶一點金
function capColor(f) {
  const t = THEMES[theme];
  if (f === hoverFeature) return t.capHover;
  if (visitedOn && f.a2 && visited.has(f.a2)) return fade(t.visitedOn, 0.3);
  return t.cap;
}

let lastMarginMode = null;
function refreshHex() {
  if (!globe) return;
  globe.hexPolygonColor(countryColor)
    .polygonCapColor(capColor)
    .polygonStrokeColor(() => THEMES[theme].stroke);
  const mode = visitedOn ? `v:${[...visited].sort().join(',')}` : 'eps';
  if (mode !== lastMarginMode) {
    lastMarginMode = mode;
    globe.hexPolygonMargin(dotMargin);
  }
}

// 地標分成幾組粒子：高亮／淡化 × 多集／單集；每組一個顏色、一個大小（螢幕像素，不隨縮放變）
const DOT_PX = { one: 2.2, many: 3.2 };
function setPoints(list) {
  if (!globe) return;
  const t = THEMES[theme];
  const dimColor = mixHex(t.pin, t.globe, 1 - t.dim * 2.2);
  const groups = new Map();
  for (const lm of list) {
    const lit = !focus.lms || focus.lms.has(lm);
    const many = lm.epNums.length > 1;
    const key = `${lit}-${many}`;
    if (!groups.has(key)) groups.set(key, {
      items: [], color: lit ? t.pin : dimColor, size: many ? DOT_PX.many : DOT_PX.one,
      alt: lit ? 0.012 : 0.008, lit,
    });
    groups.get(key).items.push(lm);
  }
  // 淡化的先畫，高亮的壓在上面
  const sets = [...groups.values()].sort((a, b) => a.lit - b.lit);
  for (const set of sets) set.tex = dotTexture(set.color);
  globe.particlesData(sets).particlesTexture(sets.every(x => x.tex) ? set => set.tex : null);
  if (!sets.every(x => x.tex) && !dotTexWait) {
    dotTexWait = setInterval(() => { if (dotTexCtor()) { clearInterval(dotTexWait); refreshPoints(); } }, 300);
  }
}

function refreshPoints() {
  setPoints(visiblePoints());
}

// 圓點貼圖：粒子預設是方塊。THREE 沒有對外公開，借地球貼圖的建構子來用（貼圖載好之前先用方塊）
const dotTextures = new Map();
let dotTexWait = 0;
function dotTexCtor() { return globe?.globeMaterial()?.map?.constructor || null; }
function dotTexture(color) {
  if (dotTextures.has(color)) return dotTextures.get(color);
  const Tex = dotTexCtor();
  if (!Tex) return null;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(32, 32, 30, 0, Math.PI * 2); ctx.fill();
  const tex = new Tex(cv);
  tex.needsUpdate = true;
  dotTextures.set(color, tex);
  return tex;
}

function mixHex(a, b, t) {
  const [r1, g1, b1] = hexToRgb(a).split(',').map(Number), [r2, g2, b2] = hexToRgb(b).split(',').map(Number);
  const m = (x, y) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  return `#${m(r1, r2)}${m(g1, g2)}${m(b1, b2)}`;
}

function visiblePoints() {
  if (visitedOn) return [];
  return landmarks.filter(lm => {
    if (timeline.on) {
      const t = ix.lmFirstMs.get(lm);
      if (t === undefined || t > timeline.ms) return false;
      return true;
    }
    if (filters.region !== 'all' && lm.region !== filters.region) return false;
    if (filters.year && !lm.epNums.some(n => ix.epMeta.get(n)?.pubDate?.startsWith(filters.year))) return false;
    if (filters.tag && !lm.epNums.some(n => (ix.tagsByEp.get(n) || []).includes(filters.tag))) return false;
    return true;
  });
}

function onZoom({ altitude }) {
  updateCountryLabels(altitude);
}

function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

// ── 鏡頭／自轉 ────────────────────────────────────────
function flyTo(points, ms = 1600, minAlt = 0) {
  const v = viewFor(points.map(p => ({ lat: p.lat, lng: p.lng ?? p.lon })));
  if (!v) return;
  // 側邊面板開著時，視角稍微往左偏讓目的地不被擋住
  if (isDetailOpen() && !IS_SMALL) v.lng += v.altitude * 9;
  v.altitude = Math.max(v.altitude, minAlt);
  stopAutoRotate();
  globe.pointOfView(v, ms);
}

function stopAutoRotate() {
  globe.controls().autoRotate = false;
  clearTimeout(idleTimer);
}

function onUserInteract() {
  if (timeline.on) timeline.follow = false;   // 播放中使用者自己轉地球，就不再搶鏡頭
  stopAutoRotate();
  setIntro(false);
  scheduleIdleRotate();
}

function scheduleIdleRotate() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!isDetailOpen() && !story.on && !timeline.on && !visitedOn) {
      const c = globe.controls();
      c.autoRotateSpeed = 0.45;
      c.autoRotate = true;
    }
  }, 25000);
}

// ── 高亮效果 ──────────────────────────────────────────
function setFocus({ lms = null, countryKey = null } = {}) {
  focus.lms = lms ? new Set(lms) : null;
  focus.countryKey = countryKey;
  refreshPoints();
  refreshHex();
}

function clearFocus() {
  setFocus();
  setArcs([]);
  setRings([]);
  setLabels([]);
}

function setArcs(targets, from = HOME) {
  setArcPairs(targets.slice(0, 40).map(t => ({ from, to: t, stroke: t.stroke })));
}

// 任意兩點之間的弧線（回訪網用），起點淡、終點亮，看得出方向
function setArcPairs(pairs) {
  const c = THEMES[theme].pin;
  globe.arcsData(pairs.map(({ from, to, stroke }) => ({
    startLat: from.lat, startLng: from.lng ?? from.lon,
    endLat: to.lat, endLng: to.lng ?? to.lon,
    colors: [hexToRgba(c, 0.25), hexToRgba(c, 0.95)],
    stroke,
  })));
}

// ── 回訪網 ────────────────────────────────────────────
const centroidCache = new Map();
function countryCentroid(c) {
  if (!centroidCache.has(c.key)) centroidCache.set(c.key, viewFor(c.landmarks.map(l => ({ lat: l.lat, lng: l.lon }))));
  return centroidCache.get(c.key);
}

// 和這個國家在同一集出現過的其他國家，依共同集數排序
function coCountries(c) {
  const m = new Map();
  for (const n of c.eps) {
    const keys = new Set((ix.lmByEp.get(n) || []).map(l => l.countryKey).filter(k => k && k !== c.key));
    for (const k of keys) m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ c: ix.countries.get(k), n }));
}

// 和這個地標在同一集一起被提到的其他地標
function coLandmarks(lm) {
  const out = new Set();
  for (const n of lm.epNums) for (const o of ix.lmByEp.get(n) || []) if (o !== lm) out.add(o);
  return [...out];
}

// 回訪時間軸：每一集在節目總時間軸上的位置
function revisitStrip(lm) {
  const first = Date.parse(ix.mainEps.at(-1).pubDate), last = Date.parse(ix.mainEps[0].pubDate);
  const eps = lm.epNums.map(n => ix.epMeta.get(n)).sort((a, b) => a.episode - b.episode);
  const dots = eps.map(ep => {
    const pct = (Date.parse(ep.pubDate) - first) / (last - first) * 100;
    return `<button class="rv-dot" data-act="ep" data-ep="${ep.episode}" style="left:${pct.toFixed(1)}%" title="Ep.${ep.episode} · ${escHtml(ep.pubDate.slice(0, 7))}"></button>`;
  }).join('');
  const y0 = eps[0].pubDate.slice(0, 4), y1 = eps.at(-1).pubDate.slice(0, 4);
  return `
    <div class="revisit">
      <div class="rv-head"><b>回訪 ${eps.length} 次</b><span>${y0 === y1 ? y0 : `${y0} → ${y1}`}</span></div>
      <div class="rv-track">${dots}</div>
      <div class="rv-scale"><span>${new Date(first).getFullYear()}</span><span>${new Date(last).getFullYear()}</span></div>
    </div>`;
}

// 沒有指定光圈時，換成背景的聲波地標（visuals.js）
function setRings(items, opts = {}) {
  const rings = items.slice(0, 60).map(lm => ({
    lat: lm.lat, lng: lm.lng ?? lm.lon,
    rgb: hexToRgb(THEMES[theme].pin),
    ...opts,
  }));
  globe.ringsData(rings.length ? rings : ambientRingData());
}

function setLabels(items) {
  focusLabels = items.slice(0, 24).map(lm => {
    const el = document.createElement('button');
    el.className = 'globe-label';
    el.textContent = lm.name;
    el.style.setProperty('--c', THEMES[theme].pin);
    // 導覽站點是單集檔的副本，點擊時換回全域地標物件
    if (lm.id !== undefined && !story.on) el.addEventListener('click', e => { e.stopPropagation(); showLandmark(landmarks[lm.id]); });
    return { lat: lm.lat, lng: lm.lng ?? lm.lon, el, alt: 0.01 + 0.01 * Math.min(lm.epNums?.length || 1, 8) };
  });
  renderHtmlLayer();
}

// ── 國名標籤 ──────────────────────────────────────────
// 節目去過的國家在地球上標國名；集數多的優先，彼此太近就略過（拉近時間距變小、標得更多）。
// 開著地標／集數標籤時先收起來，避免兩層字疊在一起
let focusLabels = [];
let countryLabels = [];
let countryLabelBucket = null;

function renderHtmlLayer() {
  globe.htmlElementsData(focusLabels.length ? focusLabels : countryLabels);
}

function updateCountryLabels(altitude) {
  const bucket = Math.round(altitude * 4);
  if (bucket === countryLabelBucket) return;
  countryLabelBucket = bucket;
  const minSep = Math.max(3.5, altitude * 7);   // 兩個國名之間至少隔幾度
  const picked = [];
  const ranked = [...ix.countries.values()].filter(c => c.a2 && c.landmarks.length).sort((a, b) => b.eps.size - a.eps.size);
  for (const c of ranked) {
    const p = countryCentroid(c);
    if (picked.every(q => angularDistance(p, q.p) / DEG >= minSep)) picked.push({ c, p });   // angularDistance 回傳弧度
    if (picked.length >= 45) break;
  }
  countryLabels = picked.map(({ c, p }) => ({ lat: p.lat, lng: p.lng, el: countryLabelEl(c), alt: 0.004 }));
  if (!focusLabels.length) renderHtmlLayer();
}

// 每次重建新元素：globe.gl 換資料時會移除舊物件的 DOM，共用同一個元素會被一起拿掉
function countryLabelEl(c) {
  const el = document.createElement('button');
  el.className = 'country-label';
  el.textContent = c.key;
  el.addEventListener('click', e => { e.stopPropagation(); showCountry(c.key); });
  return el;
}

// ── Hover ─────────────────────────────────────────────
let mouse = { x: 0, y: 0 };
addEventListener('pointermove', e => { mouse = { x: e.clientX, y: e.clientY }; moveTooltip(); });

function onPointHover(lm) {
  if (!lm || IS_TOUCH) return hideTooltip();
  showTooltip(`<b>${escHtml(lm.name)}</b><span>${flag(lm.a2)} ${escHtml(lm.countryKey)} · ${lm.epNums.length} 集提到</span>`);
}

let hoverFeature = null;
function onCountryHover(f) {
  if (f !== hoverFeature && !IS_TOUCH) {
    hoverFeature = f || null;
    globe.polygonCapColor(capColor);
  }
  if (!f || IS_TOUCH) return hideTooltip();
  const c = f.country;
  const sub = visitedOn
    ? (!f.a2 ? '非聯合國會員國，不列入足跡' : visited.has(f.a2) ? '✓ 去過（點一下取消）' : '點一下標記去過')
    : (c ? `${c.eps.size} 集 · ${c.landmarks.length} 個地標` : '節目還沒去過');
  showTooltip(`<b>${flag(f.a2)} ${escHtml(f.zh)}</b><span>${sub}</span>`);
}

function showTooltip(html) {
  const tip = document.getElementById('tooltip');
  tip.innerHTML = html;
  tip.classList.add('show');
  moveTooltip();
}
function moveTooltip() {
  const tip = document.getElementById('tooltip');
  if (!tip.classList.contains('show')) return;
  const x = Math.min(mouse.x + 16, innerWidth - tip.offsetWidth - 8);
  tip.style.transform = `translate(${x}px, ${mouse.y - 12 - tip.offsetHeight}px)`;
}
function hideTooltip() {
  document.getElementById('tooltip').classList.remove('show');
}

// ── 國家點擊 ──────────────────────────────────────────
function onCountryClick(f) {
  if (story.on) return;
  if (visitedOn) {
    if (!f.a2) return;
    visited.has(f.a2) ? visited.delete(f.a2) : visited.add(f.a2);
    saveVisited();
    refreshHex();
    onCountryHover(f);
    renderVisitedPanel();
    return;
  }
  if (f.country) showCountry(f.country.key);
  else toast(`${f.zh}：節目還沒去過，等你推坑！`);
}

// ── 詳情面板 ──────────────────────────────────────────
function isDetailOpen() {
  return document.getElementById('detail').classList.contains('open');
}

function openDetail(html, entry) {
  const top = detailStack[detailStack.length - 1];
  if (!top || top.type !== entry.type || top.id !== entry.id) detailStack.push(entry);
  if (detailStack.length > 20) detailStack.shift();

  const back = detailStack.length > 1
    ? `<button class="back-btn" data-act="back">← ${escHtml(detailStack[detailStack.length - 2].label)}</button>` : '';
  const body = document.getElementById('detail-body');
  body.innerHTML = back + html;
  body.scrollTop = 0;
  document.getElementById('detail').classList.add('open');
  document.body.classList.add('has-detail');
  setIntro(false);
  if (IS_SMALL) closeDrawer();
  stopAutoRotate();
}

function closeDetail() {
  cancelLanding();
  if (!story.on) applyEpisodeAccent(null);
  document.getElementById('detail').classList.remove('open');
  document.body.classList.remove('has-detail');
  detailStack = [];
  pushUrl(null);
  scheduleIdleRotate();
}

function goBack() {
  detailStack.pop();
  const prev = detailStack.pop();
  if (!prev) return closeDetail();
  if (prev.type === 'lm') showLandmark(landmarks[prev.id]);
  else if (prev.type === 'ep') showEpisode(prev.id);
  else if (prev.type === 'country') showCountry(prev.id);
  else if (prev.type === 'visited') renderVisitedPanel();
}

function epCover(ep) {
  return ep?.image || PODCAST_COVER;
}

// 地標
function showLandmark(lm, { fly = true } = {}) {
  if (!lm.epNums.includes(accentEp)) applyEpisodeAccent(null);   // 從集數點進來的地標保留那集的配色
  const color = REGION_COLORS[lm.region] || DEFAULT_COLOR;
  const apps = lm.appearances || [];
  const header = lm.image
    ? `<div class="d-hero d-hero-photo" style="--img:url('${escHtml(lm.image)}')"></div>`
    : `<div class="d-hero d-hero-plain" style="--c:${color}">${flag(lm.a2, 'd-flag')}</div>`;

  const appHtml = apps.map(a => {
    const ep = ix.epMeta.get(a.ep);
    if (!ep) return '';
    const same = a.quote && a.context && a.quote.trim() === a.context.trim();
    return `
      <div class="appear">
        <button class="appear-head" data-act="ep" data-ep="${a.ep}">
          <img src="${escHtml(epCover(ep))}" alt="" loading="lazy">
          <span><b>Ep.${a.ep}</b><em>${escHtml(ep.title)}</em></span>
        </button>
        ${a.quote ? `<blockquote style="--c:${color}">「${escHtml(a.quote)}」</blockquote>` : ''}
        ${a.context && !same ? `<p class="appear-ctx">${escHtml(a.context)}</p>` : ''}
      </div>`;
  }).join('');

  const mapsQuery = encodeURIComponent((lm.name_en || lm.name) + (lm.country ? `, ${lm.country}` : ''));
  openDetail(`
    ${header}
    <div class="d-body">
      <div class="d-kicker" style="--c:${color}">地標 · ${escHtml(lm.region || '')}</div>
      <h2 class="d-title">${escHtml(lm.name)}</h2>
      ${lm.name_en && lm.name_en !== lm.name ? `<p class="d-sub">${escHtml(lm.name_en)}</p>` : ''}
      <div class="chip-row">
        ${lm.countryKey ? `<button class="chip" data-act="country" data-c="${escHtml(lm.countryKey)}">${flag(lm.a2)} ${escHtml(lm.countryKey)}</button>` : ''}
        <span class="chip chip-quiet">在 ${lm.epNums.length} 集中出現</span>
      </div>
      <div class="d-about" data-about="${lm.id}"></div>
      ${lm.epNums.length > 1 ? revisitStrip(lm) : ''}
      <h3 class="d-section">節目裡怎麼說</h3>
      ${appHtml}
      <a class="link-out" href="https://www.google.com/maps/search/?api=1&query=${mapsQuery}" target="_blank" rel="noopener">在 Google Maps 開啟 ↗</a>
    </div>`, { type: 'lm', id: lm.id, label: lm.name });

  fillAbout(lm);

  // 被多集提到的地標：畫出同集一起出現的其他地點（回訪網）；只出現一次就從台灣拉線
  const co = lm.epNums.length > 1 ? coLandmarks(lm) : [];
  setFocus({ lms: [lm, ...co] });
  setRings([lm], { maxR: 4, period: 900 });
  if (co.length) setArcPairs(co.slice(0, 40).map(o => ({ from: lm, to: o, stroke: 0.22 })));
  else setArcs([lm]);
  setLabels([lm]);
  pushUrl(lm.epNums[0] ? `ep=${lm.epNums[0]}` : null);
  if (fly && lm.image && !REDUCED_MOTION && perfLevel < 2) landOn(lm);
  else if (fly) {
    const v = globe.pointOfView();
    flyTo([lm], 1500, Math.min(v.altitude, 0.6));
  }
}

// 維基百科簡介（data/landmark_info.json，05_wikipedia_info.py 產生）：點開地標才載入，不拖慢首頁
let landmarkInfo = null;
async function fillAbout(lm) {
  landmarkInfo ||= fetchJson(`data/landmark_info.json${DATA_V}`).catch(() => ({}));
  const info = (await landmarkInfo)[lm.name];
  const el = document.querySelector(`#detail-body [data-about="${lm.id}"]`);
  if (!info || !el) return;
  el.innerHTML = `
    ${info.s ? `<p class="d-about-text">${escHtml(info.s)}</p>` : ''}
    ${info.w ? `<a class="d-about-src" href="${escHtml(info.w)}" target="_blank" rel="noopener">維基百科 ↗</a>` : ''}`;
}

// 集數
function showEpisode(epNum, { fly = true } = {}) {
  const ep = ix.epMeta.get(epNum);
  if (!ep) return;
  applyEpisodeAccent(epNum);
  const lms = ix.lmByEp.get(epNum) || [];
  const countries = [...new Map(lms.filter(l => l.countryKey).map(l => [l.countryKey, l])).values()];

  const lmHtml = lms.map(lm => {
    const app = (lm.appearances || []).find(a => a.ep === epNum);
    const color = REGION_COLORS[lm.region] || DEFAULT_COLOR;
    return `
      <button class="lm-row" data-act="lm" data-lm="${lm.id}" style="--c:${color}">
        ${lm.image ? `<img src="${escHtml(lm.image)}" alt="" loading="lazy">` : `<span class="lm-dot"></span>`}
        <span><b>${escHtml(lm.name)}</b>${app?.context ? `<em>${escHtml(app.context)}</em>` : ''}</span>
      </button>`;
  }).join('');

  openDetail(`
    <div class="d-hero d-hero-ep" style="--img:url('${escHtml(epCover(ep))}')"></div>
    <div class="d-body">
      <div class="d-kicker">Ep.${ep.episode} · ${escHtml((ep.pubDate || '').slice(0, 10))}${ep.duration ? ` · ${formatDuration(ep.duration)}` : ''}</div>
      <h2 class="d-title">${escHtml(ep.title)}</h2>
      <div class="d-actions">
        ${lms.length ? `<button class="btn btn-primary" data-act="story" data-ep="${epNum}">▶ 開始導覽 ${lms.length} 站</button>` : ''}
        ${ep.link ? `<a class="btn btn-ghost" href="${escHtml(ep.link)}" target="_blank" rel="noopener">收聽 ↗</a>` : ''}
        <button class="btn btn-ghost btn-icon-only" data-act="share" data-ep="${epNum}" title="複製這集的連結" aria-label="複製這集的連結">${ICONS.link}</button>
        <button class="btn btn-ghost btn-icon-only" data-act="card" data-kind="episode" data-id="${epNum}" title="產生分享圖卡" aria-label="產生分享圖卡">${ICONS.image}</button>
      </div>
      ${(ix.tagsByEp.get(epNum) || []).length ? `<div class="chip-row">${ix.tagsByEp.get(epNum).map(t =>
        `<button class="chip chip-tag" data-act="tag" data-tag="${escHtml(t)}"># ${escHtml(t)}</button>`).join('')}</div>` : ''}
      ${countries.length ? `<div class="chip-row">${countries.map(l =>
        `<button class="chip" data-act="country" data-c="${escHtml(l.countryKey)}">${flag(l.a2)} ${escHtml(l.countryKey)}</button>`).join('')}</div>` : ''}
      ${lms.length ? `<h3 class="d-section">這集去了 ${lms.length} 個地方</h3><div class="lm-list">${lmHtml}</div>`
        : isPending(epNum) ? `<p class="d-empty">這集的地點還在整理中，過幾天就會出現在地球上，先收聽吧！</p>`
        : `<p class="d-empty">這集沒有標記地點，直接收聽吧！</p>`}
    </div>`, { type: 'ep', id: epNum, label: `Ep.${epNum}` });

  setFocus({ lms });
  setArcs(lms);
  setRings(lms, { maxR: 2.2, period: 1600 });
  setLabels(lms);
  pushUrl(`ep=${epNum}`);
  if (fly && lms.length) flyTo(lms, 1800);
}

// 國家
function showCountry(key, { fly = true } = {}) {
  const c = ix.countries.get(key);
  if (!c) return;
  applyEpisodeAccent(null);
  const eps = [...c.eps].map(n => ix.epMeta.get(n)).filter(Boolean).sort((a, b) => b.episode - a.episode);
  const firstY = Number.isFinite(c.firstMs) ? new Date(c.firstMs).getFullYear() : '—';
  const lastY = Number.isFinite(c.lastMs) ? new Date(c.lastMs).getFullYear() : '—';
  const color = REGION_COLORS[c.region] || DEFAULT_COLOR;
  const isVisited = c.a2 && visited.has(c.a2);
  const co = coCountries(c);

  const top = c.landmarks.slice(0, 12).map(lm => `
    <button class="lm-tile" data-act="lm" data-lm="${lm.id}" style="--c:${REGION_COLORS[lm.region] || DEFAULT_COLOR}${lm.image ? `;--img:url('${escHtml(lm.image)}')` : ''}">
      <span class="lm-tile-name">${escHtml(lm.name)}</span>
      ${lm.epNums.length > 1 ? `<span class="lm-tile-n">${lm.epNums.length} 集</span>` : ''}
    </button>`).join('');

  openDetail(`
    <div class="d-hero d-hero-country" style="--c:${color}">
      ${flag(c.a2, 'd-flag')}
      <div class="d-stamp">${stampSvg(countryStampInfo(c.a2, c.key))}</div>
    </div>
    <div class="d-body">
      <div class="d-kicker" style="--c:${color}">國家專頁 · ${escHtml(c.region || '')}</div>
      <h2 class="d-title">${escHtml(c.key)}</h2>
      <div class="stat-tiles">
        <div><b>${eps.length}</b><span>集</span></div>
        <div><b>${c.landmarks.length}</b><span>地標</span></div>
        <div><b>${firstY === lastY ? firstY : `${firstY}–${String(lastY).slice(2)}`}</b><span>登場年份</span></div>
      </div>
      <div class="d-actions">
        ${c.a2 ? `<button class="btn ${isVisited ? 'btn-primary' : 'btn-ghost'} btn-grow" data-act="visit" data-a2="${c.a2}">${isVisited ? '✓ 我去過這裡' : '＋ 標記為我去過'}</button>` : ''}
        <button class="btn btn-ghost btn-icon-only" data-act="card" data-kind="country" data-id="${escHtml(key)}" title="產生分享圖卡" aria-label="產生分享圖卡">${ICONS.image}</button>
      </div>
      ${co.length ? `<h3 class="d-section">常一起出現的國家</h3>
        <div class="chip-row">${co.slice(0, 10).map(({ c: o, n }) =>
          `<button class="chip" data-act="country" data-c="${escHtml(o.key)}">${flag(o.a2)} ${escHtml(o.key)} <small>${n} 集</small></button>`).join('')}</div>` : ''}
      <h3 class="d-section">熱門地標</h3>
      <div class="lm-grid">${top}</div>
      ${c.landmarks.length > 12 ? `<p class="d-more">還有 ${c.landmarks.length - 12} 個地標，地球上都標出來了</p>` : ''}
      <h3 class="d-section">相關集數</h3>
      <div class="ep-mini-list">${eps.map(epMiniHtml).join('')}</div>
    </div>`, { type: 'country', id: key, label: c.key });

  setFocus({ lms: c.landmarks, countryKey: key });
  // 回訪網：連到同集出現過的國家，線越粗代表一起出現越多集
  const from = countryCentroid(c);
  setArcPairs(co.slice(0, 15).map(({ c: o, n }) => ({ from, to: countryCentroid(o), stroke: Math.min(0.9, 0.18 + n * 0.12) })));
  setRings([]);
  setLabels(c.landmarks.slice(0, 8));
  pushUrl(`country=${encodeURIComponent(key)}`);
  if (fly) flyTo(c.landmarks, 1800, 0.35);
}

function epMiniHtml(ep) {
  return `
    <button class="ep-mini" data-act="ep" data-ep="${ep.episode}">
      <img src="${escHtml(epCover(ep))}" alt="" loading="lazy">
      <span><b>Ep.${ep.episode}</b><em>${escHtml(ep.title)}</em></span>
    </button>`;
}

function onDetailClick(e) {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  if (act === 'back') goBack();
  else if (act === 'ep') showEpisode(Number(t.dataset.ep));
  else if (act === 'lm') showLandmark(landmarks[Number(t.dataset.lm)]);
  else if (act === 'country') showCountry(t.dataset.c);
  else if (act === 'story') startStory(Number(t.dataset.ep));
  else if (act === 'tag') { setTagFilter(t.dataset.tag); openDrawer(); }
  else if (act === 'share') copyText(`${SITE_URL}ep/${t.dataset.ep}.html`, '已複製這集的連結 ✓');
  else if (act === 'card') openShareCard(t.dataset.kind, t.dataset.kind === 'episode' ? Number(t.dataset.id) : t.dataset.id);
  else if (act === 'visit') {
    const a2 = t.dataset.a2;
    visited.has(a2) ? visited.delete(a2) : visited.add(a2);
    saveVisited();
    const on = visited.has(a2);
    t.classList.toggle('btn-primary', on);
    t.classList.toggle('btn-ghost', !on);
    t.textContent = on ? '✓ 我去過這裡' : '＋ 標記為我去過';
    toast(on ? `${ZH_BY_A2[a2] || a2} 已加進我的足跡` : '已從我的足跡移除');
  }
  else if (act === 'v-result') showVisitedOverlay();
  else if (act === 'v-country') {
    const c = ix.countryByA2.get(t.dataset.a2);
    if (c) flyTo(c.landmarks, 1400, 0.4);
  }
}

// ── 集數抽屜 ──────────────────────────────────────────
function openDrawer() {
  document.getElementById('drawer').classList.add('open');
  document.body.classList.add('has-drawer');
  setIntro(false);
  if (IS_SMALL) document.getElementById('detail').classList.remove('open');
}
function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.body.classList.remove('has-drawer');
}

function renderFilters() {
  const rp = document.getElementById('region-pills');
  rp.innerHTML = [`<button class="pill active" data-region="all">全部</button>`,
    ...REGIONS.map(r => `<button class="pill" data-region="${r}" style="--c:${REGION_COLORS[r]}">${r}</button>`)].join('');

  const years = [...new Set(ix.mainEps.map(e => (e.pubDate || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  const tp = document.getElementById('tag-pills');
  tp.innerHTML = [`<button class="pill active" data-tag="">所有主題</button>`,
    ...tagList.map(t => `<button class="pill" data-tag="${escHtml(t)}">${escHtml(t)}</button>`)].join('');

  const yp = document.getElementById('year-pills');
  yp.innerHTML = [`<button class="pill active" data-year="">所有年份</button>`,
    ...years.map(y => `<button class="pill" data-year="${y}">${y}</button>`)].join('');
}

function renderEpList() {
  const eps = filterEpisodes(ix, filters);
  document.getElementById('ep-count').textContent = eps.length;
  const list = document.getElementById('ep-list');
  if (!eps.length) {
    list.innerHTML = '<p class="d-empty">找不到符合的集數</p>';
    return;
  }
  list.innerHTML = eps.map(ep => {
    const lms = ix.lmByEp.get(ep.episode) || [];
    const flags = [...new Set(lms.map(l => l.a2).filter(Boolean))];
    const isNew = Date.now() - Date.parse(ep.pubDate) < 30 * 864e5;
    return `
      <button class="ep-card" data-ep="${ep.episode}">
        <img src="${escHtml(epCover(ep))}" alt="" loading="lazy">
        <span class="ep-card-info">
          <span class="ep-card-top"><b>Ep.${ep.episode}</b>${isNew ? '<i class="tag-new">NEW</i>' : ''}<small>${escHtml((ep.pubDate || '').slice(0, 7))}</small></span>
          <span class="ep-card-title">${escHtml(ep.title)}</span>
          ${lms.length ? `<span class="ep-card-meta">${flags.slice(0, 5).map(a => flag(a)).join('')}${flags.length > 5 ? `+${flags.length - 5}` : ''} <small>${lms.length} 個地標</small></span>`
            : isPending(ep.episode) ? '<span class="ep-card-meta ep-pending">地點整理中</span>' : ''}
        </span>
      </button>`;
  }).join('');
}

function setTagFilter(tag) {
  filters.tag = tag;
  document.querySelectorAll('#tag-pills .pill').forEach(x => x.classList.toggle('active', (x.dataset.tag || null) === tag));
  renderEpList();
  refreshPoints();
}

function isPending(epNum) {
  return !!extractedEps && !extractedEps.has(epNum) && !(ix.lmByEp.get(epNum) || []).length;
}

function onEpListClick(e) {
  const card = e.target.closest('.ep-card');
  if (card) showEpisode(Number(card.dataset.ep));
}

function onEpListHover(e) {
  if (IS_TOUCH) return;
  const card = e.target.closest('.ep-card');
  const ep = card ? Number(card.dataset.ep) : null;
  if (ep === hoverRings[0]) return;
  hoverRings = [ep];
  if (isDetailOpen() || story.on) return;
  setRings(ep ? (ix.lmByEp.get(ep) || []) : [], { maxR: 3, period: 800 });
}

// ── 開場 ──────────────────────────────────────────────
function renderHero() {
  const latest = ix.mainEps[0];
  if (!latest) return;
  const btn = document.getElementById('hero-latest');
  btn.hidden = false;
  btn.innerHTML = `<img src="${escHtml(epCover(latest))}" alt=""><span><small>最新一集</small><b>Ep.${latest.episode} ${escHtml(latest.title)}</b></span>`;
  btn.addEventListener('click', () => { if (globe) showEpisode(latest.episode); });
}

// 手機開場：介紹文字壓在下半部，地球往上挪到剩下的空間置中；離開開場就回到正中
function setIntro(on) {
  document.body.classList.toggle('intro', on);
  if (!globe || !IS_SMALL) return;
  const hero = document.getElementById('hero');
  globe.globeOffset([0, on ? -Math.round(hero.offsetHeight / 2) : 0]);
}

// 最新一集的地標放持續脈衝
function pulseLatest() {
  const latest = ix.mainEps[0];
  if (latest) setRings(ix.lmByEp.get(latest.episode) || [], { maxR: 3, period: 1400 });
}

// 圖例刻度跟 heat() 同一條開根號尺
function renderLegend() {
  const max = ix.maxCountryEps;
  document.getElementById('legend-bar').style.background =
    `linear-gradient(90deg, ${THEMES[theme].ramp.join(', ')})`;
  document.getElementById('legend-mid').textContent = Math.round(1 + (max - 1) / 4);   // heat = 0.5 的位置
  document.getElementById('legend-max').textContent = `${max} 集`;
  const home = ix.countries.get(HOME_COUNTRY);
  document.getElementById('legend-home').innerHTML =
    `<i style="background:${THEMES[theme].pin}"></i>地標　·　<i style="background:${THEMES[theme].home}"></i>台灣主場 ${home ? home.eps.size : 0} 集`;
}

function countUpHero() {
  const targets = {
    'hs-eps': ix.mainEps.length,
    'hs-lms': landmarks.length,
    'hs-cty': [...ix.countries.values()].filter(c => c.a2).length,
  };
  const t0 = performance.now();
  const dur = 1600;
  (function step(now) {
    const p = Math.min(1, (now - t0) / dur);
    const e = 1 - (1 - p) ** 3;
    for (const [id, n] of Object.entries(targets)) {
      document.getElementById(id).textContent = Math.round(n * e).toLocaleString();
    }
    if (p < 1) requestAnimationFrame(step);
  })(t0);
}

// ── 隨機出發 ──────────────────────────────────────────
function randomTrip() {
  if (story.on) exitStory();
  if (timeline.on) exitTimeline();
  if (visitedOn) exitVisited();
  const pool = ix.mainEps.filter(e => ix.lmByEp.has(e.episode) && e.episode !== detailStack.at(-1)?.id);
  const ep = pool[Math.floor(Math.random() * pool.length)];
  if (!ep) return;

  closeDetail();
  clearFocus();
  setIntro(false);
  const veil = document.getElementById('spin-veil');
  veil.classList.add('show');

  const c = globe.controls();
  c.autoRotate = true;
  c.autoRotateSpeed = 28;
  const v = globe.pointOfView();
  globe.pointOfView({ ...v, altitude: Math.max(v.altitude, 2.2) }, 600);

  setTimeout(() => {
    c.autoRotate = false;
    c.autoRotateSpeed = 0.45;
    veil.classList.remove('show');
    showEpisode(ep.episode);
  }, 1300);
}

// ── 導覽模式 ──────────────────────────────────────────
async function startStory(epNum) {
  const ep = ix.epMeta.get(epNum);
  applyEpisodeAccent(epNum);
  const fallback = (ix.lmByEp.get(epNum) || []).map(lm => {
    const a = (lm.appearances || []).find(x => x.ep === epNum) || {};
    return { ...lm, quote: a.quote, context: a.context };
  });

  // 單集檔案保留逐字稿中出現的順序，比全域檔更適合當導覽路線
  let stops = fallback;
  try {
    const file = await fetchJson(`data/episode_landmarks/ep${String(epNum).padStart(3, '0')}.json${DATA_V}`);
    const byName = new Map(fallback.map(l => [l.name, l]));
    const ordered = (Array.isArray(file) ? file : [])
      .filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon))
      .map(s => {
        const g = byName.get(s.name);
        return { ...s, id: g?.id, region: s.region || g?.region, image: s.image || g?.image, a2: g?.a2 ?? window.UTE.a2FromZh(s.country) };
      });
    if (ordered.length) stops = ordered;
  } catch (e) { /* 沒有單集檔就用全域資料 */ }

  if (!stops.length) return toast('這集沒有可導覽的地點');

  if (timeline.on) exitTimeline();
  closeDrawer();
  Object.assign(story, { on: true, ep, stops, i: -1, playing: true });
  document.body.classList.add('story-mode');
  document.getElementById('detail').classList.remove('open');
  document.getElementById('story-listen').href = ep.link || '#';
  document.getElementById('story-progress').innerHTML =
    stops.map((_, i) => `<button class="sp-dot" data-i="${i}" aria-label="第 ${i + 1} 站"></button>`).join('');
  setFocus({ lms: (ix.lmByEp.get(epNum) || []) });
  setLabels([]);
  setPlayIcon();
  goStop(0);
}

function goStop(i) {
  if (!story.on) return;
  clearTimeout(story.timer);
  const prev = story.stops[story.i];
  story.i = Math.max(0, Math.min(i, story.stops.length - 1));
  const s = story.stops[story.i];
  const color = REGION_COLORS[s.region] || DEFAULT_COLOR;

  document.getElementById('story-meta').innerHTML =
    `<span style="color:${color}">第 ${story.i + 1} / ${story.stops.length} 站</span> · ${flag(s.a2)} ${escHtml(s.country || '')} · Ep.${story.ep.episode}`;
  document.getElementById('story-name').textContent = s.name;
  document.getElementById('story-quote').textContent = s.quote ? `「${s.quote}」` : '';
  document.getElementById('story-context').textContent = s.context && s.context !== s.quote ? s.context : '';
  const img = document.getElementById('story-img');
  img.style.backgroundImage = `url('${(s.image || epCover(story.ep)).replace(/'/g, '%27')}')`;
  document.querySelectorAll('.sp-dot').forEach((d, k) => {
    d.classList.toggle('done', k < story.i);
    d.classList.toggle('active', k === story.i);
  });
  const card = document.querySelector('.story-card');
  card.classList.remove('enter'); void card.offsetWidth; card.classList.add('enter');

  const target = { lat: s.lat, lng: s.lon };
  const hop = prev ? angularDistance({ lat: prev.lat, lng: prev.lon }, target) : 1;
  const alt = hop < 0.01 ? 0.12 : hop < 0.08 ? 0.3 : 0.55;
  stopAutoRotate();
  // 手機導覽卡在下方，鏡頭往南偏讓地標落在畫面上半
  globe.pointOfView({ lat: s.lat - (IS_SMALL ? alt * 12 : 0), lng: s.lon, altitude: alt }, prev ? 2000 : 1600);

  setArcs(prev ? [{ ...s, stroke: 0.6 }] : [], prev ? { lat: prev.lat, lng: prev.lon } : HOME);
  setRings([s], { maxR: 5, period: 900, speed: 3 });
  setLabels([s]);

  if (story.playing) scheduleNextStop();
}

function scheduleNextStop() {
  clearTimeout(story.timer);
  story.timer = setTimeout(() => {
    if (story.i < story.stops.length - 1) goStop(story.i + 1);
    else { story.playing = false; setPlayIcon(); }
  }, 7000);
}

function toggleStoryPlay() {
  story.playing = !story.playing;
  setPlayIcon();
  if (story.playing) {
    if (story.i >= story.stops.length - 1) goStop(0);
    else scheduleNextStop();
  } else clearTimeout(story.timer);
}

function setPlayIcon() {
  const b = document.getElementById('story-play');
  b.textContent = story.playing ? '❚❚' : '▶';
  b.setAttribute('aria-label', story.playing ? '暫停' : '播放');
}

function exitStory() {
  if (!story.on) return;
  clearTimeout(story.timer);
  const epNum = story.ep.episode;
  story.on = false;
  document.body.classList.remove('story-mode');
  detailStack = detailStack.filter(e => !(e.type === 'ep' && e.id === epNum));
  showEpisode(epNum);
}

// ── 時間線 ────────────────────────────────────────────
const TIMELINE_PLAY_MS = 26000;   // 時間線從頭播到尾的長度（網頁播放與匯出影片共用）

function enterTimeline({ autoplay = true, altitude = IS_SMALL ? 3.2 : 2.3 } = {}) {
  if (story.on) exitStory();
  if (visitedOn) exitVisited();
  closeDetail();
  closeDrawer();
  clearFocus();

  // 預先依時間排序，播放時每一格只要二分搜尋，不必重掃 1,890 個地標
  const sorted = landmarks.filter(lm => ix.lmFirstMs.has(lm)).sort((a, b) => ix.lmFirstMs.get(a) - ix.lmFirstMs.get(b));
  const epsAsc = [...ix.mainEps].sort((a, b) => Date.parse(a.pubDate) - Date.parse(b.pubDate));
  const countryEpTimes = new Map([...ix.countries.values()].map(c =>
    [c.key, [...c.eps].map(n => Date.parse(ix.epMeta.get(n).pubDate)).sort((a, b) => a - b)]));
  const sortedMs = sorted.map(lm => ix.lmFirstMs.get(lm));
  const epMs = epsAsc.map(e => Date.parse(e.pubDate));
  const min = Math.min(sortedMs[0], epMs[0]);
  const max = Math.max(sortedMs.at(-1), epMs.at(-1));
  const pov = globe.pointOfView();

  Object.assign(timeline, {
    on: true, min, max, rate: (max - min) / TIMELINE_PLAY_MS,
    sorted, sortedMs, epsAsc, epMs, countryEpTimes,
    nVisible: -1, nEps: -1, lastEp: null, countryCounts: new Map(),
    follow: true, alt: altitude, cam: vec3(pov.lat, pov.lng), vel: [0, 0, 0],
  });
  document.body.classList.add('timeline-mode');
  document.getElementById('btn-timeline').classList.add('active');

  const slider = document.getElementById('tl-slider');
  slider.min = min;
  slider.max = max;

  const y0 = new Date(min).getFullYear();
  const y1 = new Date(max).getFullYear();
  let years = '';
  for (let y = y0 + 1; y <= y1; y++) {
    const pct = (Date.parse(`${y}-01-01`) - min) / (max - min) * 100;
    years += `<span style="left:${pct.toFixed(1)}%">${y}</span>`;
  }
  document.getElementById('tl-years').innerHTML = years;

  stopAutoRotate();
  globe.pointOfView({ lat: HOME.lat, lng: HOME.lng, altitude }, autoplay ? 1200 : 0);
  timeline.cam = vec3(HOME.lat, HOME.lng);
  timeline.vel = [0, 0, 0];
  setTimeline(min);
  if (autoplay) setTimeout(startTimelinePlay, 1000);
}

function setTimeline(ms) {
  timeline.ms = ms;
  const slider = document.getElementById('tl-slider');
  slider.value = ms;
  slider.style.setProperty('--pct', `${((ms - timeline.min) / (timeline.max - timeline.min) * 100).toFixed(2)}%`);
  const d = new Date(Math.max(ms, timeline.min));
  document.getElementById('tl-date').textContent = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`;

  // 地標數有變才更新地球
  const n = countLE(timeline.sortedMs, ms);
  if (n !== timeline.nVisible) {
    timeline.nVisible = n;
    setPoints(timeline.sorted.slice(0, n));
    document.getElementById('tl-lms').textContent = n.toLocaleString();
  }

  // 集數有變才重算國家熱度、換最新一集
  const k = countLE(timeline.epMs, ms);
  if (k === timeline.nEps) return;
  timeline.nEps = k;
  const counts = new Map();
  for (const [key, times] of timeline.countryEpTimes) {
    const c = countLE(times, ms);
    if (c) counts.set(key, c);
  }
  timeline.countryCounts = counts;
  refreshHex();
  document.getElementById('tl-cty').textContent = counts.size;

  const latest = k ? timeline.epsAsc[k - 1] : null;
  if (latest && latest !== timeline.lastEp) {
    timeline.lastEp = latest;
    timeline.lastEpAt = performance.now();
    document.getElementById('tl-ep').innerHTML = `<b>Ep.${latest.episode}</b> ${escHtml(latest.title)}`;
    const lms = ix.lmByEp.get(latest.episode) || [];
    if (lms.length) {
      setRings(lms, { maxR: 4, period: 700, speed: 4 });
      setArcs(lms.slice(0, 12));
    }
  } else if (!latest) {
    document.getElementById('tl-ep').textContent = '';
    setRings([]);
    setArcs([]);
  }
}

// 鏡頭目標：最近 6 集地點的加權平均（越新權重越大），不會每集來回跳
function timelineCamTarget() {
  let sum = [0, 0, 0], found = 0;
  for (let i = timeline.nEps - 1, w = 1; i >= 0 && found < 6; i--) {
    const lms = ix.lmByEp.get(timeline.epsAsc[i].episode) || [];
    if (!lms.length) continue;
    const c = normV(lms.reduce((s, l) => addV(s, vec3(l.lat, l.lon)), [0, 0, 0]));
    sum = addV(sum, c.map(x => x * w));
    w *= 0.6;
    found++;
  }
  return found ? normV(sum) : null;
}

// 鏡頭用臨界阻尼彈簧追目標：位置和速度都連續，新的一集在遠方出現時會慢慢加速、慢慢停，
// 不會像一階平滑那樣速度瞬間跳變（那就是畫面「頓一下」的來源）
const CAM_OMEGA = 1.5;   // 彈簧自然頻率（rad/s），越小越慢越柔
function stepTimelineCamera(dt, target = timelineCamTarget()) {
  if (!timeline.follow) return;
  if (target) {
    const s = dt / 1000;
    const w = CAM_OMEGA;
    timeline.vel = timeline.vel.map((v, i) => v + ((target[i] - timeline.cam[i]) * w * w - 2 * w * v) * s);
    timeline.cam = normV(timeline.cam.map((x, i) => x + timeline.vel[i] * s));
  }
  const { lat, lng } = toLatLng(timeline.cam);
  globe.pointOfView({ lat, lng, altitude: timeline.alt }, 0);
}

function startTimelinePlay() {
  if (!timeline.on || timeline.playing) return;
  clearTrails();
  if (timeline.ms >= timeline.max) setTimeline(timeline.min);
  timeline.playing = true;
  timeline.follow = true;
  document.getElementById('tl-play').textContent = '❚❚';
  let last = performance.now();
  const tick = now => {
    if (!timeline.playing) return;
    const dt = Math.min(100, now - last);
    last = now;
    const next = timeline.ms + dt * timeline.rate;
    if (next >= timeline.max) { setTimeline(timeline.max); stopTimelinePlay(); showTrails(); return; }
    setTimeline(next);
    stepTimelineCamera(dt);
    timeline.raf = requestAnimationFrame(tick);
  };
  timeline.raf = requestAnimationFrame(tick);
}

function stopTimelinePlay() {
  timeline.playing = false;
  cancelAnimationFrame(timeline.raf);
  document.getElementById('tl-play').textContent = '▶';
}

function exitTimeline() {
  if (!timeline.on) return;
  stopTimelinePlay();
  clearTrails();
  timeline.on = false;
  document.body.classList.remove('timeline-mode');
  document.getElementById('btn-timeline').classList.remove('active');
  setRings([]);
  setArcs([]);
  refreshPoints();
  refreshHex();
}

// ── 向量小工具（鏡頭在球面上平滑移動用）──────────────
const DEG = Math.PI / 180;
const vec3 = (lat, lng) => [Math.cos(lat * DEG) * Math.cos(lng * DEG), Math.cos(lat * DEG) * Math.sin(lng * DEG), Math.sin(lat * DEG)];
const toLatLng = ([x, y, z]) => ({ lat: Math.atan2(z, Math.hypot(x, y)) / DEG, lng: Math.atan2(y, x) / DEG });
const addV = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const normV = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };
function countLE(sorted, t) {   // sorted 中 <= t 的個數
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; sorted[m] <= t ? lo = m + 1 : hi = m; }
  return lo;
}

// ── 我的足跡 ──────────────────────────────────────────
function saveVisited() {
  writeStore('ute-visited', JSON.stringify([...visited]));
  document.getElementById('btn-visited').dataset.count = visited.size || '';
}

function loadVisitedFromUrl() {
  const v = new URLSearchParams(location.search).get('visited');
  visited = new Set(v.split(',').filter(Boolean));
  saveVisited();
  enterVisited();
  showVisitedOverlay();
}

function enterVisited() {
  if (visitedOn) return;
  if (story.on) exitStory();
  if (timeline.on) exitTimeline();
  closeDrawer();
  visitedOn = true;
  document.body.classList.add('visited-mode');
  document.getElementById('btn-visited').classList.add('active');
  clearFocus();
  refreshPoints();
  refreshHex();
  detailStack = [];
  renderVisitedPanel();
}

function exitVisited() {
  if (!visitedOn) return;
  visitedOn = false;
  document.body.classList.remove('visited-mode');
  document.getElementById('btn-visited').classList.remove('active');
  closeModal('visited-overlay');
  closeDetail();
  refreshPoints();
  refreshHex();
}

function visitedDetails() {
  return [...visited].map(a2 => {
    const c = ix.countryByA2.get(a2);
    return { a2, zh: ZH_BY_A2[a2] || a2, epCount: c ? c.eps.size : 0, lmCount: c ? c.landmarks.length : 0 };
  }).sort((a, b) => b.epCount - a.epCount || a.zh.localeCompare(b.zh, 'zh-Hant'));
}

function renderVisitedPanel() {
  const n = visited.size;
  const pct = Math.round(n / TOTAL_COUNTRIES * 100);
  const list = visitedDetails();
  const listened = list.filter(c => c.epCount);
  openDetail(`
    <div class="d-hero d-hero-visited"><span>✈️</span></div>
    <div class="d-body">
      <div class="d-kicker">我的足跡</div>
      <h2 class="d-title">你解鎖了 ${pct}% 的地球</h2>
      <div class="progress"><i style="width:${pct}%"></i></div>
      <p class="d-sub">${n} / ${TOTAL_COUNTRIES} 個國家${listened.length ? ` · 其中 ${listened.length} 國節目也去過` : ''}</p>
      <p class="hint-box">在地球上點國家來標記，金色就是去過的地方</p>
      ${n ? `<button class="btn btn-primary btn-block" data-act="v-result">查看我的旅人稱號 &amp; 分享 →</button>` : ''}
      ${list.length ? `<h3 class="d-section">我的護照</h3>
        <div class="stamp-grid">${list.map(c => `
          <button class="stamp-cell" data-act="v-country" data-a2="${c.a2}" title="${escHtml(c.zh)}${c.epCount ? ` · 節目去過 ${c.epCount} 集` : ' · 節目還沒去過'}">
            ${stampSvg(countryStampInfo(c.a2), { faded: !c.epCount })}
          </button>`).join('')}</div>
        <p class="d-more">章上的日期是節目第一次去那裡的那一集；灰色的章是節目還沒去過的國家</p>` : ''}
      <button class="btn btn-ghost btn-block" data-close-visited>結束標記</button>
    </div>`, { type: 'visited', id: 'visited', label: '我的足跡' });
  document.querySelector('[data-close-visited]')?.addEventListener('click', exitVisited);
}

function showVisitedOverlay() {
  const n = visited.size;
  const pct = Math.round(n / TOTAL_COUNTRIES * 100);
  const tier = getTier(pct);
  // 有插圖就用 assets/tiers/tier-N.webp，沒有就退回線條圖示
  const illu = document.getElementById('v-illu');
  const img = new Image();
  img.alt = tier.title;
  img.onload = () => { illu.replaceChildren(img); illu.classList.add('has-art'); };
  illu.classList.remove('has-art');
  illu.innerHTML = tier.svg;
  img.src = `assets/tiers/tier-${TIERS.indexOf(tier)}.webp`;
  const title = document.getElementById('v-title');
  title.textContent = tier.title;
  title.style.color = tier.color;
  document.getElementById('v-sub').textContent = tier.sub;
  const p = document.getElementById('v-pct');
  p.textContent = `${pct}%`;
  p.style.color = tier.color;
  document.getElementById('v-count').textContent = `你去過 ${n} 個國家 / ${TOTAL_COUNTRIES} 個`;
  document.getElementById('v-chips').innerHTML = visitedDetails().map(c =>
    `<span class="v-stamp">${stampSvg(countryStampInfo(c.a2), { faded: !c.epCount })}</span>`).join('');
  openModal('visited-overlay');
}

function shareVisited() {
  const url = new URL(SITE_URL);
  const codes = [...visited].sort().join(',');
  if (codes) url.searchParams.set('visited', codes);
  copyText(url.toString(), '已複製分享連結 ✓');
}

// ── 統計 ──────────────────────────────────────────────
function renderStats() {
  const byYear = {};
  for (const e of ix.mainEps) {
    const y = (e.pubDate || '').slice(0, 4);
    if (y) byYear[y] = (byYear[y] || 0) + 1;
  }
  const byRegion = {};
  for (const lm of landmarks) byRegion[lm.region || '其他'] = (byRegion[lm.region || '其他'] || 0) + 1;
  const topCountries = [...ix.countries.values()].filter(c => c.key !== '台灣')
    .sort((a, b) => b.eps.size - a.eps.size || b.landmarks.length - a.landmarks.length).slice(0, 10);
  const revisited = [...landmarks].sort((a, b) => b.epNums.length - a.epNums.length).slice(0, 5);
  const farthest = landmarks.reduce((best, lm) => {
    const d = angularDistance(HOME, { lat: lm.lat, lng: lm.lon });
    return d > best.d ? { lm, d } : best;
  }, { lm: null, d: 0 });

  const bars = (rows, max, colorOf) => rows.map(([label, n, extra]) => `
    <div class="bar-row">
      <span class="bar-label">${label}</span>
      <span class="bar-track"><i style="width:${Math.round(n / max * 100)}%;${colorOf ? `background:${colorOf(extra ?? label)}` : ''}"></i></span>
      <span class="bar-val">${n}</span>
    </div>`).join('');

  const yRows = Object.entries(byYear).sort();
  const rRows = Object.entries(byRegion).sort((a, b) => b[1] - a[1]);
  const cRows = topCountries.map(c => [`${flag(c.a2)} ${escHtml(c.key)}`, c.eps.size, c.region]);

  document.getElementById('stats-body').innerHTML = `
    <div class="fun-facts">
      ${farthest.lm ? `<button class="fact" data-stat-lm="${farthest.lm.id}"><small>離台灣最遠的一站</small><b>${escHtml(farthest.lm.name)}</b><span>${Math.round(farthest.d * 6371).toLocaleString()} 公里</span></button>` : ''}
      ${revisited[0] ? `<button class="fact" data-stat-lm="${revisited[0].id}"><small>最常被提到的地標</small><b>${escHtml(revisited[0].name)}</b><span>${revisited[0].epNums.length} 集</span></button>` : ''}
    </div>
    <h3 class="d-section">最常去的國家（台灣以外）</h3>
    <div class="bars">${bars(cRows, cRows[0]?.[1] || 1)}</div>
    <h3 class="d-section">每年集數</h3>
    <div class="bars">${bars(yRows, Math.max(...yRows.map(r => r[1])))}</div>
    <h3 class="d-section">地標地區分布</h3>
    <div class="bars">${bars(rRows, rRows[0]?.[1] || 1, r => REGION_COLORS[r] || DEFAULT_COLOR)}</div>
    <h3 class="d-section">最常回訪的地標</h3>
    <div class="v-list">${revisited.map(lm => `
      <button class="v-row" data-stat-lm="${lm.id}">
        ${flag(lm.a2, 'v-flag')}
        <span><b>${escHtml(lm.name)}</b><em>${lm.epNums.length} 集提到</em></span>
      </button>`).join('')}</div>`;
}

// ── Modal ─────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ── 主題 ──────────────────────────────────────────────
function applyTheme(t, persist = true) {
  theme = t;
  document.documentElement.dataset.theme = t;
  const meta = THEME_META[t];
  document.getElementById('theme-ico').innerHTML = ICONS[meta.icon];
  document.getElementById('btn-theme').title = `目前：${meta.label}（點一下切換深色／淺色／探險地圖）`;
  document.querySelector('meta[name="theme-color"]').content = meta.color;
  if (accentEp != null) applyEpisodeAccent(accentEp);   // 配色依主題重算亮度
  if (persist) writeStore('ute-theme-v2', t);
  applyGlobeTheme();
  refreshPoints();
  if (ix) renderLegend();
}

// ── 網址 ──────────────────────────────────────────────
function pushUrl(query) {
  history.replaceState(null, '', query ? `?${query}` : location.pathname);
}

function handleDeepLink() {
  const p = new URLSearchParams(location.search);
  const ep = Number(p.get('ep'));
  const country = p.get('country');
  if (ep && ix.epMeta.has(ep)) setTimeout(() => showEpisode(ep), 600);
  else if (country && ix.countries.has(country)) setTimeout(() => showCountry(country), 600);
}

// ── 事件 ──────────────────────────────────────────────
function bindEvents() {
  const $ = id => document.getElementById(id);

  $('brand').addEventListener('click', resetHome);
  $('btn-random').addEventListener('click', randomTrip);
  $('hero-random').addEventListener('click', randomTrip);
  $('btn-episodes').addEventListener('click', () =>
    $('drawer').classList.contains('open') ? closeDrawer() : openDrawer());
  $('hero-browse').addEventListener('click', openDrawer);
  $('btn-timeline').addEventListener('click', () => timeline.on ? exitTimeline() : enterTimeline());
  $('btn-visited').addEventListener('click', () => visitedOn ? exitVisited() : enterVisited());
  $('btn-stats').addEventListener('click', () => { renderStats(); openModal('stats-modal'); });
  $('btn-theme').addEventListener('click', () => applyTheme(THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length]));
  saveVisited();

  document.addEventListener('click', e => {
    const c = e.target.closest('[data-close]');
    if (!c) return;
    const id = c.dataset.close;
    if (id === 'drawer') closeDrawer();
    else if (id === 'detail') { visitedOn ? exitVisited() : (closeDetail(), clearFocus()); }
    else closeModal(id);
  });
  document.querySelectorAll('.modal').forEach(m =>
    m.addEventListener('click', e => { if (e.target === m) closeModal(m.id); }));

  $('detail-body').addEventListener('click', onDetailClick);
  $('ep-list').addEventListener('click', onEpListClick);
  $('ep-list').addEventListener('pointerover', onEpListHover);
  $('ep-list').addEventListener('pointerleave', () => onEpListHover({ target: document.body }));

  let searchT;
  $('search').addEventListener('input', e => {
    clearTimeout(searchT);
    searchT = setTimeout(() => { filters.query = e.target.value; renderEpList(); }, 120);
  });
  $('region-pills').addEventListener('click', e => {
    const p = e.target.closest('.pill');
    if (!p) return;
    $('region-pills').querySelectorAll('.pill').forEach(x => x.classList.toggle('active', x === p));
    filters.region = p.dataset.region;
    renderEpList();
    refreshPoints();
  });
  $('tag-pills').addEventListener('click', e => {
    const p = e.target.closest('.pill');
    if (p) setTagFilter(p.dataset.tag || null);
  });
  $('year-pills').addEventListener('click', e => {
    const p = e.target.closest('.pill');
    if (!p) return;
    $('year-pills').querySelectorAll('.pill').forEach(x => x.classList.toggle('active', x === p));
    filters.year = p.dataset.year || null;
    renderEpList();
    refreshPoints();
  });

  $('story-prev').addEventListener('click', () => goStop(story.i - 1));
  $('story-next').addEventListener('click', () => goStop(story.i + 1));
  $('story-play').addEventListener('click', toggleStoryPlay);
  $('story-exit').addEventListener('click', exitStory);
  $('story-progress').addEventListener('click', e => {
    const d = e.target.closest('.sp-dot');
    if (d) goStop(Number(d.dataset.i));
  });

  $('tl-play').addEventListener('click', () => timeline.playing ? stopTimelinePlay() : startTimelinePlay());
  $('tl-exit').addEventListener('click', exitTimeline);
  $('tl-slider').addEventListener('input', e => { stopTimelinePlay(); clearTrails(); setTimeline(Number(e.target.value)); });
  $('tl-trails-card').addEventListener('click', () => openShareCard('trails'));
  $('btn-mosaic').addEventListener('click', openMosaic);
  $('landing').addEventListener('click', cancelLanding);

  $('v-share').addEventListener('click', shareVisited);
  $('v-card').addEventListener('click', () => openShareCard('visited'));
  $('share-native').addEventListener('click', shareCardNative);
  $('share-download').addEventListener('click', downloadCard);
  $('share-copy').addEventListener('click', () => lastCard && copyText(lastCard.link, '已複製連結 ✓'));
  $('stats-body').addEventListener('click', e => {
    const b = e.target.closest('[data-stat-lm]');
    if (!b) return;
    closeModal('stats-modal');
    showLandmark(landmarks[Number(b.dataset.statLm)]);
  });

  addEventListener('keydown', e => {
    if (e.target.matches('input')) { if (e.key === 'Escape') e.target.blur(); return; }
    if (e.key === 'Escape') {
      const modal = document.querySelector('.modal.open');
      if (modal) return closeModal(modal.id);
      if (story.on) return exitStory();
      if (timeline.on) return exitTimeline();
      if (visitedOn) return exitVisited();
      if (isDetailOpen()) { closeDetail(); clearFocus(); return; }
      closeDrawer();
    } else if (story.on && e.key === 'ArrowRight') goStop(story.i + 1);
    else if (story.on && e.key === 'ArrowLeft') goStop(story.i - 1);
    else if (story.on && e.key === ' ') { e.preventDefault(); toggleStoryPlay(); }
  });
}

function resetHome() {
  if (story.on) { clearTimeout(story.timer); story.on = false; document.body.classList.remove('story-mode'); }
  if (timeline.on) exitTimeline();
  if (visitedOn) exitVisited();
  closeDetail();
  closeDrawer();
  clearFocus();
  setIntro(true);
  renderHero();
  globe.pointOfView({ lat: HOME.lat - 5, lng: HOME.lng - 20, altitude: IS_SMALL ? 2.8 : 2.4 }, 1400);
  const c = globe.controls();
  c.autoRotateSpeed = 0.45;
  c.autoRotate = true;
}

// ── 效能偵測：掉幀就自動降級 ───────────────────────────
// 等級 1：原生解析度改 1 倍、關大氣光暈、玻璃模糊改實色；等級 2：點陣再粗一階、關日夜貼圖更新
let perfLevel = 0;
function watchPerformance(round = 0) {
  if (new URLSearchParams(location.search).has('lite')) return degrade(2);
  if (document.hidden) return setTimeout(() => watchPerformance(round), 3000);
  let frames = 0;
  const t0 = performance.now();
  (function tick(now) {
    frames++;
    if (now - t0 < 2500) return requestAnimationFrame(tick);
    if (document.hidden) return setTimeout(() => watchPerformance(round), 3000);
    const fps = frames * 1000 / (now - t0);
    if (fps < 24) degrade(2);
    else if (fps < 40) degrade(perfLevel + 1);
    if (fps < 40 && round < 1) setTimeout(() => watchPerformance(round + 1), 1500);
  })(t0);
}

function degrade(level) {
  level = Math.min(2, level);
  if (level <= perfLevel) return;
  perfLevel = level;
  document.documentElement.dataset.lite = level;
  globe.renderer().setPixelRatio(1);
  globe.showAtmosphere(false).arcDashAnimateTime(0);
  if (level >= 2) globe.hexPolygonResolution(f => Math.max(2, f.hexRes - 1));
  console.info(`[perf] 降級到等級 ${level}`);
}

// ── 星空 ──────────────────────────────────────────────
function drawStars() {
  const cv = document.getElementById('stars');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  cv.width = innerWidth * dpr;
  cv.height = innerHeight * dpr;
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const n = Math.round(innerWidth * innerHeight / 2600);
  for (let i = 0; i < n; i++) {
    const r = rnd() ** 3 * 1.4 + 0.25;
    ctx.globalAlpha = 0.25 + rnd() * 0.65;
    ctx.fillStyle = rnd() < 0.15 ? '#ffe6b0' : rnd() < 0.3 ? '#cfe0ff' : '#ffffff';
    ctx.beginPath();
    ctx.arc(rnd() * innerWidth, rnd() * innerHeight, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── 工具 ──────────────────────────────────────────────
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = src;
    sc.onload = resolve;
    sc.onerror = reject;
    document.head.appendChild(sc);
  });
}

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch (e) { return false; }
}

function showFatal(html) {
  const l = document.getElementById('loading');
  l.querySelector('p').innerHTML = html;
  l.classList.add('fatal');
}

let toastT;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2600);
}

function copyText(text, okMsg) {
  const done = () => toast(okMsg);
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else fallbackCopy(text, done);
}
function fallbackCopy(text, onSuccess) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); onSuccess(); } catch (e) { /* 複製失敗就算了 */ }
  ta.remove();
}

function readStore(k) {
  try { return localStorage.getItem(k); } catch (e) { return null; }
}
function writeStore(k, v) {
  try { localStorage.setItem(k, v); } catch (e) { /* 私密模式 */ }
}
