// ── FIRESTORE DATA LAYER ───────────────────────────────────────────────────────
// All Firestore reads, writes, and offline queue management.

import { state }                from './state.js';
import { COLLECTION, OFFLINE_KEY } from './config.js';
import { showToast }            from './toast.js';
import { renderAll }            from './render.js';

// ── BASE DATA ─────────────────────────────────────────────────────────────────
export function buildBaseData() {
  const d = [];
  for (let i = 1; i <= 120; i++) {
    const n = String(i).padStart(4, '0');
    d.push({
      id: `ZIPDHE${n}`, digitalHeader: `ZIPDHE${n}`,
      model: 'DIGITAL HEADER EXTERIOR 29"',
      controller: 'POPA', platform: 'POPA',
      controllerSN: '—', routerSN: '—', simCard: '—', location: '—',
      ipAddress: '—', macAddress: '—', section: '—', technician: '—', content: '—', notes: '',
      bottler: 'Coca-Cola Liberty', status: 'In Assembly', updatedAt: null,
    });
  }
  for (let i = 1; i <= 30; i++) {
    const n = String(i).padStart(4, '0');
    d.push({
      id: `ZIPKDHI${n}`, digitalHeader: `ZIPKDHI${n}`,
      model: 'DIGITAL HEADER INTERIOR 29"',
      controller: 'KOS / Tier One', platform: 'KOS',
      controllerSN: '—', routerSN: '—', simCard: '—', location: '—',
      ipAddress: '—', macAddress: '—', section: '—', technician: '—', content: '—', notes: '',
      bottler: 'Coca-Cola Liberty', status: 'In Assembly', updatedAt: null,
    });
  }
  return d;
}

// ── EXCEL SEED ────────────────────────────────────────────────────────────────
export const EXCEL_SEED = [
  { "id": "ZIPDHE0088", "simCard": "94960504",  "routerSN": "RF3022533645284", "controllerSN": "S380020250801556",       "location": "NYNJ", "venue": "metlife", "content": "NYNJ" },
  { "id": "ZIPDHE0096", "simCard": "94962286",  "routerSN": "RF3022533645227", "controllerSN": "S38002020250402361",     "location": "NYNJ", "venue": "metlife", "content": "NYNJ" },
  { "id": "ZIPDHE0120", "simCard": "94961072",  "routerSN": "RF3022533645034", "controllerSN": "S38002020250402365",     "location": "NYNj", "venue": "metlife", "content": "NYNJ" },
  { "id": "ZIPDHE0010", "simCard": "94960512",  "routerSN": "RF3022533645346", "controllerSN": "S38002020250402370",     "location": "NYNJ", "venue": "metlife", "content": "NYNJ" },
  { "id": "ZIPDHE0090", "simCard": "94962252",  "routerSN": "RF3022533645235", "controllerSN": "S38002020250402373",     "location": "NYNJ", "venue": "metlife", "content": "NYNJ" },
  { "id": "ZIPDHE0027", "simCard": "94960991",  "routerSN": "RF3022530636387", "controllerSN": "S38002020250402374",     "location": "NYNJ", "venue": "metlife", "content": "NYNJ" },
  { "id": "ZIPDHE0084", "simCard": "94962237",  "routerSN": "RF3022530636565", "controllerSN": "S38002020250402377",     "location": "NYNJ", "venue": "metlife", "content": "NYNJ" },
  { "id": "ZIPDHE0025", "simCard": "94962179",  "routerSN": "RF3022533644896", "controllerSN": "S38002020250402378",     "location": "NYNJ", "venue": "metlife", "content": "NYNJ" },
  { "id": "ZIPDHE0086", "simCard": "94960538",  "routerSN": "RF3022533645287", "controllerSN": "S38002020250402061",     "location": "NYNJ", "venue": "metlife", "content": "NYNJ" },
  { "id": "ZIPDHE0005", "simCard": "94962161",  "routerSN": "RF3022533645081", "controllerSN": "S38002020250402062",     "location": "NYNJ", "venue": "metlife", "content": "NYNJ" },
  { "id": "ZIPDHE0058", "simCard": "94960710",  "routerSN": "RF3022533645121", "controllerSN": "S38002020250402074",     "location": "NYNJ", "venue": "metlife", "content": "NYNJ" },
  { "id": "ZIPDHE0112", "simCard": "94960595",  "routerSN": "RF3022533645250", "controllerSN": "S38002020250402076",     "location": "—",    "venue": "—",       "content": "—"    },
  { "id": "ZIPDHE0070", "simCard": "94960918",  "routerSN": "RF3022530636379", "controllerSN": "S38002020250402463",     "location": "NYNJ", "venue": "metlife", "content": "NYNJ" },
  { "id": "ZIPDHE0113", "simCard": "94962245",  "routerSN": "RF3022533645268", "controllerSN": "S38002020250402465",     "location": "NYNJ", "venue": "metlife", "content": "NYNJ" },
  { "id": "ZIPDHE0021", "simCard": "94926153",  "routerSN": "RF3022533645036", "controllerSN": "S38002020250402466",     "location": "—",    "venue": "—",       "content": "—"    },
  { "id": "ZIPDHE0020", "simCard": "94960728",  "routerSN": "RF3022533644906", "controllerSN": "S38002020250402467",     "location": "—",    "venue": "—",       "content": "—"    },
  { "id": "ZIPDHE0008", "simCard": "94960983",  "routerSN": "RF3022530636249", "controllerSN": "S38002020250402468",     "location": "NYNJ", "venue": "metlife", "content": "NYNJ" },
  { "id": "ZIPDHE0098", "simCard": "94960199",  "routerSN": "RF3022533644920", "controllerSN": "S38002020250402469",     "location": "—",    "venue": "—",       "content": "—"    },
  { "id": "ZIPDHE0023", "simCard": "94960553",  "routerSN": "RF3022533645120", "controllerSN": "S38002020250402473",     "location": "—",    "venue": "—",       "content": "—"    },
  { "id": "ZIPDHE0013", "simCard": "94960660",  "routerSN": "RF3022533645256", "controllerSN": "S38002020250402475",     "location": "NYNJ", "venue": "metlife", "content": "NYNJ" },
  { "id": "ZIPDHE0034", "simCard": "94960967",  "routerSN": "RF3022533645204", "controllerSN": "S38002020250402478",     "location": "NYNJ", "venue": "metlife", "content": "NYNJ" },
  { "id": "ZIPDHE0031", "simCard": "94960520",  "routerSN": "RF3022533645276", "controllerSN": "S38002020250402479",     "location": "NYNJ", "venue": "metlife", "content": "NYNJ" },
  { "id": "ZIPDHE0055", "simCard": "94960611",  "routerSN": "RF3022533645261", "controllerSN": "S38002020250402480",     "location": "NYNJ", "venue": "metlife", "content": "NYNJ" },
];

// ── SEED FUNCTIONS ────────────────────────────────────────────────────────────
export async function applySeedData() {
  const flag = localStorage.getItem('liberty_seed_v2');
  if (flag) return;
  console.log('Applying Excel seed data...');
  const batch = state.db.batch();
  EXCEL_SEED.forEach(u => {
    const ref = state.db.collection(COLLECTION).doc(u.id);
    const upd = {};
    if (u.simCard      && u.simCard      !== '—') upd.simCard      = u.simCard;
    if (u.routerSN     && u.routerSN     !== '—') upd.routerSN     = u.routerSN;
    if (u.controllerSN && u.controllerSN !== '—') upd.controllerSN = u.controllerSN;
    if (u.location     && u.location     !== '—') upd.location     = u.location;
    if (u.venue        && u.venue        !== '—') upd.venue        = u.venue;
    if (u.content      && u.content      !== '—') upd.content      = u.content;
    if (Object.keys(upd).length) batch.update(ref, upd);
  });
  await batch.commit();
  localStorage.setItem('liberty_seed_v2', '1');
  console.log('Seed applied:', EXCEL_SEED.length, 'records');
}

export async function seedIfEmpty() {
  const snap = await state.db.collection(COLLECTION).limit(1).get();
  if (!snap.empty) return;
  showToast('Seeding 150 units…');
  const batch = state.db.batch();
  buildBaseData().forEach(u => {
    batch.set(state.db.collection(COLLECTION).doc(u.id), u);
  });
  await batch.commit();
  showToast('✓ 150 units loaded');
}

// ── REAL-TIME LISTENER ────────────────────────────────────────────────────────
export function startListener() {
  state.db.collection(COLLECTION).onSnapshot(snap => {
    state.DATA = snap.docs.map(d => {
      const data = { id: d.id, ...d.data() };
      if (data.status === 'Installed at POS') data.status = 'Installed at Venue';
      return data;
    });
    state.DATA.sort((a, b) => a.digitalHeader.localeCompare(b.digitalHeader));
    renderAll();
  }, err => {
    console.error(err);
    showToast('⚠ Firebase error');
  });
}

// ── OFFLINE QUEUE ─────────────────────────────────────────────────────────────
export function getQueue() {
  try { return JSON.parse(localStorage.getItem(OFFLINE_KEY) || '[]'); } catch (e) { return []; }
}

export function saveQueue(q) {
  localStorage.setItem(OFFLINE_KEY, JSON.stringify(q));
}

export async function safeUpdate(docId, data) {
  const offlineData = { ...data };
  delete offlineData.updatedAt;
  delete offlineData.locationCapturedAt;

  if (!navigator.onLine) {
    const q = getQueue();
    q.push({ docId, data: offlineData, ts: Date.now() });
    saveQueue(q);
    const d = state.DATA.find(x => x.id === docId);
    if (d) Object.assign(d, offlineData);
    showToast('📶 Saved offline — will sync when online');
    return;
  }
  await state.db.collection(COLLECTION).doc(docId).update({
    ...data,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
}

export async function syncOfflineQueue() {
  const q = getQueue();
  if (!q.length) return;
  showToast(`🔄 Syncing ${q.length} offline changes…`);
  let synced = 0;
  const failed = [];
  for (const item of q) {
    try {
      await state.db.collection(COLLECTION).doc(item.docId).update({
        ...item.data,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      synced++;
    } catch (e) { failed.push(item); }
  }
  saveQueue(failed);
  if (synced > 0) showToast(`✓ ${synced} changes synced`);
}
