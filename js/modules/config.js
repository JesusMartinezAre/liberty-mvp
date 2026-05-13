// ── APPLICATION CONSTANTS ──────────────────────────────────────────────────
// Single source of truth for all configuration. Nothing here should mutate.
// Secrets are read from Vite environment variables (import.meta.env.VITE_*).
// In development: values come from .env  — in production: Netlify env vars.

export const FIREBASE_CONFIG = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL:       import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

export const COLLECTION     = 'liberty_inventory';
export const OFFLINE_KEY    = 'liberty_offline_queue';
export const CORRECT_PIN    = import.meta.env.VITE_CORRECT_PIN;
export const PAGE_ORDER     = ['overview', 'inventory', 'map'];

// ── CLOUDINARY ───────────────────────────────────────────────────────────────
export const CLOUDINARY_CLOUD      = import.meta.env.VITE_CLOUDINARY_CLOUD;
export const CLOUDINARY_PRESET     = import.meta.env.VITE_CLOUDINARY_PRESET;
export const CLOUDINARY_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`;

// ── EMAILJS ──────────────────────────────────────────────────────────────────
export const EMAILJS_SERVICE  = import.meta.env.VITE_EMAILJS_SERVICE;
export const EMAILJS_TEMPLATE = import.meta.env.VITE_EMAILJS_TEMPLATE;
export const EMAILJS_KEY      = import.meta.env.VITE_EMAILJS_KEY;
export const NOTIFY_EMAIL     = import.meta.env.VITE_NOTIFY_EMAIL;

// ── STATUS DEFINITIONS ────────────────────────────────────────────────────────
export const STATUSES = [
  { label: 'Not Installed',      color: 'var(--s0)', bg: 'rgba(85,85,85,.15)'  },
  { label: 'Installed at Venue', color: 'var(--s4)', bg: 'rgba(34,197,94,.12)' },
];
export const STATUS_LABELS = STATUSES.map(s => s.label);


// ── ACTIVITY LOG TYPE LABELS ──────────────────────────────────────────────────
export const TIPO = {
  status: { label:'Status Change',    color:'#3b82f6', bg:'rgba(59,130,246,.12)', icon:'📋' },
  venue:  { label:'Venue Assignment', color:'#a855f7', bg:'rgba(168,85,247,.12)', icon:'📍' },
};
