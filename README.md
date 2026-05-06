# Coca-Cola Liberty — Digital Display Inventory
### FIFA World Cup 2026 · Field Operations Platform

A real-time inventory management system for Coca-Cola Liberty's digital display units deployed across MetLife Stadium, Lincoln Financial Field, and Rockefeller Plaza for the FIFA World Cup 2026.

---

## Overview

The app tracks 150 digital display headers (POPA/KOS platforms) through their full installation lifecycle — from assembly through field installation — with live Firestore sync, GPS capture, photo evidence, and automated email notifications on install.

**Stack:** Vanilla JS (ES6 modules) · Firebase Firestore (compat CDN) · Firebase Auth · Cloudinary · EmailJS · SheetJS · Netlify

---

## Architecture — ES6 Module Structure

The JavaScript is split into 14 focused modules under `js/modules/`, orchestrated by `js/main.js`:

```
js/
├── main.js                  # Entry point — imports all modules, exposes window.*
└── modules/
    ├── config.js            # All constants (Firebase, Cloudinary, EmailJS, statuses, venues)
    ├── state.js             # Single shared mutable state object
    ├── toast.js             # Standalone toast notification (no imports)
    ├── firebase-config.js   # Firebase initialization + auth/db singletons
    ├── render.js            # DOM rendering — KPIs, pipeline, donut chart, unit list
    ├── api.js               # Firestore reads/writes, seed data, offline queue
    ├── filters.js           # Platform / status / venue / search filter logic
    ├── ui.js                # Page navigation, sidebar sync, responsive layout
    ├── map.js               # Stadium SVG map, venue switcher, area & unassigned lists
    ├── modal.js             # Unit detail modal — status, photos, GPS, venue assignment
    ├── export.js            # Bulk Excel + print-PDF export
    ├── import.js            # Excel bulk import with auto column detection
    ├── activity.js          # Cross-unit change history log
    └── auth.js              # Firebase auth guard, PIN overlay, sign-out, read-only mode
```

**Dependency graph (acyclic):**
```
toast ← render ← api ← auth
      ↑           ↑
state  config    modal ← map ← ui ← filters
```

`main.js` is the only module that touches `window.*` — all `onclick=""` attributes in the HTML resolve through it.

---

## Local Development

### Prerequisites

- A modern browser with ES module support (Chrome, Firefox, Edge, Safari 15+)
- [VS Code Live Server](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer) **or** any static file server

### Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/your-org/liberty.git
cd liberty

# 2. Copy environment template (see Environment section below)
cp .env.example .env
# Fill in your real Firebase/Cloudinary/EmailJS values in .env

# 3. Open with Live Server
#    Right-click index.html → "Open with Live Server"
#    Or from VS Code command palette: "Live Server: Open with Live Server"
```

> **Note:** The app uses `type="module"` scripts, which require a real HTTP server. Opening `index.html` directly as a `file://` URL will fail with CORS errors. Always use Live Server or equivalent.

### Branch Strategy

| Branch | Purpose |
|--------|---------|
| `main` | Production-ready code |
| `refactor/v2-architecture` | Current ES6 module refactor |
| `feature/*` | New features |

---

## Environment Variables

Copy `.env.example` to `.env` and populate your credentials. **Never commit `.env`** — it is listed in `.gitignore`.

See the [Environment Strategy](#environment-strategy) section below for how these values reach the app at runtime.

---

## Deployment — Netlify

### One-time setup

1. Connect the GitHub repo to Netlify (New site → Import from Git)
2. Set build settings:
   - **Build command:** _(leave blank — no build step yet)_
   - **Publish directory:** `.` (project root)
3. Under **Site settings → Environment variables**, add each key from `.env.example` with your real values

### Deploy

```bash
# Push to main triggers an automatic Netlify deploy
git push origin main
```

The `auth/` directory and `js/` modules are served as static files — no server-side logic required.

### Custom domain

Netlify DNS or an external CNAME pointing to your Netlify subdomain. Firebase Auth's authorized domains list must include your production domain.

---

## Environment Strategy

### Current state (CDN / no bundler)

`js/modules/config.js` currently holds credentials as **hardcoded string literals**. This works for a private/internal app but is not suitable if the repo is public or if credentials rotate.

### Recommended next step — introduce Vite

[Vite](https://vitejs.dev) is the lowest-friction way to inject `.env` variables into a vanilla JS project. It requires minimal changes:

```bash
npm create vite@latest . -- --template vanilla
npm install
```

Then update `js/modules/config.js` to read from `import.meta.env`:

```js
export const FIREBASE_CONFIG = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};
```

On Netlify, the same `VITE_*` keys set in **Site settings → Environment variables** are automatically injected at build time (`npm run build`).

### Alternative — Netlify edge injection (no bundler)

If you want to avoid a build step entirely, Netlify can inject a generated JS config file at deploy time using a **build plugin** or a simple shell script in `netlify.toml`:

```toml
# netlify.toml
[build]
  command = "node scripts/inject-env.js"
  publish = "."
```

```js
// scripts/inject-env.js
const fs = require('fs');
fs.writeFileSync('js/modules/env-config.js', `
export const ENV = {
  FIREBASE_API_KEY: "${process.env.FIREBASE_API_KEY}",
  // ...
};
`);
```

**Verdict:** For this project's current scale and team size, **Vite is the recommended path** — it gives you `.env` injection, dev HMR, and a production build in one small dependency, with zero changes to the module architecture already in place.

---

## Key Features

| Feature | Description |
|---------|-------------|
| Real-time sync | Firestore `onSnapshot` listener — all clients update instantly |
| Offline support | LocalStorage queue flushes writes when connectivity returns |
| GPS capture | OpenStreetMap Nominatim reverse geocoding, Google Maps deep-link |
| Photo evidence | Cloudinary upload with compression, lightbox, delete |
| Email notifications | EmailJS fires on every "Installed at Venue" status change |
| Excel import | Auto-detects column mapping, batch Firestore writes (400/batch) |
| Excel / PDF export | SheetJS bulk export; per-unit HTML→print PDF with photos |
| Activity log | Full cross-unit change history from Firestore `log_*` keys |
| Field mode | Simplified technician view via CSS body class toggle |
| POPA / Navori mask | `Navori` DB values display as `POPA` throughout the UI |

---

## Venues

| Venue | City | Units |
|-------|------|-------|
| MetLife Stadium | East Rutherford, NJ | POPA headers |
| Lincoln Financial Field | Philadelphia, PA | POPA headers |
| Rockefeller Plaza | New York, NY | POPA headers |
| _(Unassigned)_ | — | KOS interior units |

---

## License

Internal tool — Coca-Cola Liberty / POP Atelier LLC. Not for public distribution.
