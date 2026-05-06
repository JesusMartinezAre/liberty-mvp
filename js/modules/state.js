// ── SHARED MUTABLE STATE ───────────────────────────────────────────────────
// All modules import this single object and mutate its properties directly.
// ES6 module live-binding ensures every importer sees the latest values.

export const state = {
  // Firebase instances (set once in firebase-config.js)
  db:   null,
  auth: null,

  // Auth
  currentUser:  '',
  currentEmail: '',
  isReadOnly:   false,
  pinEntry:     '',
  _appBooted:   false,

  // Inventory data
  DATA: [],

  // Active modal
  currentModalId: null,

  // Filters
  filterPlatform: 'all',
  filterStatus:   '',
  filterVenue:    '',
  filterQ:        '',

  // Map
  currentVenue: 'metlife',

  // Photos / lightbox
  currentLightboxPhotoId: null,

  // Import
  importRows: [],

  // Activity log
  _activityAll: [],

  // Field mode
  fieldMode: false,

  // Touch swipe tracking
  touchStartX: 0,
  touchStartY: 0,
};
