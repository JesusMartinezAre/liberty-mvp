// ── MODAL / DETAIL PANEL ───────────────────────────────────────────────────────
// All unit detail modal logic: open/close, status, photos, location, venue assignment.

import { state }                                    from './state.js';
import { VENUES, ZONE_OPTIONS,
         COLLECTION, CLOUDINARY_PRESET, CLOUDINARY_UPLOAD_URL,
         EMAILJS_SERVICE, EMAILJS_TEMPLATE, NOTIFY_EMAIL } from './config.js';
import { showToast }                                from './toast.js';
import { safeUpdate }                               from './api.js';
import { renderAll, statusConfig }                  from './render.js';

// ── OPEN / CLOSE ──────────────────────────────────────────────────────────────
export function openModal(id) {
  const d = state.DATA.find(x => x.id === id);
  if (!d) return;
  state.currentModalId = id;

  document.getElementById('m-title').textContent = d.model;
  const cb = document.getElementById('m-ctrl-badge');
  cb.textContent = d.controller;
  cb.className = `modal-ctrl-badge ${d.platform}`;

  const isInstalled = d.installed === true;
  const btnIn  = document.getElementById('btn-installed');
  const btnOut = document.getElementById('btn-not-installed');
  const green  = { background: 'rgba(34,197,94,.2)', color: 'var(--s4)', borderColor: 'var(--s4)' };
  const gray   = { background: 'rgba(85,85,85,.2)',  color: 'var(--s0)', borderColor: 'var(--s0)' };
  if (btnIn)  { btnIn.classList.toggle('current', isInstalled);   Object.assign(btnIn.style,  isInstalled  ? green : { background:'', color:'', borderColor:'' }); }
  if (btnOut) { btnOut.classList.toggle('current', !isInstalled);  Object.assign(btnOut.style, !isInstalled ? gray  : { background:'', color:'', borderColor:'' }); }

  const setF = (elId, v) => {
    const el    = document.getElementById(elId);
    const empty = !v || v === '—';
    el.textContent = empty ? '—' : v;
    el.className   = 'field-val' + (empty ? ' pending' : '');
  };
  document.getElementById('m-dh').textContent   = d.digitalHeader;
  document.getElementById('m-ctrl').textContent = d.controller;
  setF('m-ctrl-sn',    d.controllerSN);
  setF('m-router',     d.routerSN);
  setF('m-sim',        d.simCard);

  const locEl    = document.getElementById('m-loc');
  const coordsEl = document.getElementById('m-coords');
  const mapsLink = document.getElementById('m-maps-link');
  const clearBtn = document.getElementById('loc-clear-btn');
  const captureBtn = document.getElementById('loc-capture-btn');
  if (d.lat && d.lng) {
    locEl.textContent     = d.location && d.location !== '—' ? d.location : 'Location captured';
    locEl.className       = 'field-val';
    coordsEl.textContent  = `${parseFloat(d.lat).toFixed(6)}°, ${parseFloat(d.lng).toFixed(6)}°`;
    coordsEl.style.display = 'block';
    mapsLink.href         = `https://maps.google.com/maps?daddr=${d.lat},${d.lng}&dirflg=w`;
    mapsLink.style.display = 'flex';
    if (clearBtn)    clearBtn.style.display   = 'flex';
    if (captureBtn)  captureBtn.textContent   = '📍 Update Location';
  } else {
    locEl.textContent      = d.location && d.location !== '—' ? d.location : '—';
    locEl.className        = 'field-val' + (!d.location || d.location === '—' ? ' pending' : '');
    coordsEl.style.display = 'none';
    mapsLink.style.display = 'none';
    if (clearBtn)    clearBtn.style.display  = 'none';
    if (captureBtn)  captureBtn.textContent  = '📍 Capture Location';
  }

  document.getElementById('m-bottler').textContent = d.bottler;
  setF('m-section',    d.zone);
  setF('m-technician', d.technician);
  setF('m-content',    d.content);
  const notesEl = document.getElementById('m-notes');
  notesEl.textContent = d.notes || '—';
  notesEl.className   = 'field-val' + (!d.notes ? ' pending' : '');

  const venueSel = document.getElementById('m-venue-sel');
  const zoneSel  = document.getElementById('m-zone-sel');
  venueSel.value = (d.venue && d.venue !== '—') ? d.venue : '';
  updateZoneOptions();
  setTimeout(() => { if (d.venueArea) zoneSel.value = d.venueArea; }, 50);

  const sc = statusConfig(d.status);
  const sv = document.getElementById('m-status-val');
  if (sv) { sv.textContent = d.status; sv.style.color = sc.color; }

  document.getElementById('overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  _renderPhotos(d.photos);
  _renderChangelog(d.changeHistory);
}

export function closeModal() {
  document.getElementById('overlay').classList.remove('open');
  document.body.style.overflow = '';
  state.currentModalId = null;
}

export function closeOverlay(e) {
  if (e.target === document.getElementById('overlay')) closeModal();
}

// ── CHANGELOG ─────────────────────────────────────────────────────────────────
function _renderChangelog(entries) {
  const el = document.getElementById('m-changelog');
  if (!el) return;
  if (!entries?.length) {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:10px;font-family:var(--mono);padding:4px 0">No history yet</div>';
    return;
  }
  el.innerHTML = entries.slice().reverse().slice(0, 8).map(v => `
    <div style="display:flex;align-items:flex-start;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)">
      <div style="width:5px;height:5px;border-radius:50%;background:var(--red);flex-shrink:0;margin-top:5px"></div>
      <div style="font-size:10px;font-family:var(--mono);color:var(--text-sub);line-height:1.4">${v}</div>
    </div>`).join('');
}

// ── STATUS ────────────────────────────────────────────────────────────────────
export function setInstalled(installed) {
  if (state.isReadOnly) { showToast('🔒 View only mode'); return; }
  if (!state.currentModalId) return;
  const d = state.DATA.find(x => x.id === state.currentModalId);
  if (!d) return;

  if ((d.installed === true) === installed) return;

  if (installed) {
    const existing = d.technician && d.technician !== '—' ? d.technician : (state.currentUser || '');
    document.getElementById('tech-name-input').value = existing;
    document.getElementById('tech-modal').style.display = 'flex';
  } else {
    if (!confirm('Mark this unit as Not Installed?')) return;
    _confirmInstall(false, null);
  }
}

async function _confirmInstall(installed, technician) {
  const newStatus = installed ? 'Installed at Venue' : 'Not Installed';
  const btnIn  = document.getElementById('btn-installed');
  const btnOut = document.getElementById('btn-not-installed');
  if (btnIn)  { btnIn.classList.toggle('current', installed);   btnIn.style.background  = installed  ? 'rgba(34,197,94,.2)' : ''; btnIn.style.color  = installed  ? 'var(--s4)' : ''; btnIn.style.borderColor  = installed  ? 'var(--s4)' : ''; }
  if (btnOut) { btnOut.classList.toggle('current', !installed);  btnOut.style.background = !installed ? 'rgba(85,85,85,.2)'  : ''; btnOut.style.color = !installed ? 'var(--s0)' : ''; btnOut.style.borderColor = !installed ? 'var(--s0)' : ''; }
  const sv = document.getElementById('m-status-val');
  if (sv) { sv.textContent = newStatus; sv.style.color = installed ? 'var(--s4)' : 'var(--s0)'; }

  const ts = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const updateData = {
    installed,
    updatedBy:      state.currentUser  || 'Unknown',
    updatedByEmail: state.currentEmail || '',
    updatedAt:      firebase.firestore.FieldValue.serverTimestamp(),
    [`log_${Date.now()}`]: `${newStatus} — ${technician || state.currentUser || '—'} · ${ts}`,
  };
  if (technician) updateData.technician = technician;

  const d = state.DATA.find(x => x.id === state.currentModalId);
  if (d) { d.installed = installed; d.status = newStatus; if (technician) d.technician = technician; }

  try {
    await safeUpdate(state.currentModalId, updateData);
    showToast(`✓ ${newStatus}`);
    if (installed) {
      const d2 = state.DATA.find(x => x.id === state.currentModalId);
      if (d2) setTimeout(() => sendInstallNotification(d2), 1500);
    }
  } catch (e) {
    showToast('⚠ Update failed');
    console.error(e);
  }
}

// ── EMAIL NOTIFICATION ────────────────────────────────────────────────────────
export async function sendInstallNotification(unit) {
  try {
    if (typeof emailjs === 'undefined') { console.warn('EmailJS not loaded'); return; }
    const ts        = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const installed = state.DATA.filter(d => d.status === 'Installed at Venue').length;
    const msg       = `Unit installed at POS\n\nSerial: ${unit.digitalHeader}\nModel: ${unit.model}\nVenue: ${unit.venue || '—'}\nZone: ${unit.venueArea || '—'}\nSection: ${unit.section || '—'}\nLocation: ${unit.location || '—'}\nTechnician: ${unit.technician || '—'}\nTime: ${ts}\n\nProgress: ${installed}/${state.DATA.length} units installed`;
    const result    = await emailjs.send(EMAILJS_SERVICE, EMAILJS_TEMPLATE, {
      title:   `✅ Installed — ${unit.digitalHeader}`,
      name:    unit.technician || 'Field Tech',
      time:    ts,
      message: msg,
      email:   NOTIFY_EMAIL,
    });
    console.log('Email sent:', result.status, result.text);
    showToast('📧 Notification sent');
  } catch (e) {
    console.error('Email failed:', e);
    showToast('⚠ Email: ' + (e.text || e.message || JSON.stringify(e)));
  }
}

// ── TECH CONFIRMATION MODAL ───────────────────────────────────────────────────
export function confirmTechModal() {
  const name = document.getElementById('tech-name-input').value.trim() || 'Not specified';
  document.getElementById('tech-modal').style.display = 'none';
  if (!state.currentModalId) return;
  _confirmInstall(true, name);
}

export function cancelTechModal() {
  document.getElementById('tech-modal').style.display = 'none';
}

// ── VENUE / ZONE ASSIGNMENT ───────────────────────────────────────────────────
export function updateZoneOptions() {
  const venue   = document.getElementById('m-venue-sel').value;
  const zoneSel = document.getElementById('m-zone-sel');
  if (!venue) {
    zoneSel.innerHTML = '<option value="">— Select venue first —</option>';
    return;
  }
  const opts = ZONE_OPTIONS[venue] || [];
  zoneSel.innerHTML = '<option value="">— Select zone —</option>' +
    opts.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
}

export async function saveVenueAssignment() {
  if (!state.currentModalId) { showToast('No unit selected'); return; }
  const venue = document.getElementById('m-venue-sel').value;
  const zone  = document.getElementById('m-zone-sel').value;

  const btn = document.querySelector('[onclick="saveVenueAssignment()"]');
  if (btn) { btn.textContent = '⏳ Saving…'; btn.disabled = true; }

  const isUnassigning = !venue;
  if (isUnassigning) {
    try {
      const tech = state.currentUser || 'Unknown';
      await state.db.collection(COLLECTION).doc(state.currentModalId).update({
        venue:           firebase.firestore.FieldValue.delete(),
        venueArea:       firebase.firestore.FieldValue.delete(),
        unassignedAt:    firebase.firestore.FieldValue.serverTimestamp(),
        unassignedBy:    tech,
        updatedBy:       state.currentUser  || 'Unknown',
        updatedByEmail:  state.currentEmail || '',
        updatedAt:       firebase.firestore.FieldValue.serverTimestamp(),
      });
      await state.db.collection(COLLECTION).doc(state.currentModalId).collection('history').add({
        action: 'venue_unassigned', by: tech,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        note: 'Removed from venue assignment',
      });
      showToast('✓ Removed from venue · ' + tech);
      const d = state.DATA.find(x => x.id === state.currentModalId);
      if (d) { delete d.venue; delete d.venueArea; }
      if (btn) { btn.textContent = '📍 Save Location Assignment'; btn.disabled = false; }
    } catch (e) {
      showToast('⚠ Could not save: ' + e.message);
      if (btn) { btn.textContent = '📍 Save Location Assignment'; btn.disabled = false; }
    }
    return;
  }

  if (!zone) { showToast('⚠ Select a zone'); if (btn) { btn.disabled = false; btn.textContent = '📍 Save Location Assignment'; } return; }

  try {
    const tech = state.currentUser || 'Unknown';
    await state.db.collection(COLLECTION).doc(state.currentModalId).update({
      venue, venueArea: zone,
      updatedBy:      state.currentUser  || 'Unknown',
      updatedByEmail: state.currentEmail || '',
      updatedAt:      firebase.firestore.FieldValue.serverTimestamp(),
    });
    await state.db.collection(COLLECTION).doc(state.currentModalId).collection('history').add({
      action: 'venue_assigned', venue, venueArea: zone, by: tech,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    });
    const venueName = VENUES[venue]?.name?.split('—')[0].trim() || venue;
    showToast('✓ ' + venueName + ' · ' + zone);
    const d = state.DATA.find(x => x.id === state.currentModalId);
    if (d) { d.venue = venue; d.venueArea = zone; }
    if (btn) { btn.textContent = '📍 Save Location Assignment'; btn.disabled = false; }
  } catch (e) {
    showToast('⚠ Could not save: ' + e.message);
    console.error(e);
    if (btn) { btn.textContent = '📍 Save Location Assignment'; btn.disabled = false; }
  }
}

// ── GPS LOCATION ──────────────────────────────────────────────────────────────
export async function captureLocation() {
  if (!state.currentModalId) { showToast('No unit selected'); return; }
  const btn      = document.getElementById('loc-capture-btn');
  const locEl    = document.getElementById('m-loc');
  const coordsEl = document.getElementById('m-coords');
  const mapsLink = document.getElementById('m-maps-link');

  btn.textContent = '⏳ Getting GPS…';
  btn.style.opacity = '.5';
  btn.disabled = true;

  if (!navigator.geolocation) {
    showToast('⚠ Geolocation not supported');
    btn.textContent = '📍 Capture Location';
    btn.style.opacity = '1'; btn.disabled = false;
    return;
  }

  navigator.geolocation.getCurrentPosition(async pos => {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const acc = Math.round(pos.coords.accuracy);

    locEl.textContent     = 'Getting address…';
    locEl.className       = 'field-val';
    coordsEl.textContent  = `${lat.toFixed(6)}°, ${lng.toFixed(6)}° · ±${acc}m`;
    coordsEl.style.display = 'block';
    mapsLink.href         = `https://maps.google.com/maps?daddr=${lat},${lng}&dirflg=w`;
    mapsLink.style.display = 'flex';

    let address = '—';
    try {
      const r   = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`);
      const geo = await r.json();
      if (geo && geo.display_name) {
        address = geo.display_name.split(',').slice(0, 4).map(s => s.trim()).join(', ');
      }
    } catch { address = `${lat.toFixed(4)}, ${lng.toFixed(4)}`; }

    locEl.textContent = address;

    try {
      await safeUpdate(state.currentModalId, {
        lat: lat.toString(), lng: lng.toString(),
        location: address, locationAccuracy: acc,
        locationCapturedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      showToast('📍 Location saved');
    } catch (e) { showToast('⚠ Could not save location'); console.error(e); }

    btn.textContent = '📍 Update Location';
    btn.style.opacity = '1'; btn.disabled = false;
    const cb = document.getElementById('loc-clear-btn');
    if (cb) cb.style.display = 'flex';

  }, err => {
    const msgs = { 1: 'Permission denied', 2: 'Position unavailable', 3: 'Timeout' };
    showToast('⚠ ' + (msgs[err.code] || 'GPS error'));
    btn.textContent = '📍 Capture Location';
    btn.style.opacity = '1'; btn.disabled = false;
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
}

export async function clearLocation() {
  if (!state.currentModalId) { showToast('No unit selected'); return; }
  if (!confirm('Clear GPS location for this header?\n\nThis will remove the captured address and coordinates.')) return;

  const locEl    = document.getElementById('m-loc');
  const coordsEl = document.getElementById('m-coords');
  const mapsLink = document.getElementById('m-maps-link');
  const clearBtn = document.getElementById('loc-clear-btn');
  const captureBtn = document.getElementById('loc-capture-btn');

  try {
    await safeUpdate(state.currentModalId, {
      lat:                  firebase.firestore.FieldValue.delete(),
      lng:                  firebase.firestore.FieldValue.delete(),
      location:             '—',
      locationAccuracy:     firebase.firestore.FieldValue.delete(),
      locationCapturedAt:   firebase.firestore.FieldValue.delete(),
    });
    locEl.textContent      = '—';
    locEl.className        = 'field-val pending';
    coordsEl.style.display = 'none';
    mapsLink.style.display = 'none';
    if (clearBtn)   clearBtn.style.display  = 'none';
    if (captureBtn) captureBtn.textContent  = '📍 Capture Location';
    showToast('🗑 Location cleared');
  } catch (e) { showToast('⚠ Could not clear location'); console.error(e); }
}

// ── PHOTO EVIDENCE ────────────────────────────────────────────────────────────
export async function uploadPhoto(e) {
  if (!state.currentModalId) { showToast('No unit selected'); return; }
  const file = e.target.files[0];
  if (!file) return;

  document.getElementById('photo-uploading').style.display = 'block';
  document.getElementById('photo-input').value = '';

  try {
    const compressed = await compressImage(file, 1200, 0.75);
    const formData   = new FormData();
    formData.append('file',           compressed);
    formData.append('upload_preset',  CLOUDINARY_PRESET);
    formData.append('folder',         `liberty/${state.currentModalId}`);
    formData.append('public_id',      `${state.currentModalId}_${Date.now()}`);

    const res = await fetch(CLOUDINARY_UPLOAD_URL, { method: 'POST', body: formData });
    if (!res.ok) throw new Error('Upload failed');
    const data = await res.json();

    await state.db.collection(COLLECTION).doc(state.currentModalId).collection('photos').add({
      url:        data.secure_url,
      publicId:   data.public_id,
      width:      data.width,
      height:     data.height,
      bytes:      data.bytes,
      uploadedAt: firebase.firestore.FieldValue.serverTimestamp(),
      unit:       state.currentModalId,
    });
    showToast('✓ Photo uploaded');
    _renderPhotos(state.DATA.find(x => x.id === state.currentModalId)?.photos || []);
  } catch (err) {
    showToast('⚠ Upload failed');
    console.error(err);
  } finally {
    document.getElementById('photo-uploading').style.display = 'none';
  }
}

export function compressImage(file, maxWidth, quality) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(blob => resolve(blob), 'image/jpeg', quality);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function _renderPhotos(photos) {
  const grid = document.getElementById('photo-grid');
  if (!grid) return;
  if (!photos?.length) {
    grid.innerHTML = '<div id="photo-empty" style="grid-column:span 3;text-align:center;padding:20px;color:var(--text-muted);font-size:11px">No photos yet</div>';
    return;
  }
  grid.innerHTML = photos.map(p => {
    const url   = typeof p === 'string' ? p : p.url;
    const thumb = url.replace('/upload/', '/upload/w_200,h_200,c_fill,q_auto/');
    const ts    = p.uploadedAt?.toDate
      ? p.uploadedAt.toDate().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : (typeof p.uploadedAt === 'string' ? p.uploadedAt : '');
    return `
      <div onclick="openLightbox('${url}','${p.id || ''}','${ts}')" style="
        aspect-ratio:1;border-radius:8px;overflow:hidden;cursor:pointer;
        background:var(--surface);border:1px solid var(--border);position:relative">
        <img src="${thumb}" style="width:100%;height:100%;object-fit:cover"
             loading="lazy" onerror="this.parentElement.style.background='var(--card)'">
        <div style="
          position:absolute;bottom:0;left:0;right:0;
          background:linear-gradient(transparent,rgba(0,0,0,.7));
          padding:4px 4px 3px;font-size:7px;color:rgba(255,255,255,.7);font-family:var(--mono)">${ts}</div>
      </div>`;
  }).join('');
}

export function openLightbox(url, photoDocId, info) {
  state.currentLightboxPhotoId = photoDocId;
  document.getElementById('lightbox-img').src = url;
  document.getElementById('lightbox-info').textContent = info;
  document.getElementById('lightbox').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

export function closeLightbox() {
  document.getElementById('lightbox').style.display = 'none';
  document.getElementById('lightbox-img').src = '';
  document.body.style.overflow = '';
  state.currentLightboxPhotoId = null;
}

export async function deletePhoto(e) {
  e.stopPropagation();
  if (!state.currentLightboxPhotoId || !state.currentModalId) return;
  if (!confirm('Delete this photo?')) return;
  try {
    await state.db.collection(COLLECTION).doc(state.currentModalId)
      .collection('photos').doc(state.currentLightboxPhotoId).delete();
    closeLightbox();
    _renderPhotos(state.DATA.find(x => x.id === state.currentModalId)?.photos || []);
    showToast('✓ Photo deleted');
  } catch (err) { showToast('⚠ Could not delete'); console.error(err); }
}

// ── FIELD MODE ────────────────────────────────────────────────────────────────
export function toggleFieldMode() {
  state.fieldMode = !state.fieldMode;
  const btn = document.querySelector('[onclick="toggleFieldMode()"]');
  if (state.fieldMode) {
    document.body.classList.add('field-mode');
    if (btn) { btn.style.background = 'var(--red-dim)'; btn.textContent = '⚡ Field ON'; }
    showToast('⚡ Field mode — simplified view');
  } else {
    document.body.classList.remove('field-mode');
    if (btn) { btn.style.background = ''; btn.textContent = '⚡ Field'; }
    showToast('Field mode off');
  }
}

// ── SINGLE-UNIT EXPORT ────────────────────────────────────────────────────────
export async function exportUnitExcel() {
  if (!state.currentModalId) { showToast('No unit selected'); return; }
  const d = state.DATA.find(x => x.id === state.currentModalId);
  if (!d) return;
  showToast('⏳ Preparing export…');

  let photoUrls = [];
  try {
    const snap = await state.db.collection(COLLECTION).doc(state.currentModalId)
      .collection('photos').orderBy('uploadedAt', 'desc').get();
    photoUrls = snap.docs.map(doc => doc.data().url);
  } catch {}

  const rows = [
    ['Field', 'Value'],
    ['Digital Header S/N', d.digitalHeader || '—'],
    ['Model',              d.model          || '—'],
    ['Controller',         d.controller     || '—'],
    ['Controller S/N',     d.controllerSN   || '—'],
    ['Router S/N',         d.routerSN       || '—'],
    ['SIM Card',           d.simCard        || '—'],
    ['IP Address',         d.ipAddress      || '—'],
    ['MAC Address',        d.macAddress     || '—'],
    ['Content',            d.content        || '—'],
    ['Venue',              d.venue          || '—'],
    ['Zone',               d.venueArea      || '—'],
    ['Section',            d.section        || '—'],
    ['Location',           d.location       || '—'],
    ['Coordinates',        d.lat ? `${d.lat}, ${d.lng}` : '—'],
    ['Technician',         d.technician     || '—'],
    ['Notes',              d.notes          || '—'],
    ['Bottler',            d.bottler        || '—'],
    ['Status',             d.status         || '—'],
    ['', ''],
    ['PHOTO EVIDENCE', ''],
    ...photoUrls.map((url, i) => [`Photo ${i + 1}`, url]),
    ...(photoUrls.length === 0 ? [['—', 'No photos uploaded']] : []),
  ];

  const ws  = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 20 }, { wch: 80 }];
  ['A1', 'B1'].forEach(cell => {
    if (ws[cell]) ws[cell].s = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: 'F40009' } } };
  });
  const photoHeaderRow = rows.findIndex(r => r[0] === 'PHOTO EVIDENCE') + 1;
  const photoCell      = `A${photoHeaderRow}`;
  if (ws[photoCell]) ws[photoCell].s = { font: { bold: true, color: { rgb: 'F40009' } } };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, d.digitalHeader);
  XLSX.writeFile(wb, `${d.digitalHeader}_Liberty.xlsx`);
  showToast('✓ Excel exported');
}

export async function exportUnitPDF() {
  if (!state.currentModalId) { showToast('No unit selected'); return; }
  const d = state.DATA.find(x => x.id === state.currentModalId);
  if (!d) return;
  showToast('⏳ Loading photos…');

  let photos = [];
  try {
    const snap = await state.db.collection(COLLECTION).doc(state.currentModalId)
      .collection('photos').orderBy('uploadedAt', 'asc').get();
    photos = snap.docs.map(doc => {
      const p  = doc.data();
      const ts = p.uploadedAt?.toDate ? p.uploadedAt.toDate().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      return { url: p.url.replace('/upload/', '/upload/w_400,q_85/'), ts };
    });
  } catch {}

  const sc          = statusConfig(d.status);
  const statusColor = sc.color
    .replace('var(--s0)', '#888').replace('var(--s1)', '#3b82f6')
    .replace('var(--s2)', '#f59e0b').replace('var(--s3)', '#a855f7').replace('var(--s4)', '#22c55e');

  const fields = [
    ['Digital Header S/N', d.digitalHeader],
    ['Model',              d.model],
    ['Controller',         d.controller],
    ['Controller S/N',     d.controllerSN  || '—'],
    ['Router S/N',         d.routerSN      || '—'],
    ['SIM Card',           d.simCard       || '—'],
    ['IP Address',         d.ipAddress     || '—'],
    ['MAC Address',        d.macAddress    || '—'],
    ['Content',            d.content       || '—'],
    ['Venue',              d.venue         || '—'],
    ['Zone',               d.venueArea     || '—'],
    ['Section',            d.section       || '—'],
    ['Location',           d.location      || '—'],
    ['Coordinates',        d.lat ? `${parseFloat(d.lat).toFixed(6)}°, ${parseFloat(d.lng).toFixed(6)}°` : '—'],
    ['Technician',         d.technician    || '—'],
    ['Notes',              d.notes         || '—'],
    ['Bottler',            d.bottler],
  ];

  const rows     = fields.map(([k, v]) => `
    <tr>
      <td style="font-weight:600;color:#555;width:160px;padding:7px 10px;border-bottom:1px solid #f0f0f0;font-size:10px;text-transform:uppercase;letter-spacing:.5px">${k}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;font-size:11px;color:#111">${v || '—'}</td>
    </tr>`).join('');
  const mapsUrl  = d.lat ? `https://maps.google.com/maps?daddr=${d.lat},${d.lng}&dirflg=w` : null;
  const photoGrid = photos.length > 0
    ? `<div style="margin-top:20px">
        <div style="font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#F40009;margin-bottom:10px">Photo Evidence (${photos.length})</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
          ${photos.map(p => `
            <div style="break-inside:avoid">
              <img src="${p.url}" style="width:100%;border-radius:6px;border:1px solid #eee" crossorigin="anonymous">
              <div style="font-size:8px;color:#aaa;margin-top:3px;text-align:center">${p.ts}</div>
            </div>`).join('')}
        </div></div>`
    : '<div style="margin-top:16px;padding:12px;background:#f9f9f9;border-radius:6px;font-size:10px;color:#aaa;text-align:center">No photos uploaded</div>';

  const htmlContent = `<!DOCTYPE html><html><head>
    <title>${d.digitalHeader} — Coca-Cola Liberty</title>
    <style>
      @page{size:A4;margin:15mm}
      body{font-family:Arial,sans-serif;color:#111;margin:0;padding:20px}
      .header{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;padding-bottom:14px;border-bottom:3px solid #F40009}
      .title{font-size:20px;font-weight:800;color:#111;letter-spacing:.5px}
      .subtitle{font-size:11px;color:#888;margin-top:3px}
      .status-badge{padding:5px 14px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;background:${statusColor}22;color:${statusColor};border:1.5px solid ${statusColor}}
      table{width:100%;border-collapse:collapse;margin-bottom:16px}
      .maps-link{display:inline-block;margin-top:10px;padding:8px 16px;background:#e8f0fe;color:#1a73e8;border-radius:6px;text-decoration:none;font-size:11px;font-weight:600}
      .footer{margin-top:20px;padding-top:10px;border-top:1px solid #eee;font-size:9px;color:#aaa;display:flex;justify-content:space-between}
      img{max-width:100%}
    </style>
  </head><body>
    <div class="header">
      <div>
        <div class="title">${d.digitalHeader}</div>
        <div class="subtitle">Coca-Cola Liberty · Digital Display Inventory · FIFA World Cup 2026</div>
      </div>
      <div class="status-badge">${d.status}</div>
    </div>
    <table>${rows}</table>
    ${mapsUrl ? `<a href="${mapsUrl}" class="maps-link">🗺 Open in Google Maps (Walking)</a>` : ''}
    ${photoGrid}
    <div class="footer">
      <span>Generated: ${new Date().toLocaleString()}</span>
      <span>POP Atelier LLC · popatelier.net</span>
    </div>
    <script>
      window.onload = () => {
        const imgs = document.querySelectorAll('img');
        if (!imgs.length) { window.print(); return; }
        let loaded = 0;
        imgs.forEach(img => {
          if (img.complete) { loaded++; if (loaded === imgs.length) window.print(); }
          else { img.onload = img.onerror = () => { loaded++; if (loaded === imgs.length) window.print(); }; }
        });
      };
    <\/script>
  </body></html>`;

  const blob    = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);
  const a       = document.createElement('a');
  a.href        = blobUrl;
  a.target      = '_blank';
  a.download    = `${d.digitalHeader}_Liberty.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
  showToast('✓ PDF ready — open and print');
}

// ── TEST EMAIL ────────────────────────────────────────────────────────────────
export async function testEmail() {
  showToast('⏳ Sending test email…');
  try {
    if (typeof emailjs === 'undefined') { showToast('❌ EmailJS failed to load'); return; }
    const result = await emailjs.send(EMAILJS_SERVICE, EMAILJS_TEMPLATE, {
      title:   '✅ Test — POPA Liberty App',
      name:    'Test POPA',
      time:    new Date().toLocaleString(),
      message: 'Test email from Coca-Cola Liberty Digital Display Inventory.',
      email:   NOTIFY_EMAIL,
    });
    showToast('✅ Email sent! Status: ' + result.status);
  } catch (e) {
    showToast('❌ Error: ' + (e.text || e.message || JSON.stringify(e)));
  }
}
