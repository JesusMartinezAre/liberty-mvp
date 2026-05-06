// ── EXCEL IMPORT ───────────────────────────────────────────────────────────────
// Handles bulk import from Excel: file parsing, column detection, confirmation.

import { state }      from './state.js';
import { COLLECTION } from './config.js';
import { showToast }  from './toast.js';

export function triggerImport() {
  document.getElementById('excel-input').click();
}

export function handleExcelFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const wb  = XLSX.read(ev.target.result, { type: 'binary' });
      const ws  = wb.Sheets[wb.SheetNames[0]];

      let raw = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!raw.length) { showToast('⚠ Empty file'); return; }

      const tryDetect = rows => {
        const keys = Object.keys(rows[0] || {});
        const detect = hints => {
          for (const h of hints) {
            const found = keys.find(k => k.toLowerCase().includes(h.toLowerCase()));
            if (found) return found;
          }
          return null;
        };
        return detect(['digital header', 'zipdhe', 'zipkdhi', 'header s/n', 'dh s/n', 'unit serial']);
      };

      if (!tryDetect(raw)) raw = XLSX.utils.sheet_to_json(ws, { defval: '', range: 2 });
      if (!raw.length || !tryDetect(raw)) raw = XLSX.utils.sheet_to_json(ws, { defval: '', range: 1 });
      if (!raw.length) { showToast('⚠ Empty file'); return; }

      const keys   = Object.keys(raw[0]);
      const detect = hints => {
        for (const h of hints) {
          const found = keys.find(k => k.toLowerCase().includes(h.toLowerCase()));
          if (found) return found;
        }
        return null;
      };

      const colMap = {
        digitalHeader: detect(['unit serial number','digital header','zipdhe','zipkdhi','header s/n','dh s/n']),
        controllerSN:  detect(['número de serie','numero de serie','controller s/n','controller serial','popa serial','stix serial']),
        routerSN:      detect(['router','rtr s/n','router s/n','router serial']),
        simCard:       detect(['sim','sim card','sim #']),
        location:      detect(['location','loc','store','address','ubicacion','ubicación']),
        venue:         detect(['venue','estadio','stadium']),
        content:       detect(['content','contenido','playlist']),
        status:        detect(['instalado','installed','status','estatus']),
        ipAddress:     detect(['ip address','ip','ip addr']),
        macAddress:    detect(['mac address','mac','mac addr']),
        section:       detect(['section','seccion','sección','sec #']),
        technician:    detect(['technician','tech','instalador','installer','técnico']),
        notes:         detect(['notes','notas','comments','comentarios']),
      };

      const normalize  = s => String(s || '').trim().toUpperCase().replace(/\s+/g, '');
      const validIDs   = new Set(state.DATA.map(d => normalize(d.digitalHeader)));
      const autoCorrect = s => {
        let fixed = s;
        if (/^ZIPDEH/.test(fixed)) fixed = fixed.replace(/^ZIPDEH/, 'ZIPDHE');
        if (/^ZIKPDHI/.test(fixed)) fixed = fixed.replace(/^ZIKPDHI/, 'ZIPKDHI');
        return fixed;
      };

      const unmatched = [];
      const autoFixed = [];
      state.importRows = raw.filter(r => {
        const dhRaw = colMap.digitalHeader ? String(r[colMap.digitalHeader]).trim() : '';
        let dh = normalize(dhRaw);
        if (!dh) return false;
        if (validIDs.has(dh)) return true;
        const corrected = autoCorrect(dh);
        if (corrected !== dh && validIDs.has(corrected)) {
          autoFixed.push(`${dhRaw} → ${corrected}`);
          if (colMap.digitalHeader) r[colMap.digitalHeader] = corrected;
          return true;
        }
        unmatched.push(dhRaw);
        return false;
      });

      state.importRows.forEach(r => {
        if (colMap.digitalHeader) r[colMap.digitalHeader] = normalize(r[colMap.digitalHeader]);
      });

      let subMsg = `<b style="color:var(--text)">${state.importRows.length} matching rows</b> found in <i>${file.name}</i>.`;
      if (autoFixed.length > 0) subMsg += `<br><span style="color:#3b82f6;font-size:11px">✓ ${autoFixed.length} typos auto-corrected: ${autoFixed.slice(0, 3).join(', ')}${autoFixed.length > 3 ? '...' : ''}</span>`;
      if (unmatched.length > 0) subMsg += `<br><span style="color:#f59e0b;font-size:11px">⚠ ${unmatched.length} unmatched: ${unmatched.slice(0, 5).map(s => `"${s}"`).join(', ')}${unmatched.length > 5 ? '...' : ''}</span>`;
      subMsg += `<br>Fields to update:`;

      document.getElementById('import-sub').innerHTML  = subMsg;
      document.getElementById('import-map').innerHTML  = Object.entries(colMap).filter(([, v]) => v)
        .map(([k, v]) => `<div class="import-map-row"><span class="import-map-key">${k}</span><span class="import-map-val">← "${v}"</span></div>`).join('');
      document.getElementById('import-count').textContent = state.importRows.length;
      document.getElementById('import-progress').textContent = '';
      document.getElementById('import-actions').style.display = 'flex';
      document.getElementById('import-overlay').classList.add('open');
      document.getElementById('import-overlay').dataset.colmap = JSON.stringify(colMap);

    } catch (err) {
      showToast('⚠ Could not read file');
      console.error(err);
    }
  };
  reader.readAsBinaryString(file);
  e.target.value = '';
}

export async function confirmImport() {
  const colMap = JSON.parse(document.getElementById('import-overlay').dataset.colmap || '{}');
  document.getElementById('import-actions').style.display = 'none';
  const prog = document.getElementById('import-progress');
  prog.textContent = `Updating 0 / ${state.importRows.length}…`;

  const BATCH_SIZE = 400;
  let updated = 0;

  for (let i = 0; i < state.importRows.length; i += BATCH_SIZE) {
    const batch = state.db.batch();
    const chunk = state.importRows.slice(i, i + BATCH_SIZE);
    chunk.forEach(row => {
      const dh = colMap.digitalHeader ? String(row[colMap.digitalHeader]).trim() : '';
      if (!dh) return;
      const upd = { updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
      const str = v => (v !== undefined && v !== null && String(v).trim() !== 'nan' && String(v).trim() !== '') ? String(v).trim() : '—';
      if (colMap.routerSN)     upd.routerSN      = str(row[colMap.routerSN]);
      if (colMap.simCard)      upd.simCard        = str(row[colMap.simCard]);
      if (colMap.controllerSN) upd.controllerSN  = str(row[colMap.controllerSN]);
      if (colMap.location)     upd.location      = str(row[colMap.location]);
      if (colMap.venue) {
        const vText = str(row[colMap.venue]).toLowerCase();
        upd.venueText = str(row[colMap.venue]);
        if      (vText.includes('metlife'))       upd.venue = 'metlife';
        else if (vText.includes('lincoln'))       upd.venue = 'lincoln';
        else if (vText.includes('rockefeller'))   upd.venue = 'rockefeller';
      }
      if (colMap.content)    upd.content    = str(row[colMap.content]);
      if (colMap.ipAddress)  upd.ipAddress  = str(row[colMap.ipAddress]);
      if (colMap.macAddress) upd.macAddress = str(row[colMap.macAddress]);
      if (colMap.section)    upd.section    = str(row[colMap.section]);
      if (colMap.technician) upd.technician = str(row[colMap.technician]);
      if (colMap.notes)      upd.notes      = str(row[colMap.notes]);
      if (colMap.status) {
        const sv = str(row[colMap.status]);
        if (sv && sv !== '—' && sv !== 'NaN') upd.status = (sv === '1' || sv.toLowerCase().includes('instal')) ? 'Installed at Venue' : sv;
      }
      batch.update(state.db.collection(COLLECTION).doc(dh), upd);
    });
    await batch.commit();
    updated += chunk.length;
    prog.textContent = `Updating ${updated} / ${state.importRows.length}…`;
  }

  prog.textContent = `✓ ${updated} rows updated`;
  showToast(`✓ Imported ${updated} records`);
  setTimeout(closeImportOverlay, 1500);
}

export function closeImportOverlay() {
  document.getElementById('import-overlay').classList.remove('open');
  state.importRows = [];
}
