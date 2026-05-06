// ── FIREBASE CONFIG (mirrors app.js — do not change independently) ──
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyBraEBnVPracs_l7YJVWU2YlVabP-86DbI",
  authDomain:        "coca-liberty-inventory.firebaseapp.com",
  databaseURL:       "https://coca-liberty-inventory-default-rtdb.firebaseio.com",
  projectId:         "coca-liberty-inventory",
  storageBucket:     "coca-liberty-inventory.firebasestorage.app",
  messagingSenderId: "447099037329",
  appId:             "1:447099037329:web:c1fc7167d653160cff4130"
};

const ALLOWED_DOMAINS = ['popatelier.net', 'libertycoke.com'];

// ── INIT ─────────────────────────────────────────────────────────────────────
if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
const auth = firebase.auth();

// Redirect already-verified users straight into the app
auth.onAuthStateChanged(user => {
  if (user && user.emailVerified) {
    window.location.replace('../index.html');
  }
});

// ── PANEL HELPERS ────────────────────────────────────────────────────────────
// Toggle between login and register inside the single card.
// Clears the other panel's error so stale messages never bleed across.
function switchToLogin() {
  document.getElementById('verify-panel').classList.add('hidden');
  document.getElementById('main-panels').classList.remove('hidden');
  document.getElementById('panel-register').classList.remove('active');
  document.getElementById('panel-login').classList.add('active');
  document.getElementById('reg-err').textContent = '';
}

function switchToRegister() {
  document.getElementById('panel-login').classList.remove('active');
  document.getElementById('panel-register').classList.add('active');
  document.getElementById('login-err').textContent = '';
}

function showVerifyPanel() {
  document.getElementById('main-panels').classList.add('hidden');
  document.getElementById('verify-panel').classList.remove('hidden');
}

// ── DOMAIN VALIDATION ────────────────────────────────────────────────────────
function isAllowedDomain(email) {
  const domain = (email.split('@')[1] || '').toLowerCase();
  return ALLOWED_DOMAINS.includes(domain);
}

// ── REGISTRATION ─────────────────────────────────────────────────────────────
async function handleRegister(e) {
  e.preventDefault();

  const name    = document.getElementById('reg-name').value.trim();
  const email   = document.getElementById('reg-email').value.trim().toLowerCase();
  const pass    = document.getElementById('reg-pass').value;
  const confirm = document.getElementById('reg-confirm').value;
  const errEl   = document.getElementById('reg-err');
  const btn     = document.getElementById('reg-btn');

  errEl.textContent = '';

  // Validate fields
  if (!name)  { errEl.textContent = 'Full name is required.'; return; }
  if (!email) { errEl.textContent = 'Corporate email is required.'; return; }

  // Domain restriction — abort before any Firebase call
  if (!isAllowedDomain(email)) {
    errEl.textContent = 'Unregistered corporate domain. Only @popatelier.net or @libertycoke.com are allowed.';
    return;
  }

  if (pass.length < 8) { errEl.textContent = 'Password must be at least 8 characters.'; return; }
  if (pass !== confirm) { errEl.textContent = 'Passwords do not match.'; return; }

  btn.disabled    = true;
  btn.textContent = 'Creating account…';

  try {
    const cred = await auth.createUserWithEmailAndPassword(email, pass);
    await cred.user.updateProfile({ displayName: name });
    await cred.user.sendEmailVerification();
    await auth.signOut(); // force email verification before first access
    showVerifyPanel();
  } catch (err) {
    errEl.textContent = authErrMsg(err);
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Create Account';
  }
}

// ── LOGIN ─────────────────────────────────────────────────────────────────────
async function handleLogin(e) {
  e.preventDefault();

  const email = document.getElementById('login-email').value.trim().toLowerCase();
  const pass  = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-err');
  const btn   = document.getElementById('login-btn');

  errEl.textContent = '';

  if (!email || !pass) { errEl.textContent = 'Email and password are required.'; return; }

  btn.disabled    = true;
  btn.textContent = 'Signing in…';

  try {
    const cred = await auth.signInWithEmailAndPassword(email, pass);

    // Reload to get the freshest emailVerified flag from Firebase servers
    await cred.user.reload();

    if (!cred.user.emailVerified) {
      await auth.signOut();
      errEl.textContent =
        'You must verify your email before accessing the platform. Please check your inbox.';
      return;
    }

    window.location.replace('../index.html');
  } catch (err) {
    errEl.textContent = authErrMsg(err);
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Sign In';
  }
}

// ── ERROR MESSAGES ────────────────────────────────────────────────────────────
function authErrMsg(err) {
  const MAP = {
    'auth/user-not-found':         'No account found with this email.',
    'auth/wrong-password':         'Incorrect password.',
    'auth/invalid-credential':     'Invalid email or password.',
    'auth/email-already-in-use':   'An account with this email already exists.',
    'auth/invalid-email':          'Invalid email address.',
    'auth/weak-password':          'Password is too weak. Use at least 8 characters.',
    'auth/too-many-requests':      'Too many failed attempts. Please try again later.',
    'auth/network-request-failed': 'Network error. Check your connection and retry.',
  };
  return MAP[err.code] || err.message;
}

// ── WIRE FORMS ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('form-login').addEventListener('submit', handleLogin);
  document.getElementById('form-register').addEventListener('submit', handleRegister);
});

// Expose for inline onclick="" handlers in login.html
window.switchToLogin    = switchToLogin;
window.switchToRegister = switchToRegister;
