// ── CORE RENDERING ────────────────────────────────────────────────────────────
// All DOM-rendering functions that reflect the DATA array into the UI.

import { state }        from './state.js';
import { STATUSES, STATUS_LABELS } from './config.js';
import { showToast }    from './toast.js';
import { getVenues }    from './dataService.js';

// ── HELPERS ───────────────────────────────────────────────────────────────────
export function statusConfig(s) {
  const idx = STATUS_LABELS.indexOf(s);
  return STATUSES[idx >= 0 ? idx : 0];
}

export function animCount(el, n) {
  let s = null;
  function step(ts) {
    if (!s) s = ts;
    const p = Math.min((ts - s) / 700, 1);
    el.textContent = Math.round(p * n);
    if (p < 1) requestAnimationFrame(step);
    else el.textContent = n;
  }
  requestAnimationFrame(step);
}

// ── FILTER ────────────────────────────────────────────────────────────────────
export function getFiltered() {
  const q = state.filterQ.toLowerCase();
  return state.DATA.filter(d => {
    if (state.filterPlatform !== 'all') {
      const dbPlatform = state.filterPlatform === 'POPA' ? 'Navori' : state.filterPlatform;
      if (d.platform !== state.filterPlatform && d.platform !== dbPlatform) return false;
    }
    if (state.filterStatus && d.status !== state.filterStatus) return false;
    if (state.filterVenue  && d.venue  !== state.filterVenue)  return false;
    if (q && ![d.digitalHeader, d.model, d.routerSN, d.simCard, d.location, d.controllerSN]
               .some(v => (v || '').toLowerCase().includes(q))) return false;
    return true;
  });
}

// ── KPIs ──────────────────────────────────────────────────────────────────────
export function renderKPIs() {
  const total = state.DATA.length;
  const popa  = state.DATA.filter(d => d.platform === 'POPA' || d.platform === 'Navori').length;
  const kos   = state.DATA.filter(d => d.platform === 'KOS').length;
  const inst  = state.DATA.filter(d => d.status === 'Installed at Venue').length;
  animCount(document.getElementById('k-total'),    total);
  animCount(document.getElementById('k-navori'),   popa);
  animCount(document.getElementById('k-kos'),      kos);
  animCount(document.getElementById('k-installed'), inst);
  document.getElementById('tab-total').textContent = total;
  const pct  = total > 0 ? Math.round(inst / total * 100) : 0;
  const text = `${inst}/${total} installed`;
  const pb   = document.getElementById('global-progress-bar');
  const pt   = document.getElementById('global-progress-text');
  const pts  = document.getElementById('global-progress-text-side');
  if (pb)  pb.style.width  = pct + '%';
  if (pt)  pt.textContent  = text;
  if (pts) pts.textContent = text;
  const cnPopa = document.getElementById('cn-popa');
  const cnKos  = document.getElementById('cn-kos');
  if (cnPopa) cnPopa.textContent = popa;
  if (cnKos)  cnKos.textContent  = kos;
}

// ── PIPELINE ──────────────────────────────────────────────────────────────────
export function renderPipeline() {
  const installedTotal = state.DATA.filter(d => d.installed === true).length;
  const total          = state.DATA.length || 1;
  const installedColor = '#22c55e';
  const venues         = getVenues();

  const counts = {};
  state.DATA.forEach(d => {
    if (d.installed === true && d.venue) counts[d.venue] = (counts[d.venue] || 0) + 1;
  });

  let html = `
    <div class="pipe-row kpi-btn" onclick="kpiFilter('all','Installed at Venue')" style="cursor:pointer">
      <div class="pipe-dot" style="background:${installedColor}"></div>
      <div class="pipe-name" style="color:${installedColor}">Installed at Venue</div>
      <div class="pipe-count" style="color:${installedColor}">${installedTotal}</div>
      <div class="pipe-pct">${Math.round(installedTotal / total * 100)}% ›</div>
    </div>
    <div style="height:1px;background:var(--border);margin:8px 0"></div>
    <div style="font-size:9px;color:var(--text-muted);letter-spacing:1px;font-weight:700;margin-bottom:8px;padding-left:2px">FILTER BY VENUE</div>
  `;

  venues.forEach((v, i) => {
    const color     = VENUE_PILL_COLORS[i % VENUE_PILL_COLORS.length];
    const count     = counts[v.id] || 0;
    const pct       = installedTotal > 0 ? Math.round(count / installedTotal * 100) : 0;
    const shortName = v.name.split('—')[0].split(',')[0].trim();
    html += `
    <div class="pipe-row kpi-btn" onclick="venueFilter('${v.id}')" style="cursor:pointer">
      <div class="pipe-dot" style="background:${color}"></div>
      <div class="pipe-name" style="color:${color}">${shortName}</div>
      <div class="pipe-count" style="color:${color}">${count}</div>
      <div class="pipe-pct">${pct}% ›</div>
    </div>`;
  });

  const knownIds = new Set(venues.map(v => v.id));
  const freeform = [...new Set(
    state.DATA.map(d => d.venue).filter(v => v && v !== '—' && !knownIds.has(v))
  )];
  freeform.forEach((v, i) => {
    const color = VENUE_PILL_COLORS[(venues.length + i) % VENUE_PILL_COLORS.length];
    const count = counts[v] || 0;
    const pct   = installedTotal > 0 ? Math.round(count / installedTotal * 100) : 0;
    html += `
    <div class="pipe-row kpi-btn" onclick="venueFilter('${v}')" style="cursor:pointer">
      <div class="pipe-dot" style="background:${color}"></div>
      <div class="pipe-name" style="color:${color}">${v}</div>
      <div class="pipe-count" style="color:${color}">${count}</div>
      <div class="pipe-pct">${pct}% ›</div>
    </div>`;
  });

  document.getElementById('pipeline').innerHTML = html;
}

// ── PENDING DEPLOYMENT PIPELINE ───────────────────────────────────────────────
// Mirrors renderPipeline() for the "Not Installed" universe.
//
// Breakdown:
//   Tier 1 — Assignment Readiness
//     Venue-assigned : d.installed !== true && d.venue is set
//                      → unit is scheduled; field team can act today
//     Unassigned TBD : d.installed !== true && no d.venue
//                      → upstream planning gap; ops team must assign first
//
//   Tier 2 — Platform Mix
//     POPA pending / KOS pending  → informs logistics which hardware is queuing
//
// Interactivity:
//   Header + platform rows → kpiFilter() → Inventory tab with preset filters
//   Readiness sub-rows     → diagnostic only (no compound filter mechanism)
//
// Uses d.installed === true (boolean) as the authoritative installed flag,
// consistent with renderPipeline() and the Map module.
// ─────────────────────────────────────────────────────────────────────────────
export function renderPendingPipeline() {
  const container = document.getElementById('pending-pipeline');
  if (!container) return;

  const AMBER = '#f59e0b';
  const total  = state.DATA.length || 1;

  // Every unit that is not yet confirmed installed
  const pending      = state.DATA.filter(d => d.installed !== true);
  const pendingTotal = pending.length;

  // ── Happy state — all units deployed ─────────────────────────────────────
  if (pendingTotal === 0) {
    container.innerHTML = `
      <div style="padding:20px 0;text-align:center;
                  font-family:var(--mono);font-size:12px;letter-spacing:.5px;
                  color:var(--s4)">
        🎉 All ${total} units installed!
      </div>`;
    return;
  }

  // ── Platform Mix ─────────────────────────────────────────────────────────
  const popaPending = pending.filter(d => d.platform === 'POPA' || d.platform === 'Navori').length;
  const kosPending  = pending.filter(d => d.platform === 'KOS').length;

  // ── Percentages ───────────────────────────────────────────────────────────
  const pctOfTotal = Math.round(pendingTotal / total       * 100);
  const pctPopa    = pendingTotal > 0 ? Math.round(popaPending / pendingTotal * 100) : 0;
  const pctKos     = pendingTotal > 0 ? Math.round(kosPending  / pendingTotal * 100) : 0;

  // ── Section divider — identical style to renderPipeline() ─────────────────
  const divider = label => `
    <div style="height:1px;background:var(--border);margin:8px 0"></div>
    <div style="font-size:9px;color:var(--text-muted);letter-spacing:1px;
                font-weight:700;margin-bottom:8px;padding-left:2px">${label}</div>`;

  container.innerHTML = `

    <!-- ── Header row: total pending ────────────────────────────────────────
         Clickable → Inventory tab, "Not Installed" filter preset           -->
    <div class="pipe-row kpi-btn"
         onclick="kpiFilter('all','Not Installed')"
         style="cursor:pointer">
      <div class="pipe-dot" style="background:${AMBER}"></div>
      <div class="pipe-name"  style="color:${AMBER}">Not Installed</div>
      <div class="pipe-count" style="color:${AMBER}">${pendingTotal}</div>
      <div class="pipe-pct">${pctOfTotal}% ›</div>
    </div>

    ${divider('PLATFORM MIX')}

    <!-- POPA pending — clickable → Inventory / POPA / Not Installed         -->
    <div class="pipe-row kpi-btn"
         onclick="kpiFilter('POPA','Not Installed')"
         style="cursor:pointer">
      <div class="pipe-dot" style="background:var(--navori)"></div>
      <div class="pipe-name"  style="color:var(--navori)">POPA</div>
      <div class="pipe-count" style="color:var(--navori)">${popaPending}</div>
      <div class="pipe-pct">${pctPopa}% ›</div>
    </div>

    <!-- KOS pending — clickable → Inventory / KOS / Not Installed            -->
    <div class="pipe-row kpi-btn"
         onclick="kpiFilter('KOS','Not Installed')"
         style="cursor:pointer">
      <div class="pipe-dot" style="background:var(--kos)"></div>
      <div class="pipe-name"  style="color:var(--kos)">KOS / Tier One</div>
      <div class="pipe-count" style="color:var(--kos)">${kosPending}</div>
      <div class="pipe-pct">${pctKos}% ›</div>
    </div>
  `;
}

// ── DONUT ─────────────────────────────────────────────────────────────────────
export function renderDonut() {
  const C   = 226.2;
  const nav = state.DATA.filter(d => d.platform === 'POPA' || d.platform === 'Navori').length;
  const kos = state.DATA.filter(d => d.platform === 'KOS').length;
  const tot = state.DATA.length || 1;
  const np  = nav / tot;
  const kp  = kos / tot;
  const dn  = document.getElementById('dn-navori');
  const dk  = document.getElementById('dn-kos');
  dn.style.strokeDasharray = `${C * np} ${C * (1 - np)}`;
  dk.style.strokeDasharray = `${C * kp} ${C * (1 - kp)}`;
  dk.setAttribute('stroke-dashoffset', -(C * np));
}

// ── LIST ──────────────────────────────────────────────────────────────────────
export function renderList() {
  const filtered    = getFiltered();
  let infoHTML      = `${filtered.length} unit${filtered.length !== 1 ? 's' : ''}`;
  if (state.filterVenue) {
    const activeVenue = getVenues().find(v => v.id === state.filterVenue);
    const shortName   = activeVenue
      ? activeVenue.name.split('—')[0].split(',')[0].trim()
      : state.filterVenue;
    infoHTML += ` <span onclick="clearVenueFilter()" style="display:inline-flex;align-items:center;gap:4px;background:rgba(59,130,246,.15);border:1px solid rgba(59,130,246,.3);color:var(--navori);padding:2px 8px;border-radius:10px;margin-left:8px;font-size:9px;font-weight:700;letter-spacing:.5px;cursor:pointer">📍 ${shortName} ✕</span>`;
  }
  document.getElementById('res-info').innerHTML         = infoHTML;
  document.getElementById('tab-filtered').textContent   = filtered.length;
  document.getElementById('cn-all').textContent         = state.DATA.length;

  if (!filtered.length) {
    document.getElementById('item-list').innerHTML = `
      <div style="text-align:center;padding:40px 20px;color:var(--text-muted)">
        <div style="font-size:36px;margin-bottom:12px;opacity:.4">🔍</div>
        <div style="font-size:13px;font-weight:600;color:var(--text-sub);margin-bottom:6px">No units found</div>
        <div style="font-size:11px;line-height:1.5">Try adjusting your search<br>or clearing the filters</div>
        <button onclick="clearQ();setStatusFilter('',document.querySelector('.sf'));setPlatform('all',document.getElementById('cf-all'));clearVenueFilter()"
          style="margin-top:14px;padding:8px 16px;background:var(--surface);border:1px solid var(--border);border-radius:8px;font-family:var(--sans);font-size:11px;font-weight:600;color:var(--text-sub);cursor:pointer">
          Clear filters
        </button>
      </div>`;
    return;
  }

  document.getElementById('item-list').innerHTML = filtered.map((d, i) => {
    const sc = statusConfig(d.status);
    return `
    <button class="item" style="animation:fadeUp .25s ${Math.min(i * .015, .25)}s both;width:100%;text-align:left" onclick="openModal('${d.id}')">
      <div class="item-badge ${d.platform === 'Navori' ? 'POPA' : d.platform}">${(d.platform === 'POPA' || d.platform === 'Navori') ? 'POPA' : 'KOS'}</div>
      <div class="item-body">
        <div class="item-serial">${d.digitalHeader}</div>
        <div class="item-model">${d.model}</div>
        <div class="item-meta">
          <span>RTR: <b>${d.routerSN || '—'}</b></span>
          <span>SIM: <b>${d.simCard  || '—'}</b></span>
          <span>LOC: <b>${d.location || '—'}</b></span>
        </div>
      </div>
      <div class="item-status" style="background:${sc.bg};color:${sc.color}">${d.status}</div>
      <div class="item-arrow">›</div>
    </button>`;
  }).join('');
}

// ── VENUE PROGRESS ────────────────────────────────────────────────────────────
export function updateVenueProgress() {
  getVenues().forEach(v => {
    const total     = state.DATA.filter(d => d.venue === v.id).length;
    const installed = state.DATA.filter(d => d.venue === v.id && d.installed === true).length;
    const el        = document.getElementById('venue-progress-' + v.id);
    if (el) el.textContent = `${installed}/${total} installed`;
  });
}

// ── SIDEBAR COUNTS ────────────────────────────────────────────────────────────
export function updateSidebarCounts() {
  const s1 = document.getElementById('s-tab-total');
  const s2 = document.getElementById('s-tab-filtered');
  const t1 = document.getElementById('tab-total');
  const t2 = document.getElementById('tab-filtered');
  if (s1 && t1) s1.textContent = t1.textContent;
  if (s2 && t2) s2.textContent = t2.textContent;
}

// ── VENUE FILTER BUTTONS ──────────────────────────────────────────────────────
const VENUE_PILL_COLORS = ['#3b82f6', '#8b5cf6', '#f59e0b', '#22c55e', '#ef4444', '#ec4899'];

export function renderVenueFilters() {
  const container = document.getElementById('venue-filter-btns');
  if (!container) return;

  const known    = getVenues();
  const knownIds = new Set(known.map(v => v.id));
  const freeform = [...new Set(
    state.DATA.map(d => d.venue).filter(v => v && v !== '—' && !knownIds.has(v))
  )];

  const knownBtns = known.map((v, i) => {
    const color     = VENUE_PILL_COLORS[i % VENUE_PILL_COLORS.length];
    const shortName = v.name.split('—')[0].split(',')[0].trim();
    return `<button class="sf" data-v="${v.id}"
      onclick="venueFilterChip('${v.id}',this)"
      style="background:${color}1a;color:${color};border-color:${color}4d">
      📍 ${shortName}
    </button>`;
  });

  const freeformBtns = freeform.map((v, i) => {
    const color = VENUE_PILL_COLORS[(known.length + i) % VENUE_PILL_COLORS.length];
    return `<button class="sf" data-v="${v}"
      onclick="venueFilterChip('${v}',this)"
      style="background:${color}1a;color:${color};border-color:${color}4d">
      📍 ${v}
    </button>`;
  });

  container.innerHTML = [...knownBtns, ...freeformBtns].join('');
}

// ── RENDER ALL ────────────────────────────────────────────────────────────────
export function renderAll() {
  renderKPIs();
  renderPipeline();
  renderPendingPipeline();   // ← Pending Deployment card (mirrors renderPipeline)
  renderDonut();
  renderList();
  renderVenueFilters();
  updateVenueProgress();
  updateSidebarCounts();
}
