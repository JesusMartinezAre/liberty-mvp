// ── STADIUM MAP ────────────────────────────────────────────────────────────────
// Renders the interactive SVG map, venue switcher, area list, and unassigned list.

import { state }             from './state.js';
import { getVenues }         from './dataService.js';
import { showToast }         from './toast.js';
import { openModal }         from './modal.js';

export function setVenue(v, el) {
  state.currentVenue = v;
  document.querySelectorAll('.venue-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('map-venue-title').textContent = getVenues().find(x => x.id === v)?.name || v;
  const mapImg = document.getElementById('map-base-img');
  if (mapImg) {
    let b64;
    if (v === 'lincoln')      b64 = window.LINCOLN_B64;
    else if (v === 'rockefeller') b64 = window.ROCKEFELLER_B64;
    else                      b64 = window.METLIFE_B64;
    mapImg.src = 'data:image/jpeg;base64,' + b64;
  }
  renderStadiumMap();
}

export function renderStadiumMap() {
  const venue = getVenues().find(v => v.id === state.currentVenue);
  const svg   = document.getElementById('stadium-svg');

  const assignments = {};
  state.DATA.forEach(d => {
    if (d.zone && d.zone !== '—' && d.venue === state.currentVenue) {
      if (!assignments[d.zone]) assignments[d.zone] = [];
      assignments[d.zone].push(d);
    }
  });

  const AREA_PINS = {
    metlife: {
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
    lincoln: {
      '100-north': { x:490, y:188, label:'100s North' },
      '100-south': { x:490, y:420, label:'100s South' },
      '100-east':  { x:620, y:308, label:'100s East'  },
      '100-west':  { x:360, y:308, label:'100s West'  },
      '200-north': { x:490, y:135, label:'200s North' },
      '200-south': { x:490, y:478, label:'200s South' },
      '200-east':  { x:668, y:308, label:'200s East'  },
      '200-west':  { x:312, y:308, label:'200s West'  },
      '300-north': { x:490, y:82,  label:'300s North' },
      '300-south': { x:490, y:532, label:'300s South' },
      '300-east':  { x:712, y:308, label:'300s East'  },
      '300-west':  { x:268, y:308, label:'300s West'  },
    },
    rockefeller: {
      'plaza-main':       { x:295, y:415, label:'Main Plaza'      },
      'plaza-north':      { x:295, y:265, label:'North Plaza'     },
      'plaza-south':      { x:295, y:560, label:'South Plaza'     },
      'concourse':        { x:430, y:480, label:'Concourse Level' },
      'rink-level':       { x:230, y:485, label:'Rink Level'      },
      'channel-gardens':  { x:620, y:415, label:'Channel Gardens' },
      'top-rock':         { x:280, y:360, label:'Top of the Rock' },
    },
  };

  const pinMap    = AREA_PINS[state.currentVenue] || AREA_PINS.metlife;
  const PIN_COLOR = '#F40009';

  let pins = '';
  Object.entries(pinMap).forEach(([areaId, pos]) => {
    const units  = assignments[areaId] || [];
    const count  = units.length;
    const cx = pos.x, cy = pos.y;

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

  // Area list
  const areaListEl  = document.getElementById('map-area-list');
  const areas       = venue.areas;
  const activeAreas = areas.filter(area => (assignments[area.id] || []).length > 0);
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

  // Unassigned units for this venue
  const unassigned = state.DATA.filter(d => d.venue === state.currentVenue && (!d.zone || d.zone === '—'));
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
      (unassigned.length > 40 ? `<div style="font-size:10px;color:var(--text-muted);padding:4px">+${unassigned.length - 40} more</div>` : '');
  }
}

export function openAssignModal(id) {
  openModal(id);
  showToast('Use Import Excel to assign venue & area');
}
