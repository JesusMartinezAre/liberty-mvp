// ── BULK EXPORT ────────────────────────────────────────────────────────────────
// Excel and print-PDF export of the currently filtered inventory list.

import { showToast }  from './toast.js';
import { getFiltered, statusConfig } from './render.js';

async function _urlToDataUri(url) {
  try {
    const res  = await fetch(url);
    const blob = await res.blob();
    return await new Promise(resolve => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror   = () => resolve('');
      reader.readAsDataURL(blob);
    });
  } catch {
    return '';
  }
}

export function exportExcel() {
  if (typeof XLSX === 'undefined') { showToast('⚠ Excel library not loaded'); return; }
  const f = getFiltered();
  try {
    const rows = [
      ['DH S/N','Controller','Ctrl S/N','Router S/N','SIM Card','Content','Venue','Section','Location','Technician','Status'],
      ...f.map(d => [
        d.digitalHeader||'—',
        d.controller||'—',   d.controllerSN||'—', d.routerSN||'—', d.simCard||'—',
        d.content||'—',
        d.venueName||'—',
        d.zone||'—',
        d.location||'—',
        d.technician||'—',
        d.status||'—',
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [
      {wch:16},{wch:18},{wch:16},{wch:16},{wch:14},{wch:16},{wch:22},{wch:16},{wch:24},{wch:16},{wch:20},
    ];
    try {
      const hdrStyle = { font: { bold: true }, fill: { fgColor: { rgb: 'F40009' } }, alignment: { horizontal: 'center' } };
      ['A1','B1','C1','D1','E1','F1','G1','H1','I1','J1','K1'].forEach(cell => {
        if (ws[cell]) ws[cell].s = hdrStyle;
      });
    } catch (_) { /* styling not supported — plain download proceeds */ }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Liberty Inventory');
    XLSX.writeFile(wb, 'CocaCola_Liberty_Inventory.xlsx');
    showToast('✓ Excel exported');
  } catch (e) {
    showToast('⚠ Export failed — ' + e.message);
    console.error('[exportExcel]', e);
  }
}

export async function exportPDF() {
  const f = getFiltered();
  const w = window.open('', '_blank');
  if (!w) { showToast('⚠ Pop-up blocked — please allow pop-ups for this site'); return; }
  showToast('⏳ Generating PDF — downloading images…');

  const thumbUrls = [...new Set(
    f.flatMap(d => (d.photos || []).map(p => {
      const rawUrl = typeof p === 'string' ? p : p.url;
      return rawUrl.replace(/\/upload\//, '/upload/w_80,h_80,c_fill,q_60/');
    }))
  )];
  const dataUris   = await Promise.all(thumbUrls.map(url => _urlToDataUri(url)));
  const dataUriMap = Object.fromEntries(thumbUrls.map((url, i) => [url, dataUris[i]]));

  const cols = ['DH S/N','Controller','Ctrl S/N','Router S/N','SIM Card','Content','Venue','Section','Location','Technician','Status','Evidence'];
  const rows = f.map(d => {
    const photos = (d.photos || []);
    const thumbs = '<div class="ev-wrap">' + photos.map(p => {
      const rawUrl = typeof p === 'string' ? p : p.url;
      const t      = rawUrl.replace(/\/upload\//, '/upload/w_80,h_80,c_fill,q_60/');
      const src    = dataUriMap[t] || '';
      return src ? `<img class="ev-thumb" src="${src}" alt="">` : '';
    }).join('') + '</div>';
    return [
      d.digitalHeader,
      d.controller,      d.controllerSN||'—', d.routerSN||'—', d.simCard||'—',
      d.content||'—',
      d.venueName !== '—' ? d.venueName : (d.venue || '—'),
      d.zone||'—',
      d.location||'—',   d.technician||'—',  d.status,
      thumbs,
    ];
  });

  const styles = `
    @page{size:landscape;margin:10mm}
    body{font-family:Arial,sans-serif;font-size:7px;color:#111;margin:8px}
    h2{font-size:12px;margin-bottom:3px;color:#F40009}
    p{font-size:8px;color:#666;margin-bottom:8px}
    table{width:100%;border-collapse:collapse}
    th{background:#F40009;color:#fff;padding:4px 5px;text-align:left;font-size:7px;letter-spacing:.4px;text-transform:uppercase;white-space:nowrap}
    td{padding:3px 5px;border-bottom:1px solid #eee;font-size:7px;white-space:nowrap;vertical-align:middle}
    .ev-cell{white-space:normal;vertical-align:top;padding:3px 4px;min-width:130px}
    .ev-wrap{display:block;width:120px;line-height:0;font-size:0}
    .ev-thumb{display:inline-block;width:36px;height:36px;object-fit:cover;border-radius:3px;margin:2px}
    tr:nth-child(even) td{background:#f9f9f9}
    .s0{color:#888}.s1{color:#3b82f6}.s2{color:#f59e0b}.s3{color:#a855f7}.s4{color:#22c55e;font-weight:700}
  `;
  const sc           = s => ({'In Assembly':'s0','Completed':'s1','Shipped':'s2','With Client':'s3','Installed at Venue':'s4'}[s] || '');
  const STATUS_IDX   = cols.indexOf('Status');
  const EVIDENCE_IDX = cols.indexOf('Evidence');
  const thead        = '<tr>' + cols.map(c => `<th>${c}</th>`).join('') + '</tr>';
  const tbody        = rows.map(r => {
    const cells = r.map((v, i) => {
      if (i === STATUS_IDX)   return `<td class="${sc(v)}">${v}</td>`;
      if (i === EVIDENCE_IDX) return `<td class="ev-cell">${v}</td>`;
      return `<td>${v}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  const htmlContent = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Coca-Cola Liberty Inventory</title>
    <style>${styles}</style></head><body>
    <h2>Coca-Cola Liberty — Digital Display Inventory</h2>
    <p>Generated: ${new Date().toLocaleString()} · ${f.length} units</p>
    <table><thead>${thead}</thead><tbody>${tbody}</tbody></table>
    <script>window.onload=function(){window.print();}<\/script>
    </body></html>`;

  w.document.write(htmlContent);
  w.document.close();
  showToast('✓ PDF ready to print');
}
