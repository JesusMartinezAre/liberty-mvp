// ── CORE RENDERING ────────────────────────────────────────────────────────────
// All DOM-rendering functions that reflect the DATA array into the UI.

import { state }        from './state.js';
import { STATUSES, STATUS_LABELS } from './config.js';
import { showToast }    from './toast.js';

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
  const pct = total > 0 ? Math.round(inst / total * 100) : 0;
  const pb  = document.getElementById('global-progress-bar');
  const pt  = document.getElementById('global-progress-text');
  if (pb) pb.style.width = pct + '%';
  if (pt) pt.textContent = `${inst}/${total} installed`;
}

// ── PIPELINE ──────────────────────────────────────────────────────────────────
export function renderPipeline() {
  const installedTotal = state.DATA.filter(d => d.status === 'Installed at Venue').length;
  const total          = state.DATA.length || 1;
  const installedColor = '#22c55e';

  const venueLabels = { metlife:'MetLife · NJ', lincoln:'Lincoln · PHL', rockefeller:'Rockefeller · NY' };
  const venueColors = { metlife:'#3b82f6', lincoln:'#8b5cf6', rockefeller:'#f59e0b' };
  const venueCounts = { metlife:0, lincoln:0, rockefeller:0 };
  state.DATA.forEach(d => {
    if (d.status === 'Installed at Venue' && d.venue && venueCounts[d.venue] !== undefined) {
      venueCounts[d.venue]++;
    }
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

  Object.keys(venueLabels).forEach(v => {
    const count = venueCounts[v];
    const pct   = installedTotal > 0 ? Math.round(count / installedTotal * 100) : 0;
    html += `
    <div class="pipe-row kpi-btn" onclick="venueFilter('${v}')" style="cursor:pointer">
      <div class="pipe-dot" style="background:${venueColors[v]}"></div>
      <div class="pipe-name" style="color:${venueColors[v]}">${venueLabels[v]}</div>
      <div class="pipe-count" style="color:${venueColors[v]}">${count}</div>
      <div class="pipe-pct">${pct}% ›</div>
    </div>`;
  });

  document.getElementById('pipeline').innerHTML = html;
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
  const venueLabels = { metlife:'MetLife', lincoln:'Lincoln', rockefeller:'Rockefeller' };
  let infoHTML      = `${filtered.length} unit${filtered.length !== 1 ? 's' : ''}`;
  if (state.filterVenue && venueLabels[state.filterVenue]) {
    infoHTML += ` <span onclick="clearVenueFilter()" style="display:inline-flex;align-items:center;gap:4px;background:rgba(59,130,246,.15);border:1px solid rgba(59,130,246,.3);color:var(--navori);padding:2px 8px;border-radius:10px;margin-left:8px;font-size:9px;font-weight:700;letter-spacing:.5px;cursor:pointer">📍 ${venueLabels[state.filterVenue]} ✕</span>`;
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
  ['metlife', 'lincoln', 'rockefeller'].forEach(v => {
    const total     = state.DATA.filter(d => d.venue === v).length;
    const installed = state.DATA.filter(d => d.venue === v && d.status === 'Installed at Venue').length;
    const el        = document.getElementById('venue-progress-' + v);
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
  const sp = document.getElementById('global-progress-text-side');
  const gp = document.getElementById('global-progress-text');
  if (sp && gp) sp.textContent = gp.textContent;
}

// ── RENDER ALL ────────────────────────────────────────────────────────────────
export function renderAll() {
  renderKPIs();
  renderPipeline();
  renderDonut();
  renderList();
  updateVenueProgress();
  updateSidebarCounts();
}
