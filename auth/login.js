// ── SMART LOGIN — SSO ROUTING ──────────────────────────────────────────────────
// Domain → provider mapping:
//   @popatelier.net   → Google Workspace (hd-restricted)
//   @libertycoke.com  → Microsoft 365 / Azure AD
// Any other domain is rejected before touching Firebase.

import { FIREBASE_CONFIG } from '../js/modules/config.js';

// firebase is the compat CDN global loaded before this module.
if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
const auth = firebase.auth();

// ── DOMAIN → PROVIDER MAP ─────────────────────────────────────────────────────
const DOMAIN_MAP = {
  'popatelier.net':  'google',
  'libertycoke.com': 'microsoft',
};

// ── ALREADY-LOGGED-IN REDIRECT ────────────────────────────────────────────────
auth.onAuthStateChanged(user => {
  if (user && isAllowedDomain(user.email)) {
    window.location.replace('../index.html');
  }
});

// ── HELPERS ───────────────────────────────────────────────────────────────────
function extractDomain(email) {
  return (email.split('@')[1] || '').toLowerCase().trim();
}

function isAllowedDomain(email) {
  return extractDomain(email) in DOMAIN_MAP;
}

function buildProvider(domain) {
  if (DOMAIN_MAP[domain] === 'google') {
    const p = new firebase.auth.GoogleAuthProvider();
    // hd restricts the account picker to this hosted domain only.
    p.setCustomParameters({ hd: 'popatelier.net' });
    return p;
  }

  // microsoft.com — Azure AD / Microsoft 365
  const p = new firebase.auth.OAuthProvider('microsoft.com');
  p.setCustomParameters({
    prompt: 'select_account',
    // tenant: 'YOUR_AZURE_TENANT_ID',  ← add when client provides it
  });
  return p;
}

// ── PROVIDER HINT (real-time as user types) ───────────────────────────────────
const PROVIDER_META = {
  google: {
    label: 'Will sign in with Google Workspace',
    icon:  'G',
    cls:   'google',
  },
  microsoft: {
    label: 'Will sign in with Microsoft 365',
    icon:  'M',
    cls:   'microsoft',
  },
};

function updateProviderHint(email) {
  const hintEl = document.getElementById('provider-hint');
  const iconEl = document.getElementById('provider-icon');
  const textEl = document.getElementById('provider-hint-text');

  const domain   = extractDomain(email);
  const provider = DOMAIN_MAP[domain];

  if (!email.includes('@') || !provider) {
    hintEl.classList.remove('visible');
    return;
  }

  const meta      = PROVIDER_META[provider];
  iconEl.textContent = meta.icon;
  iconEl.className   = `provider-icon ${meta.cls}`;
  textEl.textContent = meta.label;
  hintEl.classList.add('visible');
}

// ── BUTTON STATE HELPERS ──────────────────────────────────────────────────────
function setLoading(providerName) {
  const btn   = document.getElementById('login-btn');
  const label = document.getElementById('btn-label');
  btn.disabled     = true;
  btn.classList.add('loading');
  label.textContent = `Opening ${providerName}…`;
}

function resetButton() {
  const btn   = document.getElementById('login-btn');
  const label = document.getElementById('btn-label');
  btn.disabled = false;
  btn.classList.remove('loading');
  label.textContent = 'Continue';
}

function showError(msg) {
  document.getElementById('login-err').textContent = msg;
}

function clearError() {
  document.getElementById('login-err').textContent = '';
}

// ── MAIN SUBMIT HANDLER ───────────────────────────────────────────────────────
async function handleContinue(e) {
  e.preventDefault();
  clearError();

  const email  = document.getElementById('login-email').value.trim().toLowerCase();

  if (!email || !email.includes('@') || !email.includes('.')) {
    showError('Please enter a valid corporate email address.');
    return;
  }

  const domain       = extractDomain(email);
  const providerType = DOMAIN_MAP[domain];

  // ── Guard 1: domain whitelist ────────────────────────────────────────────
  if (!providerType) {
    showError('Unauthorized domain. Please use your corporate email.');
    return;
  }

  const providerLabel = providerType === 'google' ? 'Google' : 'Microsoft';
  setLoading(providerLabel);

  try {
    const provider = buildProvider(domain);
    const result   = await auth.signInWithPopup(provider);
    const user     = result.user;

    // ── Guard 2: post-login domain check (defense-in-depth) ──────────────
    // Catches edge cases where the SSO popup was used with a different account.
    if (!isAllowedDomain(user.email)) {
      await auth.signOut();
      resetButton();
      showError(
        `Access denied. "${user.email}" is not an authorized account.\n` +
        `Please sign in with your @popatelier.net or @libertycoke.com address.`
      );
      return;
    }

    // ── Success → hand off to the app ────────────────────────────────────
    window.location.replace('../index.html');

  } catch (err) {
    resetButton();

    // User deliberately closed the popup — silent reset, no error shown.
    if (
      err.code === 'auth/popup-closed-by-user' ||
      err.code === 'auth/cancelled-popup-request'
    ) {
      return;
    }

    showError(ssoErrorMessage(err));
  }
}

// ── SSO ERROR → HUMAN MESSAGE ─────────────────────────────────────────────────
function ssoErrorMessage(err) {
  const MAP = {
    'auth/popup-blocked':
      'Pop-up was blocked. Please allow pop-ups for this site and try again.',
    'auth/unauthorized-domain':
      'This domain is not authorized in Firebase Console. Contact your administrator.',
    'auth/account-exists-with-different-credential':
      'An account already exists with a different sign-in method for this email.',
    'auth/user-disabled':
      'This account has been disabled. Contact your administrator.',
    'auth/network-request-failed':
      'Network error — check your connection and try again.',
    'auth/internal-error':
      'An internal error occurred. Please try again.',
  };
  return MAP[err.code] || `Sign-in failed: ${err.message}`;
}

// ── WIRE UP ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('form-login').addEventListener('submit', handleContinue);

  // Real-time provider hint as the user types their email
  document.getElementById('login-email').addEventListener('input', e => {
    updateProviderHint(e.target.value.trim().toLowerCase());
    clearError();
  });
});
