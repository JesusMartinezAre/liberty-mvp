// ── FIREBASE INITIALIZATION ───────────────────────────────────────────────
// Initialises the Firebase app exactly once using the compat CDN globals
// (firebase-app-compat, firebase-auth-compat, firebase-firestore-compat).
// Exports the auth and db singletons used by every other module.

import { FIREBASE_CONFIG } from './config.js';
import { state } from './state.js';

if (!firebase.apps.length) {
  firebase.initializeApp(FIREBASE_CONFIG);
}

export const auth = firebase.auth();
export const db   = firebase.firestore();

// Explicitly declare LOCAL persistence (survives tab/browser close).
// This is Firebase's default, but naming it makes intent auditable and
// ensures a future refactor never accidentally switches to SESSION mode.
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
  .catch(err => console.warn('[firebase-config] setPersistence failed:', err));

// Also hang them on state so legacy call-sites that read state.db still work.
state.db   = db;
state.auth = auth;
