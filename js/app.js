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
    const _v = '?v=16';
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
      <p class="ep-popup-title" style="font-weight:700;font-size:14px;margin-bottom:4px">${escHtml(lm.name_en || lm.name)}</p>
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
  timelinePlaying = true;
  const btn = document.getElementById('tl-play-btn');
  if (btn) btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;

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
  openPanel();
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
  "004":["AF","阿富汗"],"008":["AL",null],"010":["AQ","南極洲"],"012":["DZ","阿爾及利亞"],
  "016":["AS",null],"020":["AD",null],"024":["AO","安哥拉"],"028":["AG",null],
  "031":["AZ","亞塞拜然"],"032":["AR","阿根廷"],"036":["AU","澳洲"],"040":["AT","奧地利"],
  "044":["BS",null],"048":["BH",null],"050":["BD",null],"051":["AM","亞美尼亞"],
  "052":["BB",null],"056":["BE",null],"060":["BM",null],"064":["BT",null],
  "068":["BO","玻利維亞"],"070":["BA","波士尼亞與赫塞哥維納"],"072":["BW",null],
  "076":["BR","巴西"],"084":["BZ","貝里斯"],"086":["IO",null],"090":["SB",null],
  "092":["VG",null],"096":["BN",null],"100":["BG","保加利亞"],"104":["MM","緬甸"],
  "108":["BI",null],"112":["BY",null],"116":["KH","柬埔寨"],"120":["CM",null],
  "124":["CA","加拿大"],"132":["CV",null],"136":["KY",null],"140":["CF",null],
  "144":["LK",null],"148":["TD","查德"],"152":["CL","智利"],"156":["CN","中國"],
  "158":["TW","台灣"],"162":["CX",null],"166":["CC",null],"170":["CO","哥倫比亞"],
  "174":["KM",null],"175":["YT",null],"178":["CG",null],"180":["CD","剛果民主共和國"],
  "184":["CK",null],"188":["CR","哥斯大黎加"],"191":["HR","克羅埃西亞"],
  "192":["CU","古巴"],"196":["CY","賽普勒斯"],"203":["CZ","捷克"],
  "204":["BJ",null],"208":["DK","丹麥"],"212":["DM",null],"214":["DO",null],
  "218":["EC","厄瓜多"],"222":["SV",null],"226":["GQ",null],"231":["ET","衣索比亞"],
  "232":["ER",null],"233":["EE","愛沙尼亞"],"234":["FO",null],"238":["FK",null],
  "239":["GS","南喬治亞與南桑威奇群島"],"242":["FJ",null],"246":["FI","芬蘭"],
  "248":["AX",null],"250":["FR","法國"],"258":["PF",null],"260":["TF",null],
  "262":["DJ",null],"266":["GA",null],"268":["GE","喬治亞"],"270":["GM",null],
  "275":["PS","巴勒斯坦"],"276":["DE","德國"],"288":["GH",null],"292":["GI",null],
  "296":["KI",null],"300":["GR","希臘"],"304":["GL","格陵蘭"],"308":["GD",null],
  "312":["GP",null],"316":["GU",null],"320":["GT","瓜地馬拉"],"324":["GN",null],
  "328":["GY",null],"332":["HT",null],"334":["HM",null],"340":["HN",null],
  "344":["HK","中國香港"],"348":["HU","匈牙利"],"352":["IS","冰島"],"356":["IN","印度"],
  "360":["ID","印尼"],"364":["IR","伊朗"],"368":["IQ","伊拉克"],"372":["IE","愛爾蘭"],
  "376":["IL","以色列"],"380":["IT","義大利"],"384":["CI",null],"388":["JM","牙買加"],
  "392":["JP","日本"],"398":["KZ","哈薩克"],"400":["JO","約旦"],"404":["KE","肯亞"],
  "408":["KP","北韓"],"410":["KR","南韓"],"414":["KW","科威特"],"417":["KG","吉爾吉斯"],
  "418":["LA","寮國"],"422":["LB",null],"426":["LS",null],"428":["LV","拉脫維亞"],
  "430":["LR",null],"434":["LY","利比亞"],"438":["LI",null],"440":["LT","立陶宛"],
  "442":["LU",null],"446":["MO",null],"450":["MG","馬達加斯加"],"454":["MW","馬拉威"],
  "458":["MY","馬來西亞"],"462":["MV",null],"466":["ML",null],"470":["MT",null],
  "474":["MQ",null],"478":["MR",null],"480":["MU","模里西斯"],"484":["MX","墨西哥"],
  "492":["MC",null],"496":["MN",null],"498":["MD",null],"500":["MS",null],
  "504":["MA","摩洛哥"],"508":["MZ",null],"512":["OM","阿曼"],"516":["NA","奈米比亞"],
  "520":["NR","諾魯"],"524":["NP","尼泊爾"],"528":["NL","荷蘭"],"533":["AW",null],
  "540":["NC",null],"548":["VU",null],"554":["NZ","紐西蘭"],"558":["NI",null],
  "562":["NE",null],"566":["NG",null],"570":["NU",null],"574":["NF",null],
  "578":["NO","挪威"],"580":["MP",null],"581":["UM",null],"583":["FM",null],
  "584":["MH",null],"585":["PW","帛琉"],"586":["PK","巴基斯坦"],"591":["PA","巴拿馬"],
  "598":["PG",null],"600":["PY","巴拉圭"],"604":["PE","秘魯"],"608":["PH","菲律賓"],
  "612":["PN",null],"616":["PL","波蘭"],"620":["PT","葡萄牙"],"624":["GW",null],
  "626":["TL",null],"630":["PR",null],"634":["QA",null],"638":["RE",null],
  "642":["RO",null],"643":["RU","俄羅斯"],"646":["RW","盧安達"],"652":["BL",null],
  "654":["SH",null],"659":["KN","聖克里斯多福及尼維斯"],"660":["AI",null],
  "662":["LC",null],"666":["PM",null],"670":["VC",null],"674":["SM",null],
  "678":["ST",null],"682":["SA","沙烏地阿拉伯"],"686":["SN","塞內加爾"],
  "688":["RS","塞爾維亞"],"690":["SC",null],"694":["SL",null],"702":["SG","新加坡"],
  "703":["SK","斯洛伐克"],"704":["VN","越南"],"706":["SO","索馬利亞"],
  "710":["ZA","南非"],"716":["ZW","辛巴威"],"724":["ES","西班牙"],"728":["SS",null],
  "736":["SD",null],"740":["SR",null],"744":["SJ",null],"748":["SZ","史瓦帝尼"],
  "752":["SE","瑞典"],"756":["CH",null],"760":["SY","敘利亞"],"762":["TJ","塔吉克"],
  "764":["TH","泰國"],"768":["TG",null],"772":["TK",null],"776":["TO",null],
  "780":["TT",null],"784":["AE","阿拉伯聯合大公國"],"788":["TN","突尼西亞"],
  "792":["TR","土耳其"],"795":["TM","土庫曼"],"796":["TC",null],"798":["TV","吐瓦魯"],
  "800":["UG","烏干達"],"804":["UA",null],"807":["MK",null],"818":["EG","埃及"],
  "826":["GB","英國"],"831":["GG",null],"832":["JE",null],"833":["IM",null],
  "834":["TZ","坦尚尼亞"],"840":["US","美國"],"850":["VI",null],"854":["BF",null],
  "858":["UY",null],"860":["UZ","烏茲別克"],"862":["VE",null],"876":["WF",null],
  "882":["WS",null],"887":["YE","葉門"],"894":["ZM",null],"983":["XK","科索沃"],
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

async function loadCountriesGeo() {
  if (countriesGeoCache) return countriesGeoCache;
  const topo = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json').then(r => r.json());
  countriesGeoCache = topojson.feature(topo, topo.objects.countries);
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
  document.querySelector('.panel-title-row h2').textContent = '集數列表';
  renderEpisodeList(allEpisodes.filter(e => e.type === 'main'));
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
  document.getElementById('visited-pct-text').textContent = pct + '%';
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
  navigator.clipboard.writeText(url.toString()).then(() => {
    const t = document.getElementById('copy-toast');
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
  });
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
