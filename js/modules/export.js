// ── BULK EXPORT ────────────────────────────────────────────────────────────────
// Excel and print-PDF export of the currently filtered inventory list.

import { showToast }  from './toast.js';
import { getFiltered, statusConfig } from './render.js';

// Installed units first, then not-installed. Preserves the existing
// digitalHeader alphabetical order within each group (JS sort is stable).
function sortedForExport(items) {
  return items.slice().sort(
    (a, b) => (a.status === 'Installed at Venue' ? 0 : 1) - (b.status === 'Installed at Venue' ? 0 : 1)
  );
}

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

async function _stitchThumbs(photos) {
  const THUMB = 60, GAP = 3, CAP = 4;
  const uris = await Promise.all(
    (photos || []).slice(0, CAP).map(p => {
      const rawUrl = typeof p === 'string' ? p : p.url;
      return _urlToDataUri(rawUrl.replace(/\/upload\//, `/upload/w_${THUMB},h_${THUMB},c_fill,q_70/`));
    })
  );
  const valid = uris.filter(Boolean);
  if (!valid.length) return null;

  const canvas  = document.createElement('canvas');
  canvas.width  = valid.length * (THUMB + GAP) - GAP;
  canvas.height = THUMB;
  const ctx     = canvas.getContext('2d');

  await Promise.all(valid.map((uri, i) => new Promise(resolve => {
    const img   = new Image();
    img.onload  = () => { ctx.drawImage(img, i * (THUMB + GAP), 0, THUMB, THUMB); resolve(); };
    img.onerror = resolve;
    img.src     = uri;
  })));

  return canvas.toDataURL('image/jpeg', 0.82).split(',')[1];
}

export async function exportExcel() {
  if (typeof ExcelJS === 'undefined') { showToast('⚠ ExcelJS library not loaded'); return; }
  const f = sortedForExport(getFiltered());
  showToast('⏳ Building Excel — fetching images…');

  const STATUS_COLORS = {
    'In Assembly':        'FF888888',
    'Completed':          'FF3B82F6',
    'Shipped':            'FFF59E0B',
    'With Client':        'FFA855F7',
    'Installed at Venue': 'FF22C55E',
  };

  try {
    const workbook  = new ExcelJS.Workbook();
    workbook.creator = 'POP Atelier LLC';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Liberty Inventory', {
      views:     [{ state: 'frozen', ySplit: 1 }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, paperSize: 9 },
    });

    sheet.columns = [
      { header: 'DH S/N',      key: 'digitalHeader', width: 18 },
      { header: 'Controller',  key: 'controller',    width: 14 },
      { header: 'Ctrl S/N',    key: 'controllerSN',  width: 16 },
      { header: 'Router S/N',  key: 'routerSN',      width: 16 },
      { header: 'SIM Card',    key: 'simCard',        width: 13 },
      { header: 'Content',     key: 'content',        width: 16 },
      { header: 'Venue',       key: 'venueName',      width: 26 },
      { header: 'Section',     key: 'zone',           width: 16 },
      { header: 'Location',    key: 'location',       width: 30 },
      { header: 'Technician',  key: 'technician',     width: 18 },
      { header: 'Status',      key: 'status',         width: 20 },
      { header: 'Evidence',    key: 'evidence',       width: 34 },
    ];

    // ── Header row styling ─────────────────────────────────────────────────────
    const headerRow = sheet.getRow(1);
    headerRow.height = 22;
    headerRow.eachCell(cell => {
      cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF40009' } };
      cell.font      = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9, name: 'Arial' };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
      cell.border    = { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } };
    });

    // ── Data rows ──────────────────────────────────────────────────────────────
    for (let i = 0; i < f.length; i++) {
      const d      = f[i];
      const rowIdx = i + 1;   // 0-based for image anchoring (header = 0, first data = 1)

      const row = sheet.addRow({
        digitalHeader: d.digitalHeader || '—',
        controller:    d.controller    || '—',
        controllerSN:  d.controllerSN  || '—',
        routerSN:      d.routerSN      || '—',
        simCard:       d.simCard       || '—',
        content:       d.content       || '—',
        venueName:     d.venueName !== '—' ? d.venueName : (d.venue || '—'),
        zone:          d.zone          || '—',
        location:      d.location      || '—',
        technician:    d.technician    || '—',
        status:        d.status        || '—',
        evidence:      '',
      });

      row.height = 68;

      // Alternating row shading
      if (i % 2 === 0) {
        row.eachCell({ includeEmpty: true }, cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9F9F9' } };
        });
      }

      // Cell base styling
      row.eachCell({ includeEmpty: true }, cell => {
        cell.border    = { bottom: { style: 'hair', color: { argb: 'FFEEEEEE' } } };
        cell.alignment = { vertical: 'middle', wrapText: false };
        cell.font      = { name: 'Arial', size: 8 };
      });

      // Status colour
      const argb = STATUS_COLORS[d.status];
      if (argb) {
        const sc = row.getCell('status');
        sc.font  = { name: 'Arial', size: 8, color: { argb }, bold: d.status === 'Installed at Venue' };
      }

      // Evidence image — stitch thumbnails onto a canvas, embed the single JPEG
      const photos = d.photos || [];
      if (photos.length) {
        const base64 = await _stitchThumbs(photos);
        if (base64) {
          const imgId = workbook.addImage({ base64, extension: 'jpeg' });
          sheet.addImage(imgId, {
            tl:     { col: 11, row: rowIdx },
            br:     { col: 12, row: rowIdx + 1 },
            editAs: 'oneCell',
          });
        }
      }
    }

    // ── Download ───────────────────────────────────────────────────────────────
    const buffer = await workbook.xlsx.writeBuffer();
    const blob   = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a   = Object.assign(document.createElement('a'), {
      href: url, download: 'CocaCola_Liberty_Inventory.xlsx',
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showToast('✓ Excel exported');
  } catch (e) {
    showToast('⚠ Export failed — ' + e.message);
    console.error('[exportExcel]', e);
  }
}

export async function exportPDF() {
  const f = sortedForExport(getFiltered());
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
