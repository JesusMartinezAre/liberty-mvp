// ── AUTHENTICATION ─────────────────────────────────────────────────────────────
// Okta SSO auth guard, sign-out, read-only mode.

import { state }                       from './state.js';
import { EMAILJS_KEY }                 from './config.js';
import { showToast }                   from './toast.js';
import { seedIfEmpty, startListener }  from './api.js';

// ── Session token reader ──────────────────────────────────────────────────────
// Checks the SAML-backed session first (stored by saml-complete.html), then
// falls back to the Okta SDK token for the OIDC path. Both are bearer tokens
// accepted by /api/me with no changes to the Authorization header logic.
const OKTA_STORAGE_KEY = 'okta-token-storage';
const APP_SESSION_KEY  = 'app-session';

function getSessionToken() {
  const appSession = localStorage.getItem(APP_SESSION_KEY);
  if (appSession) return appSession;

  try {
    const raw = localStorage.getItem(OKTA_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw)?.accessToken?.accessToken || null;
  } catch {
    return null;
  }
}

// ── AUTH GUARD ────────────────────────────────────────────────────────────────
export async function initAuthGuard() {
  const token = getSessionToken();

  if (!token) {
    window.location.replace('/auth/login.html');
    return;
  }

  // Token exists — hide legacy overlays immediately so they never flash.
  // We do this before the /api/me round-trip to avoid any visible delay.
  const loginOverlay = document.getElementById('login-overlay');
  const pinOverlay   = document.getElementById('pin-overlay');
  if (loginOverlay) loginOverlay.style.display = 'none';
  if (pinOverlay)   pinOverlay.style.display   = 'none';
  document.getElementById('auth-loading')?.classList.add('hidden');

  let user;
  try {
    const res = await fetch('/api/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`/api/me returned ${res.status}`);
    user = await res.json();
  } catch {
    localStorage.removeItem(OKTA_STORAGE_KEY);
    localStorage.removeItem(APP_SESSION_KEY);
    window.location.replace('/auth/login.html');
    return;
  }

  state.currentUser  = user.displayName || user.givenName || user.email?.split('@')[0] || '';
  state.currentEmail = user.email || '';

  // Boot Firestore listener exactly once per session.
  if (!state._appBooted) {
    state._appBooted = true;
    seedIfEmpty().then(() => startListener());
  }
}

// ── HARD SIGN-OUT ─────────────────────────────────────────────────────────────
export async function handleSignOut() {
  // Clear all session tokens regardless of which IdP was used.
  localStorage.removeItem(OKTA_STORAGE_KEY);
  localStorage.removeItem(APP_SESSION_KEY);

  state.DATA                   = [];
  state.currentUser            = '';
  state.currentEmail           = '';
  state.isReadOnly             = false;
  state.pinEntry               = '';
  state._appBooted             = false;
  state.currentModalId         = null;
  state.currentLightboxPhotoId = null;
  state.filterPlatform         = 'all';
  state.filterStatus           = '';
  state.filterVenue            = '';
  state.filterQ                = '';
  state.currentVenue           = 'metlife';
  state._activityAll           = [];
  state.importRows             = [];
  state.fieldMode              = false;

  // Replace (not push) so the Back button cannot return to the dashboard.
  window.location.replace('/auth/login.html');
}

// ── READ-ONLY GUARD ───────────────────────────────────────────────────────────
export function guardEdit() {
  if (state.isReadOnly) { showToast('🔒 View only mode'); return false; }
  return true;
}

export function enterReadOnly() {
  state.currentUser  = 'Guest';
  state.currentEmail = '';
  state.isReadOnly   = true;
  document.querySelectorAll(
    '.status-step, [onclick="saveVenueAssignment()"], #loc-capture-btn, label[for="photo-input"], [onclick="triggerImport()"], #excel-input'
  ).forEach(el => { if (el) el.style.display = 'none'; });
  showToast('👁 View only mode');
}

// ── EMAILJS INIT ──────────────────────────────────────────────────────────────
export function initEmailJS() {
  if (typeof emailjs !== 'undefined') emailjs.init(EMAILJS_KEY);
}
