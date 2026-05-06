// ── ACTIVITY LOG ───────────────────────────────────────────────────────────────
// Loads and renders the full cross-unit change history from Firestore.

import { state }      from './state.js';
import { COLLECTION, VENUES, TIPO } from './config.js';
import { showToast }  from './toast.js';

export function toSpanish(text) { return text || ''; }

export async function openActivityLog() {
  document.getElementById('activity-modal').style.display = 'block';
  document.getElementById('act-search').value = '';
  await loadActivityLog();
}

export async function loadActivityLog() {
  const el  = document.getElementById('activity-list');
  const btn = document.getElementById('act-refresh-btn');
  el.innerHTML = '<div style="color:var(--text-muted);font-size:11px;font-family:var(--mono);padding:24px 0;text-align:center">Loading records…</div>';
  if (btn) btn.disabled = true;

  try {
    const snap    = await state.db.collection(COLLECTION).get();
    const entries = [];

    snap.forEach(doc => {
      const d      = doc.data();
      const serial = d.digitalHeader || doc.id;
      const model  = d.model         || '—';

      Object.entries(d).forEach(([k, v]) => {
        if (!k.startsWith('log_')) return;
        const ts     = parseInt(k.replace('log_', ''), 10) || 0;
        const raw    = String(v);
        const dash   = raw.indexOf(' — ');
        const status = dash > -1 ? raw.slice(0, dash) : raw;
        const rest   = dash > -1 ? raw.slice(dash + 3) : '';
        const dotIdx = rest.lastIndexOf(' · ');
        const techRaw = dotIdx > -1 ? rest.slice(0, dotIdx).trim() : rest.trim();
        const dateRaw = dotIdx > -1 ? rest.slice(dotIdx + 3).trim() : '';
        const tech    = (techRaw === '—' || !techRaw) ? '' : techRaw;
        entries.push({
          ts, serial, model,
          type:    'status',
          accion:  toSpanish(status),
          detalle: dateRaw,
          usuario: d.updatedBy || tech,
          correo:  d.updatedByEmail || '',
        });
      });

      if (d.updatedBy && d.updatedAt) {
        const tsMs      = d.updatedAt?.toMillis ? d.updatedAt.toMillis() : 0;
        const nombreSede = d.venue ? (VENUES[d.venue]?.name?.split('—')[0].trim() || d.venue) : null;
        entries.push({
          ts:      tsMs,
          serial, model,
          type:    'venue',
          accion:  nombreSede ? `Assigned → ${nombreSede}` : 'Removed from venue',
          detalle: d.venueArea || '',
          usuario: d.updatedBy || '',
          correo:  d.updatedByEmail || '',
        });
      }
    });

    entries.sort((a, b) => b.ts - a.ts);
    state._activityAll = entries;
    renderActivity(entries);

  } catch (e) {
    el.innerHTML = `<div style="color:#f59e0b;font-size:11px;font-family:var(--mono);padding:24px 0;text-align:center">⚠ Error loading: ${e.message}</div>`;
  }
  if (btn) btn.disabled = false;
}

export function filterActivity() {
  const q = document.getElementById('act-search').value.toLowerCase();
  if (!q) { renderActivity(state._activityAll); return; }
  renderActivity(state._activityAll.filter(e =>
    e.serial.toLowerCase().includes(q) ||
    e.accion.toLowerCase().includes(q) ||
    e.detalle.toLowerCase().includes(q) ||
    e.usuario.toLowerCase().includes(q) ||
    e.correo.toLowerCase().includes(q)
  ));
}

export function renderActivity(entries) {
  const el = document.getElementById('activity-list');
  if (!entries.length) {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:11px;font-family:var(--mono);padding:24px 0;text-align:center">No records found</div>';
    return;
  }
  el.innerHTML = entries.slice(0, 150).map(e => {
    const cfg   = TIPO[e.type] || TIPO.status;
    const fecha = e.ts
      ? new Date(e.ts).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      : (e.detalle || '—');
    return `
    <div style="display:flex;gap:10px;padding:11px 0;border-bottom:1px solid rgba(255,255,255,.05)">
      <div style="width:30px;height:30px;border-radius:8px;background:${cfg.bg};
                  display:flex;align-items:center;justify-content:center;
                  flex-shrink:0;font-size:14px;margin-top:1px">${cfg.icon}</div>
      <div style="flex:1;min-width:0">
        <div style="margin-bottom:3px">
          <span style="font-size:9px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;
                       color:${cfg.color};background:${cfg.bg};padding:2px 8px;border-radius:10px">${cfg.label}</span>
        </div>
        <div style="font-size:13px;font-weight:700;color:#fff;margin-bottom:2px">${e.accion}</div>
        ${e.detalle && e.type === 'venue' ? `<div style="font-size:10px;color:var(--text-muted);font-family:var(--mono);margin-bottom:3px">📌 ${e.detalle}</div>` : ''}
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:3px">
          <span style="font-size:9px;background:rgba(255,255,255,.07);padding:2px 8px;
                       border-radius:10px;color:var(--text-muted);font-family:var(--mono)">${e.serial}</span>
          <span style="font-size:10px;color:var(--text-muted)">🕐 ${fecha}</span>
        </div>
        <div style="font-size:10px;color:var(--text-sub)">
          👤 ${e.usuario || '<span style="color:var(--text-muted);font-style:italic">Unregistered user</span>'}
          ${e.correo ? `<span style="color:var(--text-muted)"> · ${e.correo}</span>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');

  if (entries.length > 150) {
    el.innerHTML += `<div style="text-align:center;font-size:10px;color:var(--text-muted);padding:10px 0;font-family:var(--mono)">Showing latest 150 records</div>`;
  }
}
