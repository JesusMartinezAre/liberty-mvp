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

// Also hang them on state so legacy call-sites that read state.db still work.
state.db   = db;
state.auth = auth;
