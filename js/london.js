'use strict';

const CRAIG_EPS = [22,23,77,82,108,109,149,150,184,223,225,226,265,266];
const TILES = {
  dark:  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  light: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
};
let tileLayer = null;
let currentTheme = localStorage.getItem('london-theme') || 'light';
let map, landmarks = [], episodes = [];
let markers = {};       // landmark index → leaflet marker
let activeMarkerIdx = null;
let currentTab = 'landmarks';
let activeEpFilter = null;  // null = 全部

// ── Init ────────────────────────────────────────────────
async function init() {
  initMap();
  try {
    const [lmData, epData] = await Promise.all([
      fetch('data/london_landmarks.json').then(r => r.json()),
      fetch('data/episodes.json').then(r => r.json()),
    ]);
    landmarks = lmData;
    episodes = epData.filter(e => e.episode && CRAIG_EPS.includes(e.episode));
    episodes.sort((a, b) => b.episode - a.episode);
  } catch(e) {
    console.error('Failed to load data:', e);
    return;
  }

  document.getElementById('stat-lm').textContent = `${landmarks.length} 個地標`;
  document.getElementById('stat-eps').textContent = `${episodes.length} 集`;

  plotLandmarks();
  renderEpFilter();
  renderLandmarkList();
  renderEpisodeList();
  bindEvents();
}

// ── Map ─────────────────────────────────────────────────
function initMap() {
  map = L.map('map', {
    center: [51.505, -0.09],
    zoom: 13,
    minZoom: 10,
    maxZoom: 18,
    zoomControl: false,
    attributionControl: false,
    worldCopyJump: false,
    maxBounds: [[51.1, -0.75], [51.85, 0.45]],
    maxBoundsViscosity: 0.6,
  });

  if (currentTheme === 'light') document.body.classList.add('light');
  updateThemeIcons();
  tileLayer = L.tileLayer(TILES[currentTheme], { maxZoom: 18 }).addTo(map);

  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.control.attribution({ position: 'bottomleft', prefix: false })
    .addAttribution('© <a href="https://carto.com">CARTO</a> · © <a href="https://www.openstreetmap.org/copyright">OSM</a>')
    .addTo(map);
}

// ── Markers ─────────────────────────────────────────────
function plotLandmarks() {
  landmarks.forEach((lm, idx) => {
    const num = idx + 1;
    const icon = L.divIcon({
      html: `<div class="lm-marker" id="lm-dot-${idx}">
               <span class="lm-num">${num}</span>
             </div>`,
      className: '',
      iconSize: [28, 28],
      iconAnchor: [14, 28],
      popupAnchor: [0, -30],
    });

    const marker = L.marker([lm.lat, lm.lon], { icon });
    marker.bindPopup(buildPopup(lm, num), { maxWidth: 360, minWidth: 320 });
    marker.on('popupopen', () => activateMarker(idx));
    marker.on('popupclose', () => deactivateMarker(idx));
    marker.addTo(map);
    markers[idx] = marker;
  });
}

function activateMarker(idx) {
  const dot = document.getElementById(`lm-dot-${idx}`);
  if (dot) dot.classList.add('active-marker');
  // highlight card
  document.querySelectorAll('.lm-card').forEach(c => c.classList.remove('active'));
  const card = document.querySelector(`.lm-card[data-idx="${idx}"]`);
  if (card) {
    card.classList.add('active');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  activeMarkerIdx = idx;
}

function deactivateMarker(idx) {
  const dot = document.getElementById(`lm-dot-${idx}`);
  if (dot) dot.classList.remove('active-marker');
  document.querySelectorAll('.lm-card').forEach(c => c.classList.remove('active'));
  activeMarkerIdx = null;
}

// ── Popup ────────────────────────────────────────────────
function buildPopup(lm, num) {
  const appearances = lm.appearances || [];

  // Transcript quotes (most informative)
  const transcriptApps = appearances.filter(a => a.source === 'transcript');
  const topicApps = appearances.filter(a => a.source === 'topic');

  let quotesHtml = '';
  if (transcriptApps.length > 0) {
    quotesHtml = transcriptApps.map(a => {
      const ep = episodes.find(e => e.episode === a.ep);
      const link = ep?.link || '#';
      const quote = a.quote || '';
      const context = a.context || '';
      const same = quote && context && quote.trim() === context.trim();
      return `
        <div class="lm-quote-block">
          <div class="lm-appearance-meta">
            <a href="${link}" target="_blank" rel="noopener" class="lm-ep-pill">Ep.${a.ep}</a>
            ${ep?.title ? `<span class="lm-ep-title-text">${escHtml(ep.title)}</span>` : ''}
          </div>
          ${context && !quote ? `<div class="lm-context">${escHtml(context)}</div>` : ''}
          ${quote ? `<blockquote class="lm-quote">${escHtml(quote)}</blockquote>` : ''}
          ${context && quote && !same ? `<div class="lm-context">${escHtml(context)}</div>` : ''}
        </div>`;
    }).join('');
  } else if (topicApps.length > 0) {
    const epItems = topicApps.map(a => {
      const ep = episodes.find(e => e.episode === a.ep);
      const link = ep?.link || '#';
      return `
        <div class="lm-appearance-meta" style="margin-bottom:5px">
          <a href="${link}" target="_blank" rel="noopener" class="lm-ep-pill">Ep.${a.ep}</a>
          ${ep?.title ? `<span class="lm-ep-title-text">${escHtml(ep.title)}</span>` : ''}
        </div>`;
    }).join('');
    quotesHtml = `
      <div class="lm-reason">${escHtml(topicApps[0]?.context || '')}</div>
      ${epItems}`;
  }

  const hasTranscript = transcriptApps.length > 0;
  const badge = hasTranscript
    ? '<span class="source-badge transcript">逐字稿</span>'
    : '<span class="source-badge topic">主題關聯</span>';

  const mapsUrl = `https://maps.google.com/?q=${lm.lat},${lm.lon}`;
  return `
    <div class="lm-popup">
      <div class="lm-popup-header">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
          <span style="background:#cc2936;color:#fff;font-size:11px;font-weight:700;padding:2px 7px;border-radius:4px">#${num}</span>
          ${badge}
        </div>
        <div class="lm-name">${escHtml(lm.landmark)}</div>
        <div class="lm-name-en">${escHtml(lm.landmark_en)}</div>
      </div>
      ${quotesHtml}
      <a href="${mapsUrl}" target="_blank" rel="noopener" class="popup-maps-link">📍 在 Google Maps 開啟</a>
    </div>`;
}

// ── Episode Filter ────────────────────────────────────────
function renderEpFilter() {
  const container = document.getElementById('ep-filter');
  const epNums = [...new Set(
    landmarks.flatMap(lm => (lm.appearances || []).map(a => a.ep))
  )].sort((a, b) => a - b);

  container.innerHTML = [
    `<button class="ep-filter-pill active" data-ep="">全部</button>`,
    ...epNums.map(n => `<button class="ep-filter-pill" data-ep="${n}">Ep.${n}</button>`)
  ].join('');

  container.querySelectorAll('.ep-filter-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.ep-filter-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeEpFilter = btn.dataset.ep ? Number(btn.dataset.ep) : null;
      applyEpFilter();
    });
  });
}

function applyEpFilter() {
  renderLandmarkList();
  Object.entries(markers).forEach(([idx, marker]) => {
    const lm = landmarks[Number(idx)];
    const inFilter = !activeEpFilter || (lm.appearances || []).some(a => a.ep === activeEpFilter);
    const el = document.getElementById(`lm-dot-${idx}`);
    if (el) el.style.opacity = inFilter ? '' : '0.25';
  });
}

// ── Landmark List ─────────────────────────────────────────
function renderLandmarkList() {
  const container = document.getElementById('panel-landmarks');
  const filtered = activeEpFilter
    ? landmarks.filter(lm => (lm.appearances || []).some(a => a.ep === activeEpFilter))
    : landmarks;

  container.innerHTML = filtered.map((lm) => {
    const idx = landmarks.indexOf(lm);
    const num = idx + 1;
    const appearances = lm.appearances || [];
    const epNums = [...new Set(appearances.map(a => a.ep))].sort((a, b) => a - b);
    const epTags = epNums.map(n => `<span class="lm-card-ep">Ep.${n}</span>`).join('');
    const hasTranscript = appearances.some(a => a.source === 'transcript');
    const firstContext = appearances[0]?.context || '';
    return `
      <div class="lm-card" data-idx="${idx}">
        <div class="lm-num-badge">${num}</div>
        <div class="lm-card-info">
          <div class="lm-card-en">${escHtml(lm.landmark_en)}${hasTranscript ? ' <span style="color:#e87c85;font-size:9px">● 逐字稿</span>' : ''}</div>
          <div class="lm-card-name">${escHtml(lm.landmark)}</div>
          <div class="lm-card-reason">${escHtml(firstContext)}</div>
          <div class="lm-card-eps">${epTags}</div>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.lm-card').forEach(card => {
    card.addEventListener('click', () => {
      const idx = Number(card.dataset.idx);
      const lm = landmarks[idx];
      closePanel();
      map.flyTo([lm.lat, lm.lon], 15, { duration: 1.0 });
      setTimeout(() => markers[idx]?.openPopup(), 1100);
    });
  });
}

// ── Episode List ──────────────────────────────────────────
function renderEpisodeList() {
  const PODCAST_COVER = 'https://d3mww1g1pfq2pt.cloudfront.net/Avatar/cjzryn64q34i607580oyblh1u/1616036848631.jpg';
  const container = document.getElementById('panel-episodes');
  container.innerHTML = episodes.map(ep => {
    const img = ep.image || PODCAST_COVER;
    const date = ep.pubDate ? ep.pubDate.slice(0, 7) : '';
    // Find landmarks for this episode
    const epLMs = landmarks.filter(lm => (lm.appearances||[]).some(a => a.ep === ep.episode));
    const lmTags = epLMs.map(lm => `<span class="lm-card-ep">${escHtml(lm.landmark)}</span>`).join('');
    return `
      <div class="ep-card" data-ep="${ep.episode}">
        <img class="ep-card-thumb" src="${img}" alt="" loading="lazy">
        <div class="ep-card-info">
          <div class="ep-card-top">
            <span class="ep-num">Ep.${ep.episode}</span>
            <span class="ep-card-dest" style="color:#cc2936">🇬🇧 倫敦</span>
          </div>
          <div class="ep-card-title">${escHtml(ep.title)}</div>
          ${date ? `<div class="ep-card-date">${date}</div>` : ''}
          ${lmTags ? `<div class="lm-card-eps" style="margin-top:4px">${lmTags}</div>` : ''}
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.ep-card').forEach(card => {
    card.addEventListener('click', () => {
      const epNum = Number(card.dataset.ep);
      const ep = episodes.find(e => e.episode === epNum);
      if (ep?.link) window.open(ep.link, '_blank');
    });
  });
}

// ── Events ───────────────────────────────────────────────
function bindEvents() {
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
  document.getElementById('toggle-panel').addEventListener('click', openPanel);
  document.getElementById('close-panel').addEventListener('click', closePanel);
  document.getElementById('overlay').addEventListener('click', closePanel);

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentTab = tab.dataset.tab;
      document.getElementById('panel-landmarks').style.display = currentTab === 'landmarks' ? '' : 'none';
      document.getElementById('panel-episodes').style.display = currentTab === 'episodes' ? '' : 'none';
    });
  });
}

function updateThemeIcons() {
  const isDark = currentTheme === 'dark';
  document.getElementById('icon-moon').style.display = isDark ? '' : 'none';
  document.getElementById('icon-sun').style.display  = isDark ? 'none' : '';
}

function toggleTheme() {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.body.classList.toggle('light', currentTheme === 'light');
  localStorage.setItem('london-theme', currentTheme);
  updateThemeIcons();
  if (tileLayer) {
    map.removeLayer(tileLayer);
    tileLayer = L.tileLayer(TILES[currentTheme], { maxZoom: 18 }).addTo(map);
    tileLayer.bringToBack();
  }
}

function openPanel() {
  document.getElementById('panel').classList.add('open');
  document.getElementById('overlay').classList.add('show');
}
function closePanel() {
  document.getElementById('panel').classList.remove('open');
  document.getElementById('overlay').classList.remove('show');
}
function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

init();
