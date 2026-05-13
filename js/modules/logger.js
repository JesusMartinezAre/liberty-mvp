// ── LOGGING SERVICE ────────────────────────────────────────────────────────────
// logChange() piggybacks on safeUpdate() so the changeHistory entry is written
// to evidence_players atomically with the log_ key on players — no extra
// round-trip. The existing EVIDENCE_FIELDS routing in api.js handles splitting.

import { state }      from './state.js';
import { safeUpdate } from './api.js';

export async function logChange(docId, label, tech) {
  const ts    = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const entry = `${label} — ${tech || state.currentUser || '—'} · ${ts}`;
  const FieldValue = firebase.firestore.FieldValue;
  await safeUpdate(docId, {
    changeHistory:         FieldValue.arrayUnion(entry),
    [`log_${Date.now()}`]: entry,
  });
}

// ── DEV UTILITY ───────────────────────────────────────────────────────────────
// Console-only — no UI button. Run: maintenance_clearLogs()
// Removes all log_ fields from every players doc and resets changeHistory to []
// on every evidence_players doc. Safe to call multiple times.
export async function maintenance_clearLogs() {
  if (!confirm(
    'Delete all log_ fields from players and reset all changeHistory arrays?\n\nThis cannot be undone.'
  )) return;

  const db         = state.db;
  const FieldValue = firebase.firestore.FieldValue;

  const [playersSnap, evSnap] = await Promise.all([
    db.collection('players').get(),
    db.collection('evidence_players').get(),
  ]);

  // Clear log_ fields from players
  const playerBatch     = db.batch();
  let   logFieldsCleared = 0;
  playersSnap.forEach(doc => {
    const fields = {};
    Object.keys(doc.data()).forEach(k => {
      if (k.startsWith('log_')) { fields[k] = FieldValue.delete(); logFieldsCleared++; }
    });
    if (Object.keys(fields).length) playerBatch.update(doc.ref, fields);
  });
  await playerBatch.commit();

  // Reset changeHistory in evidence_players
  const evBatch = db.batch();
  evSnap.forEach(doc => evBatch.update(doc.ref, { changeHistory: [] }));
  await evBatch.commit();

  const msg = `✓ Cleared ${logFieldsCleared} log_ fields from ${playersSnap.size} player docs. Reset changeHistory for ${evSnap.size} evidence docs.`;
  console.log('[maintenance]', msg);
  alert(msg);
}
