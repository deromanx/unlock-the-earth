'use strict';

const TILES = {
  dark:  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  light: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
};
const TILE_ATTR = {
  dark:  '© <a href="https://carto.com">CARTO</a> · © <a href="https://www.openstreetmap.org/copyright">OSM</a>',
  light: '© <a href="https://carto.com">CARTO</a> · © <a href="https://www.openstreetmap.org/copyright">OSM</a>',
};
let tileLayer = null;
let currentTheme = localStorage.getItem('theme') || 'light';

const REGION_COLORS = {
  '亞洲':   '#4fc3f7',
  '歐洲':   '#ce93d8',
  '美洲':   '#81c784',
  '非洲':   '#ffb74d',
  '大洋洲': '#4db6ac',
  '極地':   '#90a4ae',
  '台灣':   '#f48fb1',
};
const DEFAULT_COLOR = '#e8a020';
const PODCAST_COVER = 'https://d3mww1g1pfq2pt.cloudfront.net/Avatar/cjzryn64q34i607580oyblh1u/1616036848631.jpg';

let map, clusterGroup;
let mode = 'episode';          // 'landmark' | 'episode'
let allEpisodes = [];          // raw episodes.json
let epMeta = {};               // episode number → episode object
let allLandmarks = [];         // landmarks_global.json entries
let mergedEpisodes = [];       // merged episode+location (episode mode)
let lmMarkers = [];            // landmark mode: array of {lm, marker}
let epMarkers = {};            // episode mode: ep number → marker
let activeCard = null;
let selectedEpNum = null;
let currentFilter = { region: 'all', query: '' };

// ── Timeline state ─────────────────────────────────────
let timelineMode = false;
let timelinePlaying = false;
let timelineInterval = null;
let lmDateMap = new Map();   // lm object → earliest episode pubDate as ms
let timelineMs = 0;
let timelineMinMs = 0;
let timelineMaxMs = 0;

// ── Init ───────────────────────────────────────────────
async function init() {
  initMap();

  let episodes, landmarks, locations;
  try {
    const _v = '?v=20';
    [episodes, landmarks, locations] = await Promise.all([
      fetch(`data/episodes.json${_v}`).then(r => r.json()),
      fetch(`data/landmarks_global.json${_v}`).then(r => r.json()).catch(() => []),
      fetch(`data/locations.json${_v}`).then(r => r.json()).catch(() => ({})),
    ]);
  } catch (e) {
    console.error('Failed to load data:', e);
    document.getElementById('episode-list').innerHTML =
      '<p class="no-results">無法載入集數資料，請確認 data/episodes.json 已產生。</p>';
    return;
  }

  allEpisodes = episodes;
  epMeta = {};
  for (const ep of episodes) {
    if (ep.episode) epMeta[ep.episode] = ep;
  }

  const mainEps = allEpisodes.filter(e => e.type === 'main');

  if (landmarks && landmarks.length > 0) {
    mode = 'landmark';
    allLandmarks = landmarks;

    document.getElementById('stat-eps').textContent = `${mainEps.length} 集`;
    document.getElementById('stat-dest').textContent = `${landmarks.length} 個地標`;

    plotLandmarkMarkers(allLandmarks);
    initLmDates();
    document.getElementById('timeline-btn').style.display = '';
    renderEpisodeList(mainEps);
  } else {
    mode = 'episode';
    mergedEpisodes = mergeData(episodes, locations);
    const located = mergedEpisodes.filter(e => e.type === 'main' && e.location);
    const destCount = new Set(located.map(e => e.location.destination)).size;

    document.getElementById('stat-eps').textContent = `${mainEps.length} 集`;
    document.getElementById('stat-dest').textContent = `${destCount} 個目的地`;

    plotEpisodeMarkers(located);
    renderList(mergedEpisodes);
  }

  bindEvents();
  renderYearFilter();
  document.getElementById('stats')?.addEventListener('click', openStatsModal);
  handleDeepLink();
  loadVisitedFromUrl();
}

// ── Map Setup ──────────────────────────────────────────
function initMap() {
  map = L.map('map', {
    center: [20, 100],
    zoom: 3,
    minZoom: 3,
    zoomControl: false,
    attributionControl: false,
    worldCopyJump: false,
    maxBounds: [[-85, -180], [85, 180]],
    maxBoundsViscosity: 0.8,
  });

  if (currentTheme === 'light') document.body.classList.add('light');
  updateThemeIcons();

  tileLayer = L.tileLayer(TILES[currentTheme], { maxZoom: 18 }).addTo(map);

  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.control.attribution({ position: 'bottomleft', prefix: false })
    .addAttribution('© <a href="https://carto.com">CARTO</a> · © <a href="https://www.openstreetmap.org/copyright">OSM</a>')
    .addTo(map);

  clusterGroup = L.markerClusterGroup({
    maxClusterRadius: 40,
    showCoverageOnHover: false,
    iconCreateFunction(cluster) {
      const count = cluster.getChildCount();
      return L.divIcon({
        html: `<div class="cluster-inner">${count}</div>`,
        className: 'custom-cluster',
        iconSize: [36, 36],
      });
    },
  });
  map.addLayer(clusterGroup);
}

// ── Data (episode mode) ────────────────────────────────
function mergeData(episodes, locations) {
  return episodes.map(ep => ({
    ...ep,
    location: ep.episode ? (locations[String(ep.episode)] || null) : null,
  }));
}

// ── Smart Popup Positioning ────────────────────────────
function openSmartPopup(marker) {
  const pos = map.latLngToContainerPoint(marker.getLatLng());
  const HEADER_H = 62;
  const APPROX_H = 460;   // conservative popup height estimate
  const TIP_H = 20;
  const MARGIN = 12;

  const popup = marker.getPopup();
  const showBelow = (pos.y - HEADER_H) < (APPROX_H + TIP_H + MARGIN);

  popup.options.offset    = showBelow ? L.point(0, APPROX_H + TIP_H + MARGIN) : L.point(0, 0);
  popup.options.className = showBelow ? 'popup-below' : '';
  marker.openPopup();
}

// ── Landmark Mode: Markers ─────────────────────────────
function plotLandmarkMarkers(landmarks) {
  clusterGroup.clearLayers();
  lmMarkers = [];

  landmarks.forEach((lm, idx) => {
    const color = REGION_COLORS[lm.region] || DEFAULT_COLOR;
    const icon = L.divIcon({
      html: `<div class="ep-marker" style="width:12px;height:12px;background:${color};border-color:${color}80"></div>`,
      className: '',
      iconSize: [12, 12],
      iconAnchor: [6, 6],
      popupAnchor: [0, -10],
    });

    const marker = L.marker([lm.lat, lm.lon], { icon });
    marker.bindPopup(buildLandmarkPopup(lm), { maxWidth: 400, minWidth: 360, autoPan: false, maxHeight: 440 });
    marker.off('click'); // remove Leaflet's auto open-on-click (added by bindPopup)
    marker.on('popupopen', () => {
      pushEpToUrl((lm.appearances || [])[0]?.ep || null);
    });
    marker.on('popupclose', () => { clearHighlight(); pushEpToUrl(null); });
    marker.on('mouseover', function() {
      if (!this.isPopupOpen()) {
        this._hoverOpen = true;
        openSmartPopup(this);
      }
    });
    marker.on('mouseout', function() {
      if (this._hoverOpen) {
        this._hoverOpen = false;
        this.closePopup();
      }
    });
    marker.on('click', function() {
      this._hoverOpen = false;
      highlightEpCards(lm);
      if (!this.isPopupOpen()) openSmartPopup(this);
    });

    clusterGroup.addLayer(marker);
    lmMarkers.push({ lm, marker, idx });
  });
}

function buildLandmarkPopup(lm) {
  const color = REGION_COLORS[lm.region] || DEFAULT_COLOR;
  const appearances = lm.appearances || [];

  // Image header
  const imgHtml = lm.image
    ? `<div class="ep-popup-img" style="background-image:url('${lm.image}')">
         <span class="ep-badge" style="background:${color};color:#09111f">${escHtml(lm.region)}</span>
       </div>`
    : `<div style="height:8px;background:${color}22;border-bottom:2px solid ${color}"></div>`;

  // Landmark title
  const titleHtml = `
    <div class="ep-popup-body">
      <div class="ep-popup-meta">
        <span class="ep-dest" style="color:${color}">📍 ${escHtml(lm.name)}</span>
      </div>
      ${lm.name_en && lm.name_en !== lm.name ? `<p class="ep-popup-title" style="font-weight:700;font-size:14px;margin-bottom:4px">${escHtml(lm.name_en)}</p>` : ''}
      ${lm.country ? `<div class="lm-country-tag" onclick="flyToCountry('${lm.country.replace(/'/g, "\\'")}')">🌐 ${escHtml(lm.country)}</div>` : ''}
    `;

  // Appearances (up to 3)
  const shown = appearances.slice(0, 3);
  const quoteHtml = shown.map(a => {
    const ep = epMeta[a.ep];
    const link = ep?.link || '#';
    const epImg = ep?.image || PODCAST_COVER;
    const quoteAndContextSame = a.quote && a.context && a.quote.trim() === a.context.trim();
    return `
      <div class="lm-appearance-block">
        <div class="lm-app-ep-header">
          <img class="lm-ep-cover" src="${epImg}" alt="" loading="lazy">
          <div class="lm-app-ep-info">
            <a href="${link}" target="_blank" rel="noopener" class="lm-ep-tag" style="background:${color}22;color:${color};border-color:${color}44">Ep.${a.ep}</a>
            ${ep?.title ? `<div class="lm-ep-title-text">${escHtml(ep.title)}</div>` : ''}
          </div>
        </div>
        ${a.quote ? `<blockquote class="lm-blockquote" style="border-color:${color}">${escHtml(a.quote)}</blockquote>` : ''}
        ${a.context && !quoteAndContextSame ? `<div class="lm-context-text">${escHtml(a.context)}</div>` : ''}
      </div>`;
  }).join('');

  const moreHtml = appearances.length > 3
    ? `<div style="font-size:11px;color:var(--text-3);text-align:center;padding-top:4px">+ ${appearances.length - 3} 集更多出現</div>`
    : '';

  const mapsQuery = encodeURIComponent((lm.name_en || lm.name) + (lm.country ? `, ${lm.country}` : ''));
  const mapsLink = `<a href="https://www.google.com/maps/search/?api=1&query=${mapsQuery}" target="_blank" rel="noopener" class="popup-maps-link">📍 在 Google Maps 開啟</a>`;

  return `${imgHtml}${titleHtml}<div class="lm-appearances-wrap">${quoteHtml}${moreHtml}</div>${mapsLink}</div>`;
}

// ── Episode Mode: Markers ──────────────────────────────
function plotEpisodeMarkers(episodes) {
  clusterGroup.clearLayers();
  epMarkers = {};

  episodes.forEach(ep => {
    const { lat, lon } = ep.location;
    const color = REGION_COLORS[ep.location.region] || DEFAULT_COLOR;
    const isNew = isRecentEpisode(ep.pubDate);

    const icon = L.divIcon({
      html: `<div class="ep-marker${isNew ? ' ep-marker-new' : ''}"
                  style="width:14px;height:14px;background:${color};border-color:${color}80">
             </div>`,
      className: '',
      iconSize: [14, 14],
      iconAnchor: [7, 7],
      popupAnchor: [0, -10],
    });

    const marker = L.marker([lat, lon], { icon });
    marker.bindPopup(buildEpisodePopup(ep), { maxWidth: 280, minWidth: 280 });
    marker.on('popupopen', () => { highlightCard(ep.episode); pushEpToUrl(ep.episode); });
    marker.on('popupclose', () => { clearHighlight(); pushEpToUrl(null); });

    clusterGroup.addLayer(marker);
    epMarkers[ep.episode] = marker;
  });
}

function buildEpisodePopup(ep) {
  const color = REGION_COLORS[ep.location.region] || DEFAULT_COLOR;
  const img = ep.image || PODCAST_COVER;
  const duration = formatDuration(ep.duration);
  const date = ep.pubDate ? ep.pubDate.slice(0, 10) : '';
  const num = ep.episode ? `Ep. ${ep.episode}` : '';

  return `
    <div class="ep-popup-img" style="background-image:url('${img}')">
      ${num ? `<span class="ep-badge">${num}</span>` : ''}
    </div>
    <div class="ep-popup-body">
      <div class="ep-popup-meta">
        <span class="ep-dest">📍 ${ep.location.destination}</span>
        <span class="ep-region-tag" style="background:${color}22;color:${color}">${ep.location.region}</span>
      </div>
      <p class="ep-popup-title">${escHtml(ep.title)}</p>
      <div class="ep-popup-stats">
        ${date ? `<span>${date}</span>` : ''}
        ${duration ? `<span>${duration}</span>` : ''}
      </div>
      <a href="${ep.link}" target="_blank" rel="noopener" class="btn-listen">收聽此集 →</a>
      <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ep.location.destination + (ep.location.region ? ', ' + ep.location.region : ''))}" target="_blank" rel="noopener" class="popup-maps-link">📍 在 Google Maps 開啟</a>
    </div>`;
}

function isRecentEpisode(dateStr) {
  if (!dateStr) return false;
  const diff = (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24);
  return diff < 30;
}

// ── Episode List (landmark mode) ───────────────────────
function renderEpisodeList(episodes) {
  // Sort by episode number desc
  const sorted = [...episodes].filter(e => e.episode).sort((a, b) => b.episode - a.episode);

  const list = document.getElementById('episode-list');
  list.innerHTML = sorted.map(ep => {
    const img = ep.image || PODCAST_COVER;
    const date = ep.pubDate ? ep.pubDate.slice(0, 7) : '';
    // Count landmarks for this episode
    const lmCount = allLandmarks.filter(lm =>
      (lm.appearances || []).some(a => a.ep === ep.episode)
    ).length;

    return `
      <div class="ep-card" data-ep="${ep.episode}" data-link="${ep.link || ''}">
        <img class="ep-card-thumb" src="${img}" alt="" loading="lazy">
        <div class="ep-card-info">
          <div class="ep-card-top">
            <span class="ep-num">Ep.${ep.episode}</span>
            ${lmCount > 0 ? `<span class="ep-lm-count">📍 ${lmCount} 地標</span>` : ''}
          </div>
          <div class="ep-card-title">${escHtml(ep.title)}</div>
          ${date ? `<div class="ep-card-date">${date}</div>` : ''}
        </div>
        ${ep.link ? `<button class="ep-card-play" title="收聽此集">▶</button>` : ''}
      </div>`;
  }).join('');

  list.querySelectorAll('.ep-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.ep-card-play')) return;
      flyToEpisodeLandmarks(Number(card.dataset.ep));
    });
    card.querySelector('.ep-card-play')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (card.dataset.link) window.open(card.dataset.link, '_blank');
    });
    card.addEventListener('mouseenter', () => pulseMarkersForEp(Number(card.dataset.ep)));
    card.addEventListener('mouseleave', clearMarkerPulse);
  });
}

function flyToEpisodeLandmarks(epNum) {
  const epLMs = allLandmarks.filter(lm =>
    (lm.appearances || []).some(a => a.ep === epNum)
  );

  // Highlight the clicked episode card regardless
  clearHighlight();
  const card = document.querySelector(`.ep-card[data-ep="${epNum}"]`);
  if (card) { card.classList.add('active'); activeCard = card; }

  if (!epLMs.length) return;  // no landmarks: card stays highlighted, nothing else

  // Mark which episode is selected — highlights reapply via zoomend/moveend
  selectEpisodeLandmarks(epNum);

  // On mobile, close panel to reveal map
  closePanel();

  if (epLMs.length === 1) {
    map.flyTo([epLMs[0].lat, epLMs[0].lon], 15, { duration: 1.2 });
    const entry = lmMarkers.find(e => e.lm === epLMs[0]);
    setTimeout(() => entry?.marker?.openPopup(), 1300);
  } else {
    const bounds = L.latLngBounds(epLMs.map(lm => [lm.lat, lm.lon]));
    map.flyToBounds(bounds.pad(0.25), { duration: 1.2, maxZoom: 14 });
  }
}

// ── Episode List (episode mode) ────────────────────────
function renderList(episodes) {
  const { query, region } = currentFilter;
  const filtered = episodes.filter(ep => {
    if (ep.type !== 'main' || !ep.episode) return false;
    if (region !== 'all' && ep.location?.region !== region) return false;
    if (query) {
      const q = query.toLowerCase();
      if (!ep.title.toLowerCase().includes(q) &&
          !ep.location?.destination?.toLowerCase().includes(q) &&
          !String(ep.episode).includes(q)) return false;
    }
    return true;
  });

  const located = filtered.filter(e => e.location);
  const unlocated = filtered.filter(e => !e.location);
  const list = document.getElementById('episode-list');

  if (!filtered.length) {
    list.innerHTML = '<p class="no-results">找不到符合的集數</p>';
    return;
  }

  let html = located.map(ep => cardHtml(ep)).join('');
  if (unlocated.length) {
    html += `<div class="ep-section-label">尚未標記地點</div>`;
    html += unlocated.map(ep => cardHtml(ep)).join('');
  }
  list.innerHTML = html;

  list.querySelectorAll('.ep-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.ep-card-play')) return;
      flyToEpisode(Number(card.dataset.ep));
    });
    card.querySelector('.ep-card-play')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (card.dataset.link) window.open(card.dataset.link, '_blank');
    });
    card.addEventListener('mouseenter', () => pulseEpMarker(Number(card.dataset.ep)));
    card.addEventListener('mouseleave', clearMarkerPulse);
  });
}

function cardHtml(ep) {
  const color = ep.location ? (REGION_COLORS[ep.location.region] || DEFAULT_COLOR) : '#4a5f7a';
  const dest = ep.location?.destination || '';
  const img = ep.image || PODCAST_COVER;
  const date = ep.pubDate ? ep.pubDate.slice(0, 7) : '';

  return `
    <div class="ep-card" data-ep="${ep.episode}" data-link="${ep.link || ''}">
      <img class="ep-card-thumb" src="${img}" alt="" loading="lazy">
      <div class="ep-card-info">
        <div class="ep-card-top">
          <span class="ep-num">Ep.${ep.episode}</span>
          ${dest ? `<span class="ep-card-dest" style="color:${color}">📍 ${escHtml(dest)}</span>` : ''}
        </div>
        <div class="ep-card-title">${escHtml(ep.title)}</div>
        ${date ? `<div class="ep-card-date">${date}</div>` : ''}
      </div>
      ${ep.link ? `<button class="ep-card-play" title="收聽此集">▶</button>` : ''}
    </div>`;
}

// ── Navigation (episode mode) ──────────────────────────
function flyToEpisode(epNum) {
  const ep = mergedEpisodes.find(e => e.episode === epNum);
  if (!ep?.location) {
    if (ep?.link) window.open(ep.link, '_blank');
    return;
  }
  closePanel();
  map.flyTo([ep.location.lat, ep.location.lon], 7, { duration: 1.2 });
  setTimeout(() => epMarkers[epNum]?.openPopup(), 1300);
}

// ── Highlight ──────────────────────────────────────────
function highlightEpCards(lm) {
  clearHighlight();
  const epNums = (lm.appearances || []).map(a => a.ep);
  epNums.forEach(n => {
    const card = document.querySelector(`.ep-card[data-ep="${n}"]`);
    if (card) {
      card.classList.add('active');
      if (!activeCard) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      activeCard = card;
    }
  });
}

function highlightCard(epNum) {
  clearHighlight();
  const card = document.querySelector(`.ep-card[data-ep="${epNum}"]`);
  if (card) {
    card.classList.add('active');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    activeCard = card;
  }
}

function clearHighlight() {
  document.querySelectorAll('.ep-card.active').forEach(c => c.classList.remove('active'));
  activeCard = null;
}

// ── Marker Pulse (hover) ───────────────────────────────
function pulseMarkersForEp(epNum) {
  clearMarkerPulse();
  document.body.classList.add('ep-hover-mode');
  lmMarkers.forEach(({ lm, marker }) => {
    if (!(lm.appearances || []).some(a => a.ep === epNum)) return;
    const visible = clusterGroup.getVisibleParent(marker);
    if (visible) visible.getElement()?.classList.add('ep-marker-hover');
  });
}
function pulseEpMarker(epNum) {
  clearMarkerPulse();
  const marker = epMarkers[epNum];
  if (!marker) return;
  const visible = clusterGroup.getVisibleParent(marker);
  if (visible) visible.getElement()?.classList.add('ep-marker-hover');
}
function clearMarkerPulse() {
  document.body.classList.remove('ep-hover-mode');
  document.querySelectorAll('.ep-marker-hover').forEach(el => el.classList.remove('ep-marker-hover'));
}

function selectEpisodeLandmarks(epNum) {
  selectedEpNum = epNum;
  applyMarkerSelect();
}
function applyMarkerSelect() {
  document.querySelectorAll('.ep-marker-selected').forEach(el => el.classList.remove('ep-marker-selected'));
  if (!selectedEpNum) return;
  lmMarkers.forEach(({ lm, marker }) => {
    if (!(lm.appearances || []).some(a => a.ep === selectedEpNum)) return;
    const visible = clusterGroup.getVisibleParent(marker);
    if (visible) visible.getElement()?.classList.add('ep-marker-selected');
  });
}
function clearMarkerSelect() {
  selectedEpNum = null;
  document.querySelectorAll('.ep-marker-selected').forEach(el => el.classList.remove('ep-marker-selected'));
}

// ── Timeline Mode ──────────────────────────────────────
function initLmDates() {
  lmDateMap = new Map();
  lmMarkers.forEach(({ lm }) => {
    const dates = (lm.appearances || [])
      .map(a => epMeta[a.ep]?.pubDate)
      .filter(Boolean)
      .map(d => new Date(d).getTime());
    if (dates.length) lmDateMap.set(lm, Math.min(...dates));
  });
}

function enterTimelineMode() {
  if (timelineMode) return;
  timelineMode = true;
  document.body.classList.add('timeline-mode');
  document.getElementById('timeline-btn').classList.add('active');

  const dates = [...lmDateMap.values()];
  timelineMinMs = Math.min(...dates);
  timelineMaxMs = Math.max(...dates);

  renderTimelineControl();
  setTimelinePosition(timelineMinMs);
}

function exitTimelineMode() {
  if (!timelineMode) return;
  stopTimelinePlay();
  timelineMode = false;
  document.body.classList.remove('timeline-mode');
  document.getElementById('timeline-btn').classList.remove('active');
  document.getElementById('timeline-control')?.remove();
  rebuildCluster(() => true);
}

function renderTimelineControl() {
  document.getElementById('timeline-control')?.remove();

  const minYear = new Date(timelineMinMs).getFullYear();
  const maxYear = new Date(timelineMaxMs).getFullYear();
  const years = [];
  for (let y = minYear; y <= maxYear; y++) years.push(y);

  const yearLabelsHtml = years.map(y => {
    const ms = new Date(`${y}-01-01`).getTime();
    const pct = ((ms - timelineMinMs) / (timelineMaxMs - timelineMinMs) * 100).toFixed(1);
    return `<span class="tl-year" style="left:${pct}%">${y}</span>`;
  }).join('');

  const ctrl = document.createElement('div');
  ctrl.id = 'timeline-control';
  ctrl.innerHTML = `
    <div class="tl-inner">
      <button class="tl-play-btn" id="tl-play-btn" title="播放">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
      </button>
      <div class="tl-slider-wrap">
        <div class="tl-year-labels">${yearLabelsHtml}</div>
        <input type="range" id="tl-slider" min="${timelineMinMs}" max="${timelineMaxMs}" value="${timelineMinMs}" step="86400000">
      </div>
      <div class="tl-info-row">
        <div class="tl-date-label" id="tl-date-label">—</div>
        <div class="tl-stats-label" id="tl-stats-label">— 個地標</div>
      </div>
      <button class="tl-exit-btn" id="tl-exit-btn">✕ 退出</button>
    </div>`;

  document.body.appendChild(ctrl);

  document.getElementById('tl-slider').addEventListener('input', e => {
    stopTimelinePlay();
    setTimelinePosition(Number(e.target.value));
  });
  document.getElementById('tl-play-btn').addEventListener('click', toggleTimelinePlay);
  document.getElementById('tl-exit-btn').addEventListener('click', exitTimelineMode);
}

function setTimelinePosition(ms) {
  timelineMs = ms;
  const slider = document.getElementById('tl-slider');
  if (slider) {
    slider.value = ms;
    const pct = ((ms - timelineMinMs) / (timelineMaxMs - timelineMinMs) * 100).toFixed(1);
    slider.style.setProperty('--pct', `${pct}%`);
  }

  const d = new Date(ms);
  const dateLabel = document.getElementById('tl-date-label');
  if (dateLabel) dateLabel.textContent = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`;

  const count = [...lmDateMap.entries()].filter(([, t]) => t <= ms).length;
  const statsLabel = document.getElementById('tl-stats-label');
  if (statsLabel) statsLabel.textContent = `${count} 個地標`;

  rebuildCluster(lm => {
    const t = lmDateMap.get(lm);
    return t !== undefined && t <= ms;
  });
}

function toggleTimelinePlay() {
  timelinePlaying ? stopTimelinePlay() : startTimelinePlay();
}

function startTimelinePlay() {
  if (timelineMs >= timelineMaxMs) {
    setTimelinePosition(timelineMinMs); // 從頭重播
  }
  timelinePlaying = true;
  const btn = document.getElementById('tl-play-btn');
  if (btn) btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;

  const step = 14 * 24 * 60 * 60 * 1000; // 2 weeks per tick
  timelineInterval = setInterval(() => {
    const next = timelineMs + step;
    if (next >= timelineMaxMs) {
      stopTimelinePlay();
      setTimelinePosition(timelineMaxMs);
      return;
    }
    setTimelinePosition(next);
  }, 200);
}

function stopTimelinePlay() {
  if (!timelinePlaying) return;
  timelinePlaying = false;
  clearInterval(timelineInterval);
  timelineInterval = null;
  const btn = document.getElementById('tl-play-btn');
  if (btn) btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>`;
}

// ── URL Deep Link ──────────────────────────────────────
function pushEpToUrl(epNum) {
  history.replaceState(null, '', epNum ? `?ep=${epNum}` : window.location.pathname);
}
function handleDeepLink() {
  const ep = Number(new URLSearchParams(window.location.search).get('ep'));
  if (!ep) return;
  // 不預先 openPanel：手機上 flyToEpisodeLandmarks 會呼叫 closePanel，
  // 導致面板閃爍開關；桌機 panel 由 CSS 常駐顯示，不需此呼叫。
  setTimeout(() => {
    if (mode === 'landmark') {
      flyToEpisodeLandmarks(ep);
    } else {
      flyToEpisode(ep);
    }
  }, 400);
}

// ── Country Zoom ───────────────────────────────────────
function flyToCountry(country) {
  const lms = allLandmarks.filter(lm => lm.country === country);
  if (!lms.length) return;
  map.closePopup();
  if (lms.length === 1) {
    map.flyTo([lms[0].lat, lms[0].lon], 9, { duration: 1.3 });
  } else {
    const bounds = L.latLngBounds(lms.map(lm => [lm.lat, lm.lon]));
    map.flyToBounds(bounds.pad(0.25), { duration: 1.3, maxZoom: 8 });
  }
}

// ── Home Reset ─────────────────────────────────────────
function resetToHome() {
  map.flyTo([20, 100], 3, { duration: 1.2 });
  clearHighlight();
  clearMarkerSelect();
  if (timelineMode) exitTimelineMode();
  if (mode === 'landmark') rebuildCluster(() => true);
}

// ── Panel ──────────────────────────────────────────────
function openPanel() {
  document.getElementById('panel').classList.add('open');
  document.getElementById('overlay').classList.add('show');
}
function closePanel() {
  document.getElementById('panel').classList.remove('open');
  document.getElementById('overlay').classList.remove('show');
}

// ── Events ─────────────────────────────────────────────
function bindEvents() {
  document.querySelector('.logo').addEventListener('click', resetToHome);
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
  document.getElementById('toggle-panel').addEventListener('click', openPanel);
  document.getElementById('close-panel').addEventListener('click', closePanel);
  document.getElementById('overlay').addEventListener('click', closePanel);

  if (mode === 'episode') {
    const searchInput = document.getElementById('search-input');
    const clearBtn = document.getElementById('clear-search');

    searchInput.addEventListener('input', () => {
      currentFilter.query = searchInput.value.trim();
      clearBtn.classList.toggle('visible', currentFilter.query.length > 0);
      renderList(mergedEpisodes);
    });
    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      currentFilter.query = '';
      clearBtn.classList.remove('visible');
      renderList(mergedEpisodes);
    });
    document.getElementById('region-filters').addEventListener('click', e => {
      const pill = e.target.closest('.pill');
      if (!pill) return;
      document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentFilter.region = pill.dataset.region;
      renderList(mergedEpisodes);
    });
  } else {
    // landmark mode: search + region filter
    const searchInput = document.getElementById('search-input');
    const clearBtn = document.getElementById('clear-search');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        currentFilter.query = searchInput.value.trim();
        clearBtn?.classList.toggle('visible', currentFilter.query.length > 0);
        renderEpisodeList(getFilteredMainEps());
      });
      clearBtn?.addEventListener('click', () => {
        searchInput.value = '';
        currentFilter.query = '';
        clearBtn.classList.remove('visible');
        renderEpisodeList(getFilteredMainEps());
      });
    }
    document.getElementById('region-filters')?.addEventListener('click', e => {
      const pill = e.target.closest('.pill');
      if (!pill) return;
      document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentFilter.region = pill.dataset.region;
      applyRegionFilter();
    });
  }

  document.getElementById('timeline-btn')?.addEventListener('click', () => {
    timelineMode ? exitTimelineMode() : enterTimelineMode();
  });

  document.getElementById('visited-btn')?.addEventListener('click', () => {
    visitedMode ? exitVisitedMode() : enterVisitedMode();
  });

  map.on('click', () => { clearHighlight(); clearMarkerSelect(); });
  map.on('zoomend moveend', applyMarkerSelect);
}

// ── Theme ──────────────────────────────────────────────
function updateThemeIcons() {
  const isDark = currentTheme === 'dark';
  document.getElementById('icon-moon').style.display = isDark ? '' : 'none';
  document.getElementById('icon-sun').style.display  = isDark ? 'none' : '';
}

function toggleTheme() {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.body.classList.toggle('light', currentTheme === 'light');
  localStorage.setItem('theme', currentTheme);
  updateThemeIcons();
  if (tileLayer) {
    map.removeLayer(tileLayer);
    tileLayer = L.tileLayer(TILES[currentTheme], { maxZoom: 18 }).addTo(map);
    tileLayer.bringToBack();
  }
}

// ── Utils ──────────────────────────────────────────────
function formatDuration(secs) {
  if (!secs) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m} 分鐘`;
}

function escHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Stats Modal (item 20) ──────────────────────────────
function openStatsModal() {
  let modal = document.getElementById('stats-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'stats-modal';
    modal.innerHTML = `
      <div class="stats-modal-backdrop"></div>
      <div class="stats-modal-box">
        <div class="stats-modal-head">
          <h2>播客統計</h2>
          <button id="close-stats-modal">✕</button>
        </div>
        <div class="stats-modal-body" id="stats-modal-body"></div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('.stats-modal-backdrop').addEventListener('click', closeStatsModal);
    modal.querySelector('#close-stats-modal').addEventListener('click', closeStatsModal);
  }
  renderStatsContent();
  modal.classList.add('open');
}
function closeStatsModal() {
  document.getElementById('stats-modal')?.classList.remove('open');
}
function renderStatsContent() {
  const body = document.getElementById('stats-modal-body');
  const mainEps = allEpisodes.filter(e => e.type === 'main' && e.episode);

  // Episodes per year
  const byYear = {};
  mainEps.forEach(e => {
    if (!e.pubDate) return;
    const y = e.pubDate.slice(0, 4);
    byYear[y] = (byYear[y] || 0) + 1;
  });
  const years = Object.keys(byYear).sort();
  const maxY = Math.max(...Object.values(byYear));
  const yearBars = years.map(y => {
    const pct = Math.round(byYear[y] / maxY * 100);
    return `<div class="stat-bar-row">
      <span class="stat-bar-label">${y}</span>
      <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${pct}%"></div></div>
      <span class="stat-bar-val">${byYear[y]}</span>
    </div>`;
  }).join('');

  // Landmark count by region
  const byRegion = {};
  allLandmarks.forEach(lm => {
    const r = lm.region || '其他';
    byRegion[r] = (byRegion[r] || 0) + 1;
  });
  const regions = Object.entries(byRegion).sort((a, b) => b[1] - a[1]);
  const maxR = regions[0]?.[1] || 1;
  const regionBars = regions.map(([r, cnt]) => {
    const pct = Math.round(cnt / maxR * 100);
    const color = REGION_COLORS[r] || DEFAULT_COLOR;
    return `<div class="stat-bar-row">
      <span class="stat-bar-label" style="color:${color}">${r}</span>
      <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${pct}%;background:${color}"></div></div>
      <span class="stat-bar-val">${cnt}</span>
    </div>`;
  }).join('');

  body.innerHTML = `
    <div class="stat-section">
      <h3>每年集數</h3>
      <div class="stat-bars">${yearBars}</div>
    </div>
    <div class="stat-section">
      <h3>地標地區分布</h3>
      <div class="stat-bars">${regionBars}</div>
    </div>`;
}

// ── Year Filter / Timeline (item 21) ──────────────────
let activeYear = null;
function renderYearFilter() {
  if (mode !== 'landmark') return;
  const list = document.getElementById('episode-list');
  const wrap = document.createElement('div');
  wrap.id = 'year-filter-row';
  wrap.className = 'year-filter-row';

  const mainEps = allEpisodes.filter(e => e.type === 'main' && e.pubDate && e.episode);
  const years = [...new Set(mainEps.map(e => e.pubDate.slice(0, 4)))].sort();

  wrap.innerHTML = [
    `<button class="year-pill active" data-year="">全部年份</button>`,
    ...years.map(y => `<button class="year-pill" data-year="${y}">${y}</button>`)
  ].join('');

  list.parentNode.insertBefore(wrap, list);

  wrap.querySelectorAll('.year-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      wrap.querySelectorAll('.year-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeYear = btn.dataset.year || null;
      applyYearFilter();
    });
  });
}
function getFilteredMainEps() {
  let eps = allEpisodes.filter(e => e.type === 'main' && e.episode);
  if (activeYear) eps = eps.filter(e => e.pubDate?.startsWith(activeYear));
  if (currentFilter.region !== 'all') {
    eps = eps.filter(ep =>
      allLandmarks.some(lm =>
        lm.region === currentFilter.region &&
        (lm.appearances || []).some(a => a.ep === ep.episode)
      )
    );
  }
  if (currentFilter.query) {
    const q = currentFilter.query.toLowerCase();
    eps = eps.filter(e =>
      (e.title || '').toLowerCase().includes(q) ||
      String(e.episode).includes(q)
    );
  }
  return eps;
}

function applyClusterFilter() {
  rebuildCluster(lm => {
    if (currentFilter.region !== 'all' && lm.region !== currentFilter.region) return false;
    if (!activeYear) return true;
    return (lm.appearances || []).some(a => epMeta[a.ep]?.pubDate?.startsWith(activeYear));
  });
}

function applyRegionFilter() {
  renderEpisodeList(getFilteredMainEps());
  applyClusterFilter();
}

function applyYearFilter() {
  renderEpisodeList(getFilteredMainEps());
  applyClusterFilter();
}

function rebuildCluster(predicate) {
  clusterGroup.clearLayers();
  lmMarkers.forEach(({ lm, marker }) => {
    if (predicate(lm)) clusterGroup.addLayer(marker);
  });
}

// ── Visited Countries Mode ─────────────────────────────
const ISO_NUM = {
  "004":["AF","阿富汗"],"008":["AL","阿爾巴尼亞"],"010":["AQ","南極洲"],"012":["DZ","阿爾及利亞"],
  "016":["AS","美屬薩摩亞"],"020":["AD","安道爾"],"024":["AO","安哥拉"],"028":["AG","安地卡及巴布達"],
  "031":["AZ","亞塞拜然"],"032":["AR","阿根廷"],"036":["AU","澳洲"],"040":["AT","奧地利"],
  "044":["BS","巴哈馬"],"048":["BH","巴林"],"050":["BD","孟加拉"],"051":["AM","亞美尼亞"],
  "052":["BB","巴貝多"],"056":["BE","比利時"],"060":["BM","百慕達"],"064":["BT","不丹"],
  "068":["BO","玻利維亞"],"070":["BA","波士尼亞與赫塞哥維納"],"072":["BW","波札那"],
  "076":["BR","巴西"],"084":["BZ","貝里斯"],"086":["IO","英屬印度洋領地"],"090":["SB","索羅門群島"],
  "092":["VG","英屬維京群島"],"096":["BN","汶萊"],"100":["BG","保加利亞"],"104":["MM","緬甸"],
  "108":["BI","蒲隆地"],"112":["BY","白俄羅斯"],"116":["KH","柬埔寨"],"120":["CM","喀麥隆"],
  "124":["CA","加拿大"],"132":["CV","維德角"],"136":["KY","開曼群島"],"140":["CF","中非共和國"],
  "144":["LK","斯里蘭卡"],"148":["TD","查德"],"152":["CL","智利"],"156":["CN","中國"],
  "158":["TW","台灣"],"162":["CX","聖誕島"],"166":["CC","科科斯群島"],"170":["CO","哥倫比亞"],
  "174":["KM","葛摩"],"175":["YT","馬約特"],"178":["CG","剛果共和國"],"180":["CD","剛果民主共和國"],
  "184":["CK","庫克群島"],"188":["CR","哥斯大黎加"],"191":["HR","克羅埃西亞"],
  "192":["CU","古巴"],"196":["CY","賽普勒斯"],"203":["CZ","捷克"],
  "204":["BJ","貝南"],"208":["DK","丹麥"],"212":["DM","多米尼克"],"214":["DO","多明尼加"],
  "218":["EC","厄瓜多"],"222":["SV","薩爾瓦多"],"226":["GQ","赤道幾內亞"],"231":["ET","衣索比亞"],
  "232":["ER","厄利垂亞"],"233":["EE","愛沙尼亞"],"234":["FO","法羅群島"],"238":["FK","福克蘭群島"],
  "239":["GS","南喬治亞與南桑威奇群島"],"242":["FJ","斐濟"],"246":["FI","芬蘭"],
  "248":["AX","奧蘭群島"],"250":["FR","法國"],"258":["PF","法屬玻里尼西亞"],"260":["TF","法屬南部領地"],
  "262":["DJ","吉布地"],"266":["GA","加彭"],"268":["GE","喬治亞"],"270":["GM","甘比亞"],
  "275":["PS","巴勒斯坦"],"276":["DE","德國"],"288":["GH","迦納"],"292":["GI","直布羅陀"],
  "296":["KI","吉里巴斯"],"300":["GR","希臘"],"304":["GL","格陵蘭"],"308":["GD","格瑞那達"],
  "312":["GP","瓜地洛普"],"316":["GU","關島"],"320":["GT","瓜地馬拉"],"324":["GN","幾內亞"],
  "328":["GY","蓋亞那"],"332":["HT","海地"],"334":["HM","赫德島和麥克唐納群島"],"340":["HN","宏都拉斯"],
  "344":["HK","中國香港"],"348":["HU","匈牙利"],"352":["IS","冰島"],"356":["IN","印度"],
  "360":["ID","印尼"],"364":["IR","伊朗"],"368":["IQ","伊拉克"],"372":["IE","愛爾蘭"],
  "376":["IL","以色列"],"380":["IT","義大利"],"384":["CI","象牙海岸"],"388":["JM","牙買加"],
  "392":["JP","日本"],"398":["KZ","哈薩克"],"400":["JO","約旦"],"404":["KE","肯亞"],
  "408":["KP","北韓"],"410":["KR","南韓"],"414":["KW","科威特"],"417":["KG","吉爾吉斯"],
  "418":["LA","寮國"],"422":["LB","黎巴嫩"],"426":["LS","賴索托"],"428":["LV","拉脫維亞"],
  "430":["LR","賴比瑞亞"],"434":["LY","利比亞"],"438":["LI","列支敦斯登"],"440":["LT","立陶宛"],
  "442":["LU","盧森堡"],"446":["MO","中國澳門"],"450":["MG","馬達加斯加"],"454":["MW","馬拉威"],
  "458":["MY","馬來西亞"],"462":["MV","馬爾地夫"],"466":["ML","馬利"],"470":["MT","馬爾他"],
  "474":["MQ","馬丁尼克"],"478":["MR","茅利塔尼亞"],"480":["MU","模里西斯"],"484":["MX","墨西哥"],
  "492":["MC","摩納哥"],"496":["MN","蒙古"],"498":["MD","摩爾多瓦"],"500":["MS","蒙特塞拉特"],
  "504":["MA","摩洛哥"],"508":["MZ","莫三比克"],"512":["OM","阿曼"],"516":["NA","奈米比亞"],
  "520":["NR","諾魯"],"524":["NP","尼泊爾"],"528":["NL","荷蘭"],"533":["AW","阿魯巴"],
  "540":["NC","新喀里多尼亞"],"548":["VU","萬那杜"],"554":["NZ","紐西蘭"],"558":["NI","尼加拉瓜"],
  "562":["NE","尼日"],"566":["NG","奈及利亞"],"570":["NU","紐埃"],"574":["NF","諾福克島"],
  "578":["NO","挪威"],"580":["MP","北馬里亞納群島"],"581":["UM","美國本土外小島嶼"],"583":["FM","密克羅尼西亞"],
  "584":["MH","馬紹爾群島"],"585":["PW","帛琉"],"586":["PK","巴基斯坦"],"591":["PA","巴拿馬"],
  "598":["PG","巴布亞新幾內亞"],"600":["PY","巴拉圭"],"604":["PE","秘魯"],"608":["PH","菲律賓"],
  "612":["PN","皮特肯群島"],"616":["PL","波蘭"],"620":["PT","葡萄牙"],"624":["GW","幾內亞比索"],
  "626":["TL","東帝汶"],"630":["PR","波多黎各"],"634":["QA","卡達"],"638":["RE","留尼旺"],
  "642":["RO","羅馬尼亞"],"643":["RU","俄羅斯"],"646":["RW","盧安達"],"652":["BL","聖巴瑟米"],
  "654":["SH","聖赫勒拿"],"659":["KN","聖克里斯多福及尼維斯"],"660":["AI","安圭拉"],
  "662":["LC","聖露西亞"],"666":["PM","聖皮耶與密克隆"],"670":["VC","聖文森及格瑞那丁"],"674":["SM","聖馬利諾"],
  "678":["ST","聖多美普林西比"],"682":["SA","沙烏地阿拉伯"],"686":["SN","塞內加爾"],
  "688":["RS","塞爾維亞"],"690":["SC","塞席爾"],"694":["SL","獅子山"],"702":["SG","新加坡"],
  "703":["SK","斯洛伐克"],"704":["VN","越南"],"706":["SO","索馬利亞"],
  "710":["ZA","南非"],"716":["ZW","辛巴威"],"724":["ES","西班牙"],"728":["SS","南蘇丹"],
  "736":["SD","蘇丹"],"740":["SR","蘇利南"],"744":["SJ","斯瓦巴和揚馬延島"],"748":["SZ","史瓦帝尼"],
  "752":["SE","瑞典"],"756":["CH","瑞士"],"760":["SY","敘利亞"],"762":["TJ","塔吉克"],
  "764":["TH","泰國"],"768":["TG","多哥"],"772":["TK","托克勞"],"776":["TO","東加"],
  "780":["TT","千里達及托巴哥"],"784":["AE","阿拉伯聯合大公國"],"788":["TN","突尼西亞"],
  "792":["TR","土耳其"],"795":["TM","土庫曼"],"796":["TC","特克斯和凱科斯群島"],"798":["TV","吐瓦魯"],
  "800":["UG","烏干達"],"804":["UA","烏克蘭"],"807":["MK","北馬其頓"],"818":["EG","埃及"],
  "826":["GB","英國"],"831":["GG","根西"],"832":["JE","澤西"],"833":["IM","曼島"],
  "834":["TZ","坦尚尼亞"],"840":["US","美國"],"850":["VI","美屬維京群島"],"854":["BF","布吉納法索"],
  "858":["UY","烏拉圭"],"860":["UZ","烏茲別克"],"862":["VE","委內瑞拉"],"876":["WF","瓦利斯和富圖納"],
  "882":["WS","薩摩亞"],"887":["YE","葉門"],"894":["ZM","尚比亞"],"983":["XK","科索沃"],
};

// zh name → alpha2 (多個別名統一)
const ZH_TO_A2 = {};
for (const [, [a2, zh]] of Object.entries(ISO_NUM)) {
  if (zh) ZH_TO_A2[zh] = a2;
}
Object.assign(ZH_TO_A2, {
  '臺灣':'TW','印度尼西亞':'ID','烏幹達':'UG','納米比亞':'NA','韓國':'KR',
  '約旦/巴勒斯坦':'JO',
});

const TIERS = [
  {
    min:0, max:0,
    title:'待啟程', sub:'世界在等著你出發',
    color:'#7A9AAF',
    svg:`<svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M28 28V20Q28 15 33 15H47Q52 15 52 20V28" stroke="#7A9AAF" stroke-width="2.5" stroke-linecap="round"/>
      <rect x="14" y="28" width="52" height="34" rx="6" stroke="#7A9AAF" stroke-width="2.5"/>
      <line x1="14" y1="43" x2="66" y2="43" stroke="#7A9AAF" stroke-width="1.5" opacity="0.4"/>
      <rect x="33" y="39" width="14" height="8" rx="2.5" stroke="#7A9AAF" stroke-width="2"/>
      <circle cx="24" cy="64" r="3" stroke="#7A9AAF" stroke-width="2"/>
      <circle cx="56" cy="64" r="3" stroke="#7A9AAF" stroke-width="2"/>
    </svg>`
  },
  {
    min:1, max:9,
    title:'地圖新鮮人', sub:'第一步，最難也最珍貴',
    color:'#F5C842',
    svg:`<svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 18 L30 12 L50 20 L70 14 L70 62 L50 68 L30 60 L10 66 Z" stroke="#F5C842" stroke-width="2" stroke-linejoin="round"/>
      <line x1="30" y1="12" x2="30" y2="60" stroke="#F5C842" stroke-width="1" opacity="0.35"/>
      <line x1="50" y1="20" x2="50" y2="68" stroke="#F5C842" stroke-width="1" opacity="0.35"/>
      <circle cx="24" cy="33" r="4" fill="#F5C842"/>
      <circle cx="56" cy="47" r="4" fill="#F5C842"/>
      <path d="M24 33 Q37 26 56 47" stroke="#F5C842" stroke-width="1.5" stroke-dasharray="4 3" fill="none"/>
    </svg>`
  },
  {
    min:10, max:24,
    title:'洲際漫遊者', sub:'已跨越第一道海岸線',
    color:'#F5C842',
    svg:`<svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="40" cy="40" r="27" stroke="#F5C842" stroke-width="2.5"/>
      <circle cx="40" cy="40" r="3.5" fill="#F5C842"/>
      <polygon points="40,14 35,40 45,40" fill="#F5C842"/>
      <polygon points="40,66 35,40 45,40" fill="#F5C842" opacity="0.3"/>
      <polygon points="14,40 40,35 40,45" fill="#F5C842" opacity="0.3"/>
      <polygon points="66,40 40,35 40,45" fill="#F5C842" opacity="0.3"/>
    </svg>`
  },
  {
    min:25, max:44,
    title:'環球探索者', sub:'地球上已有你的足跡',
    color:'#F5C842',
    svg:`<svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="40" cy="40" r="25" stroke="#F5C842" stroke-width="2.5"/>
      <ellipse cx="40" cy="40" rx="12" ry="25" stroke="#F5C842" stroke-width="1.5" opacity="0.45"/>
      <line x1="15" y1="40" x2="65" y2="40" stroke="#F5C842" stroke-width="1.5" opacity="0.45"/>
      <path d="M18 32 Q40 28 62 32" fill="none" stroke="#F5C842" stroke-width="1" opacity="0.3"/>
      <path d="M18 48 Q40 52 62 48" fill="none" stroke="#F5C842" stroke-width="1" opacity="0.3"/>
      <path d="M23 55 Q32 20 57 26" fill="none" stroke="#F5C842" stroke-width="2.5" stroke-linecap="round"/>
      <circle cx="23" cy="55" r="3.5" fill="#F5C842"/>
      <circle cx="57" cy="26" r="3.5" fill="#F5C842"/>
    </svg>`
  },
  {
    min:45, max:64,
    title:'地平線獵手', sub:'世界的一半屬於你',
    color:'#F5A840',
    svg:`<svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="22" cy="42" r="16" stroke="#F5A840" stroke-width="2.5"/>
      <circle cx="58" cy="42" r="16" stroke="#F5A840" stroke-width="2.5"/>
      <line x1="38" y1="35" x2="42" y2="35" stroke="#F5A840" stroke-width="3" stroke-linecap="round"/>
      <line x1="38" y1="49" x2="42" y2="49" stroke="#F5A840" stroke-width="3" stroke-linecap="round"/>
      <circle cx="22" cy="42" r="8" fill="#F5A840" fill-opacity="0.1" stroke="#F5A840" stroke-width="1.5" opacity="0.5"/>
      <circle cx="58" cy="42" r="8" fill="#F5A840" fill-opacity="0.1" stroke="#F5A840" stroke-width="1.5" opacity="0.5"/>
    </svg>`
  },
  {
    min:65, max:84,
    title:'傳奇旅行者', sub:'地圖上幾乎找不到空白',
    color:'#F5A030',
    svg:`<svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 62 L18 34 L28 52 L40 22 L52 52 L62 34 L70 62 Z" stroke="#F5A030" stroke-width="2.5" stroke-linejoin="round" fill="#F5A030" fill-opacity="0.09"/>
      <line x1="10" y1="67" x2="70" y2="67" stroke="#F5A030" stroke-width="3" stroke-linecap="round"/>
      <circle cx="40" cy="22" r="4.5" fill="#F5A030"/>
      <circle cx="18" cy="34" r="3" fill="#F5A030"/>
      <circle cx="62" cy="34" r="3" fill="#F5A030"/>
      <line x1="40" y1="14" x2="40" y2="17" stroke="#F5A030" stroke-width="2" stroke-linecap="round" opacity="0.75"/>
      <line x1="35" y1="16" x2="37" y2="18" stroke="#F5A030" stroke-width="1.5" stroke-linecap="round" opacity="0.6"/>
      <line x1="45" y1="16" x2="43" y2="18" stroke="#F5A030" stroke-width="1.5" stroke-linecap="round" opacity="0.6"/>
    </svg>`
  },
  {
    min:85, max:99,
    title:'地球守護者', sub:'你見過幾乎所有角落',
    color:'#EE8822',
    svg:`<svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="40" cy="44" r="20" stroke="#EE8822" stroke-width="2.5"/>
      <ellipse cx="40" cy="44" rx="10" ry="20" stroke="#EE8822" stroke-width="1.5" opacity="0.45"/>
      <line x1="20" y1="44" x2="60" y2="44" stroke="#EE8822" stroke-width="1.5" opacity="0.45"/>
      <ellipse cx="40" cy="40" rx="34" ry="12" stroke="#EE8822" stroke-width="1.5" stroke-dasharray="5 3" opacity="0.5" transform="rotate(-20 40 40)"/>
      <circle cx="10" cy="28" r="3" fill="#EE8822"/>
      <circle cx="70" cy="34" r="2.5" fill="#EE8822" opacity="0.85"/>
      <circle cx="50" cy="11" r="2" fill="#EE8822" opacity="0.75"/>
    </svg>`
  },
  {
    min:100, max:100,
    title:'地球解鎖者', sub:'恭喜！你完全解鎖了地球',
    color:'#FFD700',
    svg:`<svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="18" y="38" width="44" height="30" rx="6" stroke="#FFD700" stroke-width="2.5" fill="#FFD700" fill-opacity="0.07"/>
      <path d="M29 38 V28 Q29 14 40 14 Q51 14 51 28 V22" stroke="#FFD700" stroke-width="2.5" stroke-linecap="round" fill="none"/>
      <circle cx="40" cy="55" r="5" stroke="#FFD700" stroke-width="2" fill="#FFD700" fill-opacity="0.2"/>
      <line x1="40" y1="60" x2="40" y2="65" stroke="#FFD700" stroke-width="2.5" stroke-linecap="round"/>
      <circle cx="62" cy="18" r="2.5" fill="#FFD700" opacity="0.9"/>
      <circle cx="70" cy="30" r="1.5" fill="#FFD700" opacity="0.7"/>
      <circle cx="67" cy="10" r="1.5" fill="#FFD700" opacity="0.65"/>
    </svg>`
  },
];

function getTier(pct) {
  return TIERS.find(t => pct >= t.min && pct <= t.max) || TIERS[1];
}

let visitedMode = false;
let visitedCountries = new Set(JSON.parse(localStorage.getItem('ute-visited') || '[]'));
let countriesLayer = null;
let countriesGeoCache = null;

function saveVisited() {
  localStorage.setItem('ute-visited', JSON.stringify([...visitedCountries]));
}

function loadVisitedFromUrl() {
  const v = new URLSearchParams(location.search).get('visited');
  if (v) {
    visitedCountries = new Set(v.split(',').filter(Boolean));
    saveVisited();
  }
}

// Normalize ring coordinates so no two adjacent points jump >180° in longitude.
// This fixes Leaflet's antimeridian rendering bug (Russia, Fiji, etc. appearing as bands).
function fixRing(ring) {
  if (!ring.length) return ring;
  const out = [[...ring[0]]];
  for (let i = 1; i < ring.length; i++) {
    const prev = out[i - 1];
    const cur = [...ring[i]];
    while (cur[0] - prev[0] > 180) cur[0] -= 360;
    while (cur[0] - prev[0] < -180) cur[0] += 360;
    out.push(cur);
  }
  return out;
}
function fixAntimeridian(geojson) {
  for (const f of geojson.features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'Polygon') {
      g.coordinates = g.coordinates.map(fixRing);
    } else if (g.type === 'MultiPolygon') {
      g.coordinates = g.coordinates.map(poly => poly.map(fixRing));
    }
  }
  return geojson;
}

async function loadCountriesGeo() {
  if (countriesGeoCache) return countriesGeoCache;
  const topo = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json').then(r => r.json());
  countriesGeoCache = fixAntimeridian(topojson.feature(topo, topo.objects.countries));
  return countriesGeoCache;
}

function countryStyleNormal(feature) {
  const a2 = getA2(feature.id);
  const visited = a2 && visitedCountries.has(a2);
  return visited
    ? { fillColor:'#F5C842', fillOpacity:0.38, color:'#F5C842', weight:1.5, opacity:0.9 }
    : { fillColor:'transparent', fillOpacity:0, color:'rgba(255,255,255,0.18)', weight:0.5, opacity:1 };
}
function countryStyleHover(feature) {
  const a2 = getA2(feature.id);
  const visited = a2 && visitedCountries.has(a2);
  return visited
    ? { fillColor:'#F5C842', fillOpacity:0.55, color:'#F5C842', weight:2, opacity:1 }
    : { fillColor:'rgba(245,200,66,0.12)', fillOpacity:1, color:'rgba(245,200,66,0.4)', weight:1, opacity:1 };
}
function getA2(numericId) {
  const key = String(numericId).padStart(3, '0');
  return ISO_NUM[key] ? ISO_NUM[key][0] : null;
}
function getZh(numericId) {
  const key = String(numericId).padStart(3, '0');
  return ISO_NUM[key] ? (ISO_NUM[key][1] || ISO_NUM[key][0]) : '';
}

async function enterVisitedMode() {
  if (visitedMode) return;
  visitedMode = true;
  document.body.classList.add('visited-mode');
  document.getElementById('visited-btn').classList.add('active');
  map.removeLayer(clusterGroup);

  const geo = await loadCountriesGeo();
  countriesLayer = L.geoJSON(geo, {
    style: countryStyleNormal,
    onEachFeature: (feature, layer) => {
      layer.on({
        mouseover(e) {
          e.target.setStyle(countryStyleHover(feature));
          const name = getZh(feature.id);
          if (name) showCountryTooltip(name, e.originalEvent.clientX, e.originalEvent.clientY);
        },
        mouseout(e) {
          e.target.setStyle(countryStyleNormal(feature));
          hideCountryTooltip();
        },
        click(e) {
          L.DomEvent.stopPropagation(e);
          const a2 = getA2(feature.id);
          if (!a2) return;
          visitedCountries.has(a2) ? visitedCountries.delete(a2) : visitedCountries.add(a2);
          e.target.setStyle(countryStyleNormal(feature));
          saveVisited();
          renderVisitedPanel();
        },
      });
    },
  }).addTo(map);

  openPanel();
  renderVisitedPanel();
}

function exitVisitedMode() {
  if (!visitedMode) return;
  visitedMode = false;
  document.body.classList.remove('visited-mode');
  document.getElementById('visited-btn').classList.remove('active');
  hideVisitedOverlay();
  if (countriesLayer) { map.removeLayer(countriesLayer); countriesLayer = null; }
  map.addLayer(clusterGroup);
  document.querySelector('.panel-title-row h2').textContent = '集數列表';
  renderEpisodeList(getFilteredMainEps());
}

function getVisitedDetails() {
  return [...visitedCountries].map(a2 => {
    let zh = null;
    for (const [, [code, name]] of Object.entries(ISO_NUM)) {
      if (code === a2 && name) { zh = name; break; }
    }
    const zhAliases = Object.entries(ZH_TO_A2).filter(([,c]) => c === a2).map(([z]) => z);
    const lms = allLandmarks.filter(lm => zhAliases.includes(lm.country));
    const eps = new Set(lms.flatMap(lm => (lm.appearances||[]).map(a => a.ep)));
    return { a2, zh: zh||a2, epCount: eps.size, lmCount: lms.length };
  }).sort((a,b) => b.epCount - a.epCount || a.zh.localeCompare(b.zh));
}

function getFlagEmoji(a2) {
  if (!a2 || a2.length !== 2) return '🏳️';
  return String.fromCodePoint(...[...a2.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

function flyToCountryA2(a2) {
  const aliases = Object.entries(ZH_TO_A2).filter(([,c]) => c === a2).map(([z]) => z);
  const lms = allLandmarks.filter(lm => aliases.includes(lm.country));
  if (!lms.length) return;
  if (lms.length === 1) {
    map.flyTo([lms[0].lat, lms[0].lon], 6, { duration: 1.2 });
  } else {
    map.flyToBounds(L.latLngBounds(lms.map(lm => [lm.lat, lm.lon])).pad(0.3), { duration: 1.3, maxZoom: 7 });
  }
}

function renderVisitedPanel() {
  const count = visitedCountries.size;
  const pct = Math.round(count / 195 * 100);
  document.querySelector('.panel-title-row h2').textContent = '我的足跡';

  const countries = getVisitedDetails();
  document.getElementById('episode-list').innerHTML = `
    <div class="visited-panel-top">
      <div class="visited-pct-row">
        <span class="visited-pct-num">${pct}%</span>
        <span class="visited-pct-sub">解鎖地球</span>
      </div>
      <div class="visited-progress-track">
        <div class="visited-progress-fill" style="width:${pct}%"></div>
      </div>
      <div class="visited-count-line">${count} / 195 個國家</div>
      ${count > 0 ? `<button class="btn-show-result" onclick="showVisitedOverlay()">查看結果 &amp; 分享 →</button>` : ''}
    </div>
    <div class="visited-hint">點擊地圖上的國家來標記足跡</div>
    ${countries.length ? `
      <div class="ep-section-label">去過的地方</div>
      ${countries.map(c => `
        <div class="visited-country-card" onclick="flyToCountryA2('${c.a2}')">
          <span class="visited-flag">${getFlagEmoji(c.a2)}</span>
          <div class="visited-country-info">
            <div class="visited-country-name">${c.zh}</div>
            <div class="visited-country-eps">${c.epCount > 0 ? `${c.epCount} 集 · ${c.lmCount} 個地標` : '尚無節目'}</div>
          </div>
        </div>
      `).join('')}
    ` : ''}
  `;
}

function showVisitedOverlay() {
  const count = visitedCountries.size;
  const pct = Math.round(count / 195 * 100);
  const tier = getTier(pct);

  document.getElementById('visited-tier-illu').innerHTML = tier.svg;
  document.getElementById('visited-tier-title').textContent = tier.title;
  document.getElementById('visited-tier-title').style.color = tier.color;
  document.getElementById('visited-tier-sub').textContent = tier.sub;
  document.getElementById('visited-pct-text').textContent = pct + '%';
  document.getElementById('visited-pct-text').style.color = tier.color;
  document.getElementById('visited-stats-row').textContent = `你去過 ${count} 個國家 / 195 個`;
  const countries = getVisitedDetails();
  document.getElementById('visited-chips').innerHTML = countries.map(c =>
    `<span class="visited-chip${c.epCount ? ' has-ep' : ''}">${getFlagEmoji(c.a2)} ${c.zh}</span>`
  ).join('');
  document.getElementById('visited-overlay').classList.add('open');
}

function hideVisitedOverlay() {
  document.getElementById('visited-overlay')?.classList.remove('open');
}

function copyVisitedShareUrl() {
  const codes = [...visitedCountries].sort().join(',');
  const url = new URL(location.href);
  if (codes) url.searchParams.set('visited', codes);
  else url.searchParams.delete('visited');
  function showCopyToast() {
    const t = document.getElementById('copy-toast');
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
  }
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(url.toString()).then(showCopyToast).catch(() => fallbackCopy(url.toString(), showCopyToast));
  } else {
    fallbackCopy(url.toString(), showCopyToast);
  }
}
function fallbackCopy(text, onSuccess) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); onSuccess(); } catch(e) {}
  document.body.removeChild(ta);
}

function showCountryTooltip(name, x, y) {
  const tip = document.getElementById('country-tooltip');
  if (!tip) return;
  tip.textContent = name;
  tip.style.cssText = `display:block;left:${x+14}px;top:${y-36}px`;
}
function hideCountryTooltip() {
  const tip = document.getElementById('country-tooltip');
  if (tip) tip.style.display = 'none';
}

// ── Bootstrap ──────────────────────────────────────────
init();
