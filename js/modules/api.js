// ── FIRESTORE DATA LAYER ───────────────────────────────────────────────────────
// Real-time listener, write path, and offline queue.
// Reads come from dataService.js (multi-collection join).
// Writes target the relational schema: players + evidence_players.

import { state }                from './state.js';
import { OFFLINE_KEY }          from './config.js';
import { showToast }            from './toast.js';
import { renderAll }            from './render.js';
import { subscribeToInventory } from './dataService.js';

// ── REAL-TIME LISTENER ────────────────────────────────────────────────────────
export function startListener() {
  return subscribeToInventory(items => {
    state.DATA = items;
    renderAll();
  });
}

// ── SEED STUB ─────────────────────────────────────────────────────────────────
// Seeding now happens directly in Firestore (players / venues collections).
// Stub kept so auth.js call site requires no change.
export async function seedIfEmpty() {}

// ── FIELD ROUTING ─────────────────────────────────────────────────────────────
// Fields that belong to evidence_players; everything else goes to players.
const EVIDENCE_FIELDS = new Set(['photos', 'notes', 'changeHistory']);

// Legacy flat-format field names that differ from the new schema field names.
const TO_PLAYER_FIELD = {
  model: 'product',  // legacy.model → players.product
  venue: 'venueId',  // legacy.venue → players.venueId (slug is the ref)
};

// ── RELATIONAL WRITE ──────────────────────────────────────────────────────────
// Splits a flat legacy update object into players + evidence_players and
// commits both as a single atomic batch.
//
// The evidence query (finding the doc by playerId) runs before the batch so
// the ref is resolved — Firestore batch writes require known refs up front.
async function _writeToRelational(docId, data) {
  const db = state.db;
  const ts = firebase.firestore.FieldValue.serverTimestamp();

  const playerFields   = {};
  const evidenceFields = {};

  for (const [k, v] of Object.entries(data)) {
    if (EVIDENCE_FIELDS.has(k)) {
      evidenceFields[k] = v;
    } else {
      playerFields[TO_PLAYER_FIELD[k] ?? k] = v;
    }
  }

  // Derive the boolean installed flag from the pipeline status string.
  if (playerFields.status !== undefined) {
    playerFields.installed = playerFields.status === 'Installed at Venue';
  }

  playerFields.updatedAt = ts;

  // ── Resolve evidence ref before opening the batch ──────────────────────────
  let evRef  = null;
  let evIsNew = false;

  if (Object.keys(evidenceFields).length > 0) {
    const evSnap = await db.collection('evidence_players')
      .where('playerId', '==', docId)
      .limit(1)
      .get();

    if (evSnap.empty) {
      evRef   = db.collection('evidence_players').doc(); // auto-ID
      evIsNew = true;
    } else {
      evRef = evSnap.docs[0].ref;
    }

    evidenceFields.playerId  = docId;
    evidenceFields.updatedAt = ts;
  }

  // ── Atomic batch ──────────────────────────────────────────────────────────
  const batch = db.batch();

  batch.update(db.collection('players').doc(docId), playerFields);

  if (evRef) {
    if (evIsNew) {
      batch.set(evRef, evidenceFields);
    } else {
      batch.update(evRef, evidenceFields);
    }
  }

  await batch.commit();
}

// ── SAFE UPDATE ───────────────────────────────────────────────────────────────
export async function safeUpdate(docId, data) {
  const offlineData = { ...data };
  delete offlineData.updatedAt;
  delete offlineData.locationCapturedAt;

  if (!navigator.onLine) {
    const q = getQueue();
    q.push({ docId, data: offlineData, ts: Date.now() });
    saveQueue(q);
    // Optimistic in-memory update so the UI reflects the change immediately.
    const d = state.DATA.find(x => x.id === docId);
    if (d) Object.assign(d, offlineData);
    showToast('📶 Saved offline — will sync when online');
    return;
  }

  await _writeToRelational(docId, data);
}

// ── OFFLINE QUEUE ─────────────────────────────────────────────────────────────
export function getQueue() {
  try { return JSON.parse(localStorage.getItem(OFFLINE_KEY) || '[]'); } catch { return []; }
}

export function saveQueue(q) {
  localStorage.setItem(OFFLINE_KEY, JSON.stringify(q));
}

export async function syncOfflineQueue() {
  const q = getQueue();
  if (!q.length) return;
  showToast(`🔄 Syncing ${q.length} offline changes…`);
  let synced = 0;
  const failed = [];
  for (const item of q) {
    try {
      await _writeToRelational(item.docId, item.data);
      synced++;
    } catch (err) {
      console.error('[api] syncOfflineQueue failed for', item.docId, err);
      failed.push(item);
    }
  }
  saveQueue(failed);
  if (synced > 0) showToast(`✓ ${synced} changes synced`);
}
