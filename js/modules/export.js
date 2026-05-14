// ── BULK EXPORT ────────────────────────────────────────────────────────────────
// Excel and print-PDF export of the currently filtered inventory list.

import { showToast }  from './toast.js';
import { getFiltered, statusConfig } from './render.js';

export function exportExcel() {
  const f    = getFiltered();
  const rows = [
    ['Digital Header S/N','Controller','Controller S/N','Router S/N','SIM Card','IP Address','MAC Address','Content','Venue','Section','Location','Technician','Notes','Bottler','Status'],
    ...f.map(d => [
      d.digitalHeader,
      d.controller,        d.controllerSN||'—', d.routerSN||'—', d.simCard||'—',
      d.ipAddress||'—',    d.macAddress||'—',   d.content||'—',
      d.venueName||'—',    // resolved venue name
      d.zone||'—',         // zone captured in modal, shown as Section
      d.location||'—',     d.technician||'—',   d.notes||'',
      d.bottler,           d.status,
    ]),
  ];
  const ws  = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    {wch:16},{wch:18},{wch:18},{wch:18},{wch:16},{wch:14},{wch:16},{wch:16},{wch:22},{wch:16},{wch:24},{wch:16},{wch:20},{wch:22},{wch:20},
  ];
  const hdrStyle = { font: { bold: true }, fill: { fgColor: { rgb: 'F40009' } }, alignment: { horizontal: 'center' } };
  ['A1','B1','C1','D1','E1','F1','G1','H1','I1','J1','K1','L1','M1','N1','O1'].forEach(cell => {
    if (ws[cell]) ws[cell].s = hdrStyle;
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Liberty Inventory');
  XLSX.writeFile(wb, 'CocaCola_Liberty_Inventory.xlsx');
  showToast('✓ Excel exported');
}

export function exportPDF() {
  const f    = getFiltered();
  const cols = ['DH S/N','Controller','Ctrl S/N','Router S/N','SIM Card','Content','Venue','Section','Location','Technician','Status'];
  const rows = f.map(d => [
    d.digitalHeader,
    d.controller,      d.controllerSN||'—', d.routerSN||'—', d.simCard||'—',
    d.content||'—',
    d.venueName||'—',  // resolved venue name
    d.zone||'—',       // zone captured in modal, shown as Section
    d.location||'—',   d.technician||'—',  d.status,
  ]);

  const styles = `
    @page{size:landscape;margin:10mm}
    body{font-family:Arial,sans-serif;font-size:7px;color:#111;margin:8px}
    h2{font-size:12px;margin-bottom:3px;color:#F40009}
    p{font-size:8px;color:#666;margin-bottom:8px}
    table{width:100%;border-collapse:collapse}
    th{background:#F40009;color:#fff;padding:4px 5px;text-align:left;font-size:7px;letter-spacing:.4px;text-transform:uppercase;white-space:nowrap}
    td{padding:3px 5px;border-bottom:1px solid #eee;font-size:7px;white-space:nowrap}
    tr:nth-child(even) td{background:#f9f9f9}
    .s0{color:#888}.s1{color:#3b82f6}.s2{color:#f59e0b}.s3{color:#a855f7}.s4{color:#22c55e;font-weight:700}
  `;
  const sc       = s => ({'In Assembly':'s0','Completed':'s1','Shipped':'s2','With Client':'s3','Installed at Venue':'s4'}[s] || '');
  const lastIdx  = cols.length - 1;
  const thead    = '<tr>' + cols.map(c => `<th>${c}</th>`).join('') + '</tr>';
  const tbody    = rows.map(r => {
    const cells = r.map((v, i) => i === lastIdx ? `<td class="${sc(v)}">${v}</td>` : `<td>${v}</td>`).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  const htmlContent = `<!DOCTYPE html><html><head><title>Coca-Cola Liberty Inventory</title>
    <style>${styles}</style></head><body>
    <h2>Coca-Cola Liberty — Digital Display Inventory</h2>
    <p>Generated: ${new Date().toLocaleString()} · ${f.length} units</p>
    <table><thead>${thead}</thead><tbody>${tbody}</tbody></table>
    <script>window.onload=()=>{window.print();}<\/script>
    </body></html>`;

  const blob   = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);
  const a      = document.createElement('a');
  a.href       = blobUrl;
  a.target     = '_blank';
  a.download   = `Liberty_Inventory_${Date.now()}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
  showToast('✓ PDF ready to print');
}
