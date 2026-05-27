// ── STADIUM MAP ────────────────────────────────────────────────────────────────
// Renders the interactive SVG map, venue switcher, area list, and unassigned list.

import { state }             from './state.js';
import { getVenues }         from './dataService.js';
import { showToast }         from './toast.js';
import { openModal }         from './modal.js';

// ── MAP IMAGE ERROR HANDLER ───────────────────────────────────────────────────
// Attaches onerror / onload to the base map <img>. Called both on venue switch
// and on initial render so the MetLife image (src set in HTML) is also covered.
function _attachImgHandlers(mapImg, imageUrl) {
  mapImg.onerror = () => {
    mapImg.onerror          = null;          // prevent infinite retry loops
    mapImg.style.visibility = 'hidden';
    mapImg.style.minHeight  = '240px';
    const wrapper = mapImg.parentElement;
    if (!wrapper) return;
    wrapper.querySelector('.map-ph')?.remove();
    const ph = document.createElement('div');
    ph.className   = 'map-ph';
    ph.style.cssText = [
      'position:absolute;inset:0;z-index:1;pointer-events:none;',
      'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;',
      'background:var(--surface);border-radius:8px;',
      'color:var(--text-muted);font-family:var(--mono);font-size:12px;',
    ].join('');
    ph.innerHTML = [
      '<div style="font-size:40px;opacity:.2">🗺</div>',
      '<div style="font-weight:700;color:var(--text-sub)">Map image not found</div>',
      `<div style="font-size:10px;opacity:.5">${imageUrl}</div>`,
    ].join('');
    wrapper.appendChild(ph);
  };
  mapImg.onload = () => {
    mapImg.style.visibility = '';
    mapImg.style.minHeight  = '';
    mapImg.parentElement?.querySelector('.map-ph')?.remove();
  };
}

// ── ADMIN MAPPER (Phase 1 — Lincoln %) ───────────────────────────────────────
// Developer calibration tool. When the active venue is 'lincoln', clicking
// anywhere on the map image logs, toasts, and copies the click position as
// percentages relative to the image's rendered size.
// Usage: switch to Lincoln, open DevTools console, click each zone center.
// Copy the logged { x, y } pairs into VENUE_CONFIG.lincoln.pins.
// ─────────────────────────────────────────────────────────────────────────────
let _mapperAttached = false;

function _initAdminMapper() {
  if (_mapperAttached) return;
  const mapImg = document.getElementById('map-base-img');
  if (!mapImg) return;
  const wrapper = mapImg.parentElement;
  if (!wrapper) return;

  wrapper.addEventListener('click', e => {
    // Only active for lincoln during the calibration phase
    if (state.currentVenue !== 'lincoln') return;

    // getBoundingClientRect gives accurate coords regardless of zoom / scroll /
    // CSS transform, and survives window resizes — more reliable than offsetX.
    const rect = mapImg.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width  * 100).toFixed(2);
    const yPct = ((e.clientY - rect.top)  / rect.height * 100).toFixed(2);

    const display  = `x: ${xPct}%,  y: ${yPct}%`;
    const clipText = `{ x: ${xPct}, y: ${yPct} }`;

    // 1. Console — full context row for DevTools
    console.log(`[MAP ADMIN] 📍 ${display}`);

    // 2. Toast — instant visual confirmation on-screen
    showToast(`📍 ${display}`);

    // 3. Clipboard — paste straight into VENUE_CONFIG
    navigator.clipboard?.writeText(clipText)
      .then(()  => console.log(`[MAP ADMIN] ✅ Copied → ${clipText}`))
      .catch(err => console.warn('[MAP ADMIN] ⚠️ Clipboard write failed:', err));
  });

  _mapperAttached = true;
  console.log('[MAP ADMIN] ✅ Admin Mapper active — click the Lincoln map to capture % coords.');
}

// ── VENUE CONFIGURATION ───────────────────────────────────────────────────────
// Single source of truth for each venue's seating chart image, SVG pin
// coordinates, and Areas & Units list.
//
// imageUrl is passed directly to <img>.src — the browser resolves the format
// from the HTTP Content-Type header, not the file extension. Any format works
// (.jpg, .png, .webp, Cloudinary URL, etc.). To swap or reformat a stadium
// image: update only the imageUrl string for that venue — nothing else changes.
const VENUE_CONFIG = {
  metlife: {
    imageUrl: '/assets/maps/metlife.png',
    pins: {
      '100-north': { x:525, y:193, label:'100s North' },
      '100-south': { x:525, y:423, label:'100s South' },
      '100-east':  { x:645, y:308, label:'100s East'  },
      '100-west':  { x:405, y:308, label:'100s West'  },
      '200-north': { x:525, y:145, label:'200s North' },
      '200-south': { x:525, y:471, label:'200s South' },
      '200-east':  { x:695, y:308, label:'200s East'  },
      '200-west':  { x:355, y:308, label:'200s West'  },
      '300-north': { x:525, y:92,  label:'300s North' },
      '300-south': { x:525, y:524, label:'300s South' },
      '300-east':  { x:748, y:308, label:'300s East'  },
      '300-west':  { x:302, y:308, label:'300s West'  },
    },
    areas: [
      { id:'100-north', label:'100s North', sub:'Lower Bowl — North End',  color:'#3b82f6', slots:10 },
      { id:'100-south', label:'100s South', sub:'Lower Bowl — South End',  color:'#3b82f6', slots:10 },
      { id:'100-east',  label:'100s East',  sub:'Lower Bowl — East Side',  color:'#8b5cf6', slots:8  },
      { id:'100-west',  label:'100s West',  sub:'Lower Bowl — West Side',  color:'#8b5cf6', slots:8  },
      { id:'200-north', label:'200s North', sub:'Club Level — North',      color:'#f59e0b', slots:6  },
      { id:'200-south', label:'200s South', sub:'Club Level — South',      color:'#f59e0b', slots:6  },
      { id:'200-east',  label:'200s East',  sub:'Club Level — East',       color:'#22c55e', slots:5  },
      { id:'200-west',  label:'200s West',  sub:'Club Level — West',       color:'#22c55e', slots:5  },
      { id:'300-north', label:'300s North', sub:'Upper Bowl — North',      color:'#ef4444', slots:4  },
      { id:'300-south', label:'300s South', sub:'Upper Bowl — South',      color:'#ef4444', slots:4  },
      { id:'300-east',  label:'300s East',  sub:'Upper Bowl — East',       color:'#ec4899', slots:3  },
      { id:'300-west',  label:'300s West',  sub:'Upper Bowl — West',       color:'#ec4899', slots:3  },
    ],
  },

  lincoln: {
    imageUrl: '/assets/maps/lincoln.png',
    pins: {
      // Phase 1 — pins cleared; use Admin Mapper to capture %-based coords.
    },
    areas: [
      { id:'100-north', label:'100s North', sub:'Lower Bowl — North End',  color:'#3b82f6', slots:10 },
      { id:'100-south', label:'100s South', sub:'Lower Bowl — South End',  color:'#3b82f6', slots:10 },
      { id:'100-east',  label:'100s East',  sub:'Lower Bowl — East Side',  color:'#8b5cf6', slots:8  },
      { id:'100-west',  label:'100s West',  sub:'Lower Bowl — West Side',  color:'#8b5cf6', slots:8  },
      { id:'200-north', label:'200s North', sub:'Club Level — North',      color:'#f59e0b', slots:6  },
      { id:'200-south', label:'200s South', sub:'Club Level — South',      color:'#f59e0b', slots:6  },
      { id:'200-east',  label:'200s East',  sub:'Club Level — East',       color:'#22c55e', slots:5  },
      { id:'200-west',  label:'200s West',  sub:'Club Level — West',       color:'#22c55e', slots:5  },
      { id:'300-north', label:'300s North', sub:'Upper Bowl — North',      color:'#ef4444', slots:4  },
      { id:'300-south', label:'300s South', sub:'Upper Bowl — South',      color:'#ef4444', slots:4  },
      { id:'300-east',  label:'300s East',  sub:'Upper Bowl — East',       color:'#ec4899', slots:3  },
      { id:'300-west',  label:'300s West',  sub:'Upper Bowl — West',       color:'#ec4899', slots:3  },
    ],
  },

  rockefeller: {
    imageUrl: '/assets/maps/rockefeller.jpeg',
    pins: {
      'plaza-main':      { x:295, y:415, label:'Main Plaza'       },
      'plaza-north':     { x:295, y:265, label:'North Plaza'      },
      'plaza-south':     { x:295, y:560, label:'South Plaza'      },
      'concourse':       { x:430, y:480, label:'Concourse Level'  },
      'rink-level':      { x:230, y:485, label:'Rink Level'       },
      'channel-gardens': { x:620, y:415, label:'Channel Gardens'  },
      'top-rock':        { x:280, y:360, label:'Top of the Rock'  },
    },
    areas: [
      { id:'plaza-main',      label:'Main Plaza',      sub:'Ground Level — Center',   color:'#3b82f6', slots:8 },
      { id:'plaza-north',     label:'North Plaza',     sub:'Ground Level — North',    color:'#8b5cf6', slots:6 },
      { id:'plaza-south',     label:'South Plaza',     sub:'Ground Level — South',    color:'#f59e0b', slots:6 },
      { id:'concourse',       label:'Concourse Level', sub:'Interior — Concourse',    color:'#22c55e', slots:5 },
      { id:'rink-level',      label:'Rink Level',      sub:'Ice Rink — Ground Floor', color:'#ef4444', slots:4 },
      { id:'channel-gardens', label:'Channel Gardens', sub:'Outdoor — East Approach', color:'#ec4899', slots:4 },
      { id:'top-rock',        label:'Top of the Rock', sub:'Observation Deck Level',  color:'#14b8a6', slots:3 },
    ],
  },
};

// ── VENUE SWITCHER ────────────────────────────────────────────────────────────
export function setVenue(v, el) {
  state.currentVenue = v;
  document.querySelectorAll('.venue-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('map-venue-title').textContent =
    getVenues().find(x => x.id === v)?.name || v;

  const mapImg = document.getElementById('map-base-img');
  if (mapImg) {
    const cfg  = VENUE_CONFIG[v] || VENUE_CONFIG.metlife;
    _attachImgHandlers(mapImg, cfg.imageUrl);
    mapImg.src = cfg.imageUrl;
  }

  renderStadiumMap();
}

// ── MAP RENDERER ──────────────────────────────────────────────────────────────
export function renderStadiumMap() {
  _initAdminMapper();   // no-op after first call; safe to call on every render
  const cfg    = VENUE_CONFIG[state.currentVenue] || VENUE_CONFIG.metlife;
  const svg    = document.getElementById('stadium-svg');
  const mapImg = document.getElementById('map-base-img');
  if (mapImg) {
    _attachImgHandlers(mapImg, cfg.imageUrl);
    mapImg.src = cfg.imageUrl;
  }
  if (!svg) return;

  // Build zone → units map for the current venue
  const assignments = {};
  state.DATA.forEach(d => {
    if (d.zone && d.zone !== '—' && d.venue === state.currentVenue) {
      if (!assignments[d.zone]) assignments[d.zone] = [];
      assignments[d.zone].push(d);
    }
  });

  // ── SVG pins ────────────────────────────────────────────────────────────────
  const PIN_COLOR = '#F40009';
  let pins = '';

  Object.entries(cfg.pins).forEach(([areaId, pos]) => {
    const units = assignments[areaId] || [];
    const count = units.length;
    const cx    = pos.x;
    const cy    = pos.y;

    if (count > 0) {
      const tipY = cy + 26;
      pins += `
        <g style="cursor:pointer;pointer-events:all" onclick="openModal('${units[0].id}')">
          <circle cx="${cx}" cy="${cy}" r="26" fill="${PIN_COLOR}" opacity="0.2">
            <animate attributeName="r" values="22;30;22" dur="2.5s" repeatCount="indefinite"/>
            <animate attributeName="opacity" values="0.3;0;0.3" dur="2.5s" repeatCount="indefinite"/>
          </circle>
          <circle cx="${cx+2}" cy="${cy+3}" r="18" fill="rgba(0,0,0,0.55)"/>
          <circle cx="${cx}" cy="${cy}" r="20" fill="white"/>
          <circle cx="${cx}" cy="${cy}" r="17" fill="${PIN_COLOR}"/>
          <polygon points="${cx-8},${cy+14} ${cx+8},${cy+14} ${cx},${tipY}" fill="${PIN_COLOR}"/>
          <polygon points="${cx-8},${cy+14} ${cx+8},${cy+14} ${cx},${tipY}" fill="none" stroke="white" stroke-width="2" stroke-linejoin="round"/>
          <text x="${cx}" y="${cy+6}" text-anchor="middle" fill="white" font-size="14" font-weight="900" font-family="Arial,sans-serif">${count}</text>
          <text x="${cx}" y="${tipY+12}" text-anchor="middle" fill="white" font-size="9" font-weight="700" font-family="Arial,sans-serif"
            style="text-shadow:0 1px 4px rgba(0,0,0,1)">${pos.label}</text>
        </g>`;
    } else {
      pins += `
        <g style="cursor:pointer;pointer-events:all" onclick="showToast('No units assigned to ${areaId} yet')" opacity="0.35">
          <circle cx="${cx}" cy="${cy}" r="10" fill="white" stroke="rgba(255,255,255,0.5)" stroke-width="1"/>
          <text x="${cx}" y="${cy+4}" text-anchor="middle" fill="rgba(0,0,0,0.6)" font-size="11" font-family="Arial,sans-serif">+</text>
        </g>`;
    }
  });

  svg.innerHTML = pins;

  // ── Areas & Units list ───────────────────────────────────────────────────────
  const areaListEl  = document.getElementById('map-area-list');
  if (!areaListEl) return;

  const activeAreas = cfg.areas.filter(area => (assignments[area.id] || []).length > 0);

  if (activeAreas.length === 0) {
    areaListEl.innerHTML = '<div style="padding:20px 0;text-align:center;font-size:12px;color:var(--text-muted);font-family:var(--mono)">No areas assigned yet</div>';
  } else {
    areaListEl.innerHTML = activeAreas.map(area => {
      const units = assignments[area.id];
      const pct   = area.slots > 0 ? Math.round(units.length / area.slots * 100) : 0;
      return `
      <div class="area-row">
        <div style="width:10px;height:10px;border-radius:3px;background:${area.color};flex-shrink:0"></div>
        <div class="area-info">
          <div class="area-name">${area.label}</div>
          <div class="area-sub">${area.sub}</div>
        </div>
        <div class="area-bar"><div class="area-bar-fill" style="width:${pct}%;background:${area.color}"></div></div>
        <div style="font-family:var(--mono);font-size:11px;color:var(--text-sub);min-width:40px;text-align:right">
          ${units.length}/${area.slots}
        </div>
      </div>`;
    }).join('');
  }

  // ── Unassigned units for this venue ─────────────────────────────────────────
  const unassigned        = state.DATA.filter(d => d.venue === state.currentVenue && (!d.zone || d.zone === '—'));
  const unassignedSection = document.getElementById('unassigned-section');
  if (unassigned.length === 0) {
    if (unassignedSection) unassignedSection.style.display = 'none';
  } else {
    if (unassignedSection) unassignedSection.style.display = '';
    document.getElementById('unassigned-count').textContent = `(${unassigned.length})`;
    document.getElementById('unassigned-list').innerHTML =
      unassigned.slice(0, 40).map(d =>
        `<button class="map-unit-chip" onclick="openModal('${d.id}')">${d.digitalHeader}</button>`
      ).join('') +
      (unassigned.length > 40
        ? `<div style="font-size:10px;color:var(--text-muted);padding:4px">+${unassigned.length - 40} more</div>`
        : '');
  }
}

export function openAssignModal(id) {
  openModal(id);
  showToast('Use Import Excel to assign venue & area');
}
