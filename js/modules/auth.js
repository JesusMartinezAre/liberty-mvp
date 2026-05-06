// ── AUTHENTICATION ─────────────────────────────────────────────────────────────
// Firebase SSO auth guard, sign-out, read-only mode, and legacy PIN overlay.

import { state }                       from './state.js';
import { CORRECT_PIN, EMAILJS_KEY }    from './config.js';
import { showToast }                   from './toast.js';
import { seedIfEmpty, startListener }  from './api.js';
import { auth }                        from './firebase-config.js';

// Domains allowed through the app guard — mirrors login.js DOMAIN_MAP.
const ALLOWED_DOMAINS = ['popatelier.net', 'libertycoke.com'];

function isAllowedDomain(email) {
  const domain = (email || '').split('@')[1]?.toLowerCase().trim();
  return ALLOWED_DOMAINS.includes(domain);
}

// ── FIREBASE AUTH GUARD ───────────────────────────────────────────────────────
export function initAuthGuard() {
  auth.onAuthStateChanged(async user => {
    // No session → back to login
    if (!user) {
      window.location.replace('/auth/login.html');
      return;
    }

    // Domain guard (defense-in-depth).
    // Handles the case where a stale session or a manually injected token
    // belongs to an account outside the allowed domains.
    if (!isAllowedDomain(user.email)) {
      await auth.signOut();
      window.location.replace('/auth/login.html');
      return;
    }

    state.currentUser  = user.displayName || user.email.split('@')[0];
    state.currentEmail = user.email;

    // Dismiss legacy overlays (present in old index.html builds)
    ['login-overlay', 'pin-overlay'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });

    // Boot Firestore listener exactly once per session
    if (!state._appBooted) {
      state._appBooted = true;
      seedIfEmpty().then(() => startListener());
    }
  });
}

// ── HARD SIGN-OUT ─────────────────────────────────────────────────────────────
export async function handleSignOut() {
  // 1. Destroy the Firebase session token — revokes the JWT on the server.
  await auth.signOut();

  // 2. Wipe in-memory application state. The navigation below will garbage-
  //    collect everything, but clearing explicitly prevents any brief window
  //    where a script could still read user data after the token is gone.
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

  // 3. Replace (not push) the current history entry so the Back button
  //    cannot return to the authenticated dashboard.
  window.location.replace('/auth/login.html');
}

// ── READ-ONLY GUARD ───────────────────────────────────────────────────────────
export function guardEdit() {
  if (state.isReadOnly) { showToast('🔒 View only mode'); return false; }
  return true;
}

export function enterReadOnly() {
  ['login-overlay', 'pin-overlay'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  state.currentUser  = 'Guest';
  state.currentEmail = '';
  state.isReadOnly   = true;
  document.querySelectorAll(
    '.status-step, [onclick="saveVenueAssignment()"], #loc-capture-btn, label[for="photo-input"], .import-btn, #excel-input'
  ).forEach(el => { if (el) el.style.display = 'none'; });
  showToast('👁 View only mode');
}

// ── LEGACY PIN OVERLAY ────────────────────────────────────────────────────────
// These functions back the PIN pad in index.html. Kept as-is; the overlay
// itself is instantly hidden by initAuthGuard for SSO users.

export function loginContinue() {
  const nameEl  = document.getElementById('login-name');
  const emailEl = document.getElementById('login-email');
  const errEl   = document.getElementById('login-err');
  const name    = (nameEl  ? nameEl.value  : '').trim();
  const email   = (emailEl ? emailEl.value : '').trim();
  if (!name)  { if (errEl) errEl.textContent = 'Please enter your full name.'; return; }
  if (!email || !email.includes('@')) { if (errEl) errEl.textContent = 'Please enter a valid email.'; return; }
  state.currentUser  = name;
  state.currentEmail = email;
  const lo = document.getElementById('login-overlay');
  const po = document.getElementById('pin-overlay');
  if (lo) lo.style.display = 'none';
  if (po) po.style.display = 'flex';
  const sub = document.querySelector('#pin-overlay .pin-sub');
  if (sub) sub.textContent = 'Welcome, ' + name.split(' ')[0] + ' · Enter your PIN';
}

export function pinKey(k) {
  if (state.pinEntry.length >= 4) return;
  state.pinEntry += k;
  updatePinDots();
  if (state.pinEntry.length === 4) setTimeout(checkPin, 120);
}

export function pinDel() {
  state.pinEntry = state.pinEntry.slice(0, -1);
  updatePinDots();
}

export function updatePinDots(err = false) {
  for (let i = 0; i < 4; i++) {
    const d = document.getElementById('pd' + i);
    if (!d) continue;
    d.classList.toggle('filled', i < state.pinEntry.length && !err);
    d.classList.toggle('error',  err && i < state.pinEntry.length);
  }
}

export function checkPin() {
  if (state.pinEntry === CORRECT_PIN) {
    const po = document.getElementById('pin-overlay');
    if (po) { po.style.transition = 'opacity .4s'; po.style.opacity = '0'; }
    setTimeout(() => { if (po) po.style.display = 'none'; }, 400);
    state.isReadOnly = false;
    setTimeout(() => showToast('✅ Welcome, ' + (state.currentUser.split(' ')[0] || '!')), 450);
  } else {
    updatePinDots(true);
    const msg = document.getElementById('pin-msg');
    if (msg) msg.textContent = 'Incorrect PIN';
    setTimeout(() => { state.pinEntry = ''; updatePinDots(); if (msg) msg.textContent = ''; }, 900);
  }
}

// ── EMAILJS INIT ──────────────────────────────────────────────────────────────
export function initEmailJS() {
  if (typeof emailjs !== 'undefined') emailjs.init(EMAILJS_KEY);
}
