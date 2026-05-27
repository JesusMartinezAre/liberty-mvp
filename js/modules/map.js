// ── STADIUM MAP ────────────────────────────────────────────────────────────────
// Renders the interactive map, venue switcher, area list, and unassigned list.
//
// Architecture (Lincoln):
//   DB string  →  resolveZoneId()  →  canonical zone ID  →  cfg.pins  →  x%/y%
//   "MC 128"                            "128"                 lincoln       HTML div
//
// Architecture (MetLife / Rockefeller):
//   DB string  →  (direct match)   →  cfg.pins  →  SVG <g> elements (legacy)
//   "100-north"                       metlife

import { state }             from './state.js';
import { getVenues }         from './dataService.js';
import { showToast }         from './toast.js';
import { openModal }         from './modal.js';

// ── MAP IMAGE ERROR HANDLER ───────────────────────────────────────────────────
// Attaches onerror / onload to the base map <img>. Called both on venue switch
// and on initial render so the MetLife image (src set in HTML) is also covered.
function _attachImgHandlers(mapImg, imageUrl) {
  mapImg.onerror = () => {
    mapImg.onerror          = null;          // prevent infinite retry loops
    mapImg.style.visibility = 'hidden';
    mapImg.style.minHeight  = '240px';
    const wrapper = mapImg.parentElement;
    if (!wrapper) return;
    wrapper.querySelector('.map-ph')?.remove();
    const ph = document.createElement('div');
    ph.className   = 'map-ph';
    ph.style.cssText = [
      // inset:0 is not supported in iOS Safari < 14.5 — expand to explicit sides.
      'position:absolute;top:0;left:0;right:0;bottom:0;z-index:1;pointer-events:none;',
      'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;',
      'background:var(--surface);border-radius:8px;',
      'color:var(--text-muted);font-family:var(--mono);font-size:12px;',
    ].join('');
    ph.innerHTML = [
      '<div style="font-size:40px;opacity:.2">🗺</div>',
      '<div style="font-weight:700;color:var(--text-sub)">Map image not found</div>',
      `<div style="font-size:10px;opacity:.5">${imageUrl}</div>`,
    ].join('');
    wrapper.appendChild(ph);
  };
  mapImg.onload = () => {
    mapImg.style.visibility = '';
    mapImg.style.minHeight  = '';
    mapImg.parentElement?.querySelector('.map-ph')?.remove();
  };
}

// ── ADMIN MAPPER (Phase 1 — Lincoln %) ───────────────────────────────────────
// Developer calibration tool. When the active venue is 'lincoln', clicking
// anywhere on the map image logs, toasts, and copies the click position as
// percentages relative to the image's rendered size.
// Usage: switch to Lincoln, open DevTools console, click each zone center.
// Copy the logged { x, y } pairs into VENUE_CONFIG.lincoln.pins.
// ─────────────────────────────────────────────────────────────────────────────
let _mapperAttached = false;

function _initAdminMapper() {
  if (_mapperAttached) return;
  const mapImg = document.getElementById('map-base-img');
  if (!mapImg) return;
  const wrapper = mapImg.parentElement;
  if (!wrapper) return;

  wrapper.addEventListener('click', e => {
    // Only active for lincoln during the calibration phase
    if (state.currentVenue !== 'lincoln') return;

    // getBoundingClientRect gives accurate coords regardless of zoom / scroll /
    // CSS transform, and survives window resizes — more reliable than offsetX.
    const rect = mapImg.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width  * 100).toFixed(2);
    const yPct = ((e.clientY - rect.top)  / rect.height * 100).toFixed(2);

    const display  = `x: ${xPct}%,  y: ${yPct}%`;
    const clipText = `{ x: ${xPct}, y: ${yPct} }`;

    // 1. Console — full context row for DevTools
    console.log(`[MAP ADMIN] 📍 ${display}`);

    // 2. Toast — instant visual confirmation on-screen
    showToast(`📍 ${display}`);

    // 3. Clipboard — paste straight into VENUE_CONFIG
    navigator.clipboard?.writeText(clipText)
      .then(()  => console.log(`[MAP ADMIN] ✅ Copied → ${clipText}`))
      .catch(err => console.warn('[MAP ADMIN] ⚠️ Clipboard write failed:', err));
  });

  _mapperAttached = true;
  console.log('[MAP ADMIN] ✅ Admin Mapper active — click the Lincoln map to capture % coords.');
}

// ── ZONE NORMALIZER — Layer 1 ─────────────────────────────────────────────────
// Maps every known raw DB zone string for Lincoln to a canonical zone ID.
// Canonical IDs are the keys in VENUE_CONFIG.lincoln.pins (Layer 2).
//
// HOW TO MAINTAIN:
//   • When a new DB string variant appears (console.warn fires) → add one line here.
//   • Never touch pin coordinates to fix a string variant.
//   • Never touch this file to move a pin — edit cfg.pins x/y instead.
// ─────────────────────────────────────────────────────────────────────────────
const ZONE_ALIASES = {
  // ── Section 128 ──────────────────────────────────────────
  '128':         '128',
  'MC 128':      '128',
  'mc 128':      '128',
  'MC128':       '128',
  'Sec 128':     '128',
  'SEC 128':     '128',
  'Section 128': '128',
  'Suite 128':   '128',

  // ── Section 129 ──────────────────────────────────────────
  '129':         '129',
  'MC 129':      '129',
  'mc 129':      '129',
  'MC129':       '129',
  'Sec 129':     '129',
  'SEC 129':     '129',
  'Section 129': '129',
  'Suite 129':   '129',

  // ── Add sections below as you calibrate them with the Admin Mapper ──────────
  // '130': '130',
  // 'MC 130': '130',
};

/**
 * Resolves a raw DB zone string to a canonical zone ID for pin lookup.
 *
 * Resolution order:
 *   1. Direct lookup in ZONE_ALIASES        → fastest, most explicit
 *   2. Strip known prefixes, retry lookup   → handles "MC 128", "Suite 128"
 *   3. Bare-number fallback                 → handles "128 " (trailing space)
 *   4. null + console.warn                  → surfaces unknowns for diagnosis
 *
 * @param  {string}      raw  Raw zone/section string from the DB record.
 * @returns {string|null}     Canonical zone ID, or null if unresolvable.
 */
function resolveZoneId(raw) {
  if (!raw || raw === '—') return null;
  const cleaned = raw.trim();

  // 1. Direct alias lookup
  if (ZONE_ALIASES[cleaned]) return ZONE_ALIASES[cleaned];

  // 2. Strip common prefixes and retry
  const stripped = cleaned
    .replace(/^(MC|Suite|Suites|Sec|Section|Gate|Club|Level)\s+/i, '')
    .trim();
  if (ZONE_ALIASES[stripped]) return ZONE_ALIASES[stripped];

  // 3. Bare number fallback (catches trailing whitespace or zero-padded variants)
  if (/^\d+$/.test(stripped) && ZONE_ALIASES[stripped]) return ZONE_ALIASES[stripped];

  // 4. Unresolvable — log so it can be added to ZONE_ALIASES
  console.warn(`[MAP] resolveZoneId: unresolved zone "${raw}" — add to ZONE_ALIASES`);
  return null;
}

// ── VENUE CONFIGURATION ─── Layer 2 ──────────────────────────────────────────
// Single source of truth for each venue's map image, pin coordinates, and areas.
//
// Lincoln uses PERCENTAGE coordinates (x/y as 0–100 relative to the image).
//   → Set with Admin Mapper (Phase 1 tool). Scales perfectly on any screen size.
//
// MetLife / Rockefeller use PIXEL coordinates inside viewBox="0 0 800 620".
//   → Legacy system; will be migrated to % in a future phase.
//
// imageUrl: browser resolves format from Content-Type — extension doesn't matter.
// ─────────────────────────────────────────────────────────────────────────────
const VENUE_CONFIG = {
  metlife: {
    imageUrl: '/assets/maps/metlife.png',
    pins: {
      '100-north': { x:525, y:193, label:'100s North' },
      '100-south': { x:525, y:423, label:'100s South' },
      '100-east':  { x:645, y:308, label:'100s East'  },
      '100-west':  { x:405, y:308, label:'100s West'  },
      '200-north': { x:525, y:145, label:'200s North' },
      '200-south': { x:525, y:471, label:'200s South' },
      '200-east':  { x:695, y:308, label:'200s East'  },
      '200-west':  { x:355, y:308, label:'200s West'  },
      '300-north': { x:525, y:92,  label:'300s North' },
      '300-south': { x:525, y:524, label:'300s South' },
      '300-east':  { x:748, y:308, label:'300s East'  },
      '300-west':  { x:302, y:308, label:'300s West'  },
    },
    areas: [
      { id:'100-north', label:'100s North', sub:'Lower Bowl — North End',  color:'#3b82f6', slots:10 },
      { id:'100-south', label:'100s South', sub:'Lower Bowl — South End',  color:'#3b82f6', slots:10 },
      { id:'100-east',  label:'100s East',  sub:'Lower Bowl — East Side',  color:'#8b5cf6', slots:8  },
      { id:'100-west',  label:'100s West',  sub:'Lower Bowl — West Side',  color:'#8b5cf6', slots:8  },
      { id:'200-north', label:'200s North', sub:'Club Level — North',      color:'#f59e0b', slots:6  },
      { id:'200-south', label:'200s South', sub:'Club Level — South',      color:'#f59e0b', slots:6  },
      { id:'200-east',  label:'200s East',  sub:'Club Level — East',       color:'#22c55e', slots:5  },
      { id:'200-west',  label:'200s West',  sub:'Club Level — West',       color:'#22c55e', slots:5  },
      { id:'300-north', label:'300s North', sub:'Upper Bowl — North',      color:'#ef4444', slots:4  },
      { id:'300-south', label:'300s South', sub:'Upper Bowl — South',      color:'#ef4444', slots:4  },
      { id:'300-east',  label:'300s East',  sub:'Upper Bowl — East',       color:'#ec4899', slots:3  },
      { id:'300-west',  label:'300s West',  sub:'Upper Bowl — West',       color:'#ec4899', slots:3  },
    ],
  },

  lincoln: {
    imageUrl: '/assets/maps/lincoln.png',
    pins: {
      // ── Calibrated with Admin Mapper (x%, y% relative to image) ─────────────
      // Canonical IDs must match keys in ZONE_ALIASES above.
      // Replace dummy coordinates with real ones from the Admin Mapper tool.
      '128': { x: 45.00, y: 30.00, label: 'Sec 128' },  // ← placeholder, recalibrate
      '129': { x: 50.00, y: 30.00, label: 'Sec 129' },  // ← placeholder, recalibrate
      // Add additional sections here as they are clicked in the Admin Mapper
    },
    areas: [
      { id:'100-north', label:'100s North', sub:'Lower Bowl — North End',  color:'#3b82f6', slots:10 },
      { id:'100-south', label:'100s South', sub:'Lower Bowl — South End',  color:'#3b82f6', slots:10 },
      { id:'100-east',  label:'100s East',  sub:'Lower Bowl — East Side',  color:'#8b5cf6', slots:8  },
      { id:'100-west',  label:'100s West',  sub:'Lower Bowl — West Side',  color:'#8b5cf6', slots:8  },
      { id:'200-north', label:'200s North', sub:'Club Level — North',      color:'#f59e0b', slots:6  },
      { id:'200-south', label:'200s South', sub:'Club Level — South',      color:'#f59e0b', slots:6  },
      { id:'200-east',  label:'200s East',  sub:'Club Level — East',       color:'#22c55e', slots:5  },
      { id:'200-west',  label:'200s West',  sub:'Club Level — West',       color:'#22c55e', slots:5  },
      { id:'300-north', label:'300s North', sub:'Upper Bowl — North',      color:'#ef4444', slots:4  },
      { id:'300-south', label:'300s South', sub:'Upper Bowl — South',      color:'#ef4444', slots:4  },
      { id:'300-east',  label:'300s East',  sub:'Upper Bowl — East',       color:'#ec4899', slots:3  },
      { id:'300-west',  label:'300s West',  sub:'Upper Bowl — West',       color:'#ec4899', slots:3  },
    ],
  },

  rockefeller: {
    imageUrl: '/assets/maps/rockefeller.jpeg',
    pins: {
      'plaza-main':      { x:295, y:415, label:'Main Plaza'       },
      'plaza-north':     { x:295, y:265, label:'North Plaza'      },
      'plaza-south':     { x:295, y:560, label:'South Plaza'      },
      'concourse':       { x:430, y:480, label:'Concourse Level'  },
      'rink-level':      { x:230, y:485, label:'Rink Level'       },
      'channel-gardens': { x:620, y:415, label:'Channel Gardens'  },
      'top-rock':        { x:280, y:360, label:'Top of the Rock'  },
    },
    areas: [
      { id:'plaza-main',      label:'Main Plaza',      sub:'Ground Level — Center',   color:'#3b82f6', slots:8 },
      { id:'plaza-north',     label:'North Plaza',     sub:'Ground Level — North',    color:'#8b5cf6', slots:6 },
      { id:'plaza-south',     label:'South Plaza',     sub:'Ground Level — South',    color:'#f59e0b', slots:6 },
      { id:'concourse',       label:'Concourse Level', sub:'Interior — Concourse',    color:'#22c55e', slots:5 },
      { id:'rink-level',      label:'Rink Level',      sub:'Ice Rink — Ground Floor', color:'#ef4444', slots:4 },
      { id:'channel-gardens', label:'Channel Gardens', sub:'Outdoor — East Approach', color:'#ec4899', slots:4 },
      { id:'top-rock',        label:'Top of the Rock', sub:'Observation Deck Level',  color:'#14b8a6', slots:3 },
    ],
  },
};

// ── VENUE SWITCHER ────────────────────────────────────────────────────────────
export function setVenue(v, el) {
  state.currentVenue = v;
  document.querySelectorAll('.venue-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('map-venue-title').textContent =
    getVenues().find(x => x.id === v)?.name || v;

  const mapImg = document.getElementById('map-base-img');
  if (mapImg) {
    const cfg  = VENUE_CONFIG[v] || VENUE_CONFIG.metlife;
    _attachImgHandlers(mapImg, cfg.imageUrl);
    mapImg.src = cfg.imageUrl;
  }

  renderStadiumMap();
}

// ── VENUE ID RESOLVER ─────────────────────────────────────────────────────────
// The venue buttons in index.html use short UI keys ('lincoln', 'metlife',
// 'rockefeller') that are stored in state.currentVenue. The players collection
// stores the actual Firestore venue document ID in player.venueId, which flows
// through the adapter as d.venue. These two values are NOT guaranteed to be
// equal — the Firestore venue document ID is whatever was set when the venue
// record was created (e.g. 'lincoln-financial-field', a UUID, etc.).
//
// This function bridges the gap using the same venues cache that renderPipeline()
// relies on: try an exact id match first, then fall back to a case-insensitive
// partial-name match (e.g. 'lincoln' → 'Lincoln Financial Field' → its real ID).
// ─────────────────────────────────────────────────────────────────────────────
function _resolveVenueId() {
  const key    = state.currentVenue;          // UI key, e.g. 'lincoln'
  const venues = getVenues();                  // live Firestore cache

  // 1. Exact Firestore document-ID match (works when IDs happen to match keys)
  if (venues.find(v => v.id === key)) return key;

  // 2. Partial name match — case-insensitive, split on common separators
  const fuzzy = venues.find(v =>
    (v.name || '').toLowerCase().includes(key.toLowerCase())
  );
  if (fuzzy) {
    console.log(`[MAP] _resolveVenueId: '${key}' → Firestore ID '${fuzzy.id}' (via name match '${fuzzy.name}')`);
    return fuzzy.id;
  }

  // 3. No match — return key unchanged and let filters return empty results
  console.warn(`[MAP] _resolveVenueId: no Firestore venue found for key '${key}'. Available:`,
    venues.map(v => `${v.id} ("${v.name}")`));
  return key;
}

// ── MAP RENDERER (orchestrator) ───────────────────────────────────────────────
// Builds the zone → units lookup, dispatches to the correct pin renderer,
// then updates the area list and unassigned section below the map.
export function renderStadiumMap() {
  const cfg     = VENUE_CONFIG[state.currentVenue] || VENUE_CONFIG.metlife;
  const venueId = _resolveVenueId();   // ← actual Firestore venue document ID
  const mapImg  = document.getElementById('map-base-img');
  if (mapImg) {
    _attachImgHandlers(mapImg, cfg.imageUrl);
    mapImg.src = cfg.imageUrl;
  }

  // ── Build zone → units groups ─────────────────────────────────────────────
  // Lincoln uses Layer 1 (resolveZoneId) to normalise messy DB strings.
  // All other venues match zone strings directly against pin/area IDs.
  const isLincoln = state.currentVenue === 'lincoln';
  const groups    = {};   // { canonicalZoneId: [unit, ...] }
  const unmapped  = [];   // units whose zone string could not be resolved

  state.DATA
    .filter(d => d.venue === venueId && d.zone && d.zone !== '—')
    .forEach(d => {
      const key = isLincoln ? resolveZoneId(d.zone) : d.zone;
      if (key === null) { unmapped.push(d); return; }
      if (!groups[key]) groups[key] = [];
      groups[key].push(d);
    });

  // ── Route to the correct pin-rendering system ────────────────────────────
  if (isLincoln) {
    _renderHtmlPins(cfg, groups, unmapped);
  } else {
    _renderSvgPins(cfg, groups);
  }

  _renderAreaList(cfg, groups);
  _renderUnassignedList();
}

// ── PIN TOOLTIP STYLES ───────────────────────────────────────────────────────
// Injected once into <head>. All tooltip behaviour is pure CSS — no JS
// positioning, no mousemove listeners.
//
// Idempotency note: the existing tag is REMOVED before a new one is appended.
// This prevents a Vite HMR cycle from leaving a stale tag whose rules (e.g. an
// old pointer-events:none) shadow the updated ones — a second <style> block
// only ADDS rules; it cannot delete rules that only existed in the first block.
// ─────────────────────────────────────────────────────────────────────────────
let _pinStylesInjected = false;
function _injectPinStyles() {
  if (_pinStylesInjected) return;
  document.getElementById('map-pin-styles')?.remove();   // ← purge any stale HMR tag
  const s = document.createElement('style');
  s.id    = 'map-pin-styles';
  s.textContent = `

    /* ── Pin wrapper hit-box ─────────────────────────────────── */
    /* Explicit dimensions guarantee a physical hit-box regardless
       of how the browser resolves flex content sizing on a
       position:absolute element. Without this, some engines report
       a 0×0 box and the hit-tester skips the element entirely.
       The inline style on each pin repeats these values so the rule
       applies even if the stylesheet is parsed after layout.       */
    .pin-wrapper {
      width                      : 36px;
      height                     : 36px;
      display                    : flex;
      align-items                : center;
      justify-content            : center;

      /* ── Cross-platform touch hardening ──────────────────────
         touch-action:manipulation   — eliminates the 300ms tap-delay
           Safari/WebKit imposes while waiting for a potential double-
           tap zoom. Without this every pin tap is noticeably slow.
         -webkit-tap-highlight-color — iOS paints a gray rect over any
           tapped element by default; transparent removes that flash.
         user-select / -webkit-user-select — prevents the long-press
           text-selection magnifier from appearing over the count digit,
           which blocks the tap-to-click flow on iPhone.
         will-change:transform — promotes the element to its own
           compositing layer so the scale() transition on the bubble
           runs on the GPU, not the main thread.                   */
      touch-action               : manipulation;
      -webkit-tap-highlight-color: transparent;
      -webkit-user-select        : none;
      user-select                : none;
      will-change                : transform;
    }

    /* Roster row hover — CSS rule replaces the onmouseover/onmouseout
       inline handlers that get "stuck" on iOS (mouseover fires on first
       tap; mouseout never fires, leaving the row permanently highlighted
       and requiring a second tap to trigger onclick).                  */
    .map-roster-row:hover {
      background: var(--card-hover) !important;
    }

    /* ── Tooltip container ───────────────────────────────────── */
    .pin-tooltip {
      position        : absolute;
      bottom          : 100%;               /* flush against pin-wrapper top — no gap to cross */
      left            : 50%;
      transform       : translateX(-50%) translateY(4px);
      z-index         : 200;

      background      : rgba(10, 10, 15, 0.97);
      border          : 1px solid rgba(255,255,255,0.10);
      border-radius   : 8px;
      padding         : 9px 13px;
      box-shadow      : 0 8px 28px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.04);
      backdrop-filter : blur(10px);
      -webkit-backdrop-filter: blur(10px);

      display         : flex;
      flex-direction  : column;
      gap             : 5px;
      min-width       : 170px;

      font-family     : var(--mono);
      font-size       : 11px;
      color           : var(--text);
      line-height     : 1.4;
      white-space     : nowrap;

      /* Hidden + slightly lowered by default.
         pointer-events intentionally left at auto (default): when the tooltip
         is visible, it is a CSS descendant of .pin-wrapper. The browser counts
         the mouse being over the tooltip as the mouse being over .pin-wrapper,
         so :hover stays true as the cursor travels from the bubble up into the
         tooltip — zero gap, zero flicker. visibility:hidden ensures the tooltip
         does not intercept events while it is still invisible. */
      opacity         : 0;
      visibility      : hidden;
      transition      : opacity .15s ease, visibility .15s ease, transform .15s ease;
    }

    /* Reveal on pin-wrapper hover — slide up 4px */
    .pin-wrapper:hover .pin-tooltip {
      opacity   : 1;
      visibility: visible;
      transform : translateX(-50%) translateY(0);
    }

    /* Downward arrow (caret) */
    .pin-tooltip::after {
      content          : '';
      position         : absolute;
      top              : 100%;          /* just below the tooltip box    */
      left             : 50%;
      transform        : translateX(-50%);
      border           : 6px solid transparent;
      border-top-color : rgba(10, 10, 15, 0.97);
      pointer-events   : none;
    }

    /* ── Tooltip content helpers ─────────────────────────────── */

    /* Key / value row (single-unit view) */
    .ptt-row   {
      display        : flex;
      justify-content: space-between;
      align-items    : center;
      gap            : 14px;
    }
    .ptt-label {
      color          : var(--text-muted);
      font-size      : 10px;
      letter-spacing : .3px;
      flex-shrink    : 0;
    }
    .ptt-val   {
      color          : var(--text);
      font-weight    : 700;
      font-size      : 11px;
      text-align     : right;
    }

    /* Status dot + text */
    .ptt-status {
      font-size      : 10px;
      font-weight    : 700;
      letter-spacing : .2px;
    }

    /* Thin separator line */
    .ptt-divider {
      border         : none;
      border-top     : 1px solid rgba(255,255,255,0.08);
      margin         : 1px 0;
    }

    /* Multi-unit header */
    .ptt-head  {
      font-weight    : 700;
      color          : var(--text);
      letter-spacing : .3px;
      padding-bottom : 4px;
      border-bottom  : 1px solid rgba(255,255,255,0.08);
    }

    /* Individual S/N rows in multi-unit view */
    .ptt-sn    {
      color          : var(--text-sub);
      font-size      : 10px;
    }

    /* "+N more" overflow indicator */
    .ptt-more  {
      color          : var(--text-muted);
      font-size      : 10px;
      font-style     : italic;
      margin-top     : 1px;
    }
  `;
  document.head.appendChild(s);
  _pinStylesInjected = true;
}

// ── HTML PIN RENDERER (Lincoln — %-based) ────────────────────────────────────
// Renders absolutely-positioned <div> pins inside a #pin-layer overlay.
// Coordinates are percentages → pins scale perfectly with the image on any
// screen size, zoom level, or window resize with zero JavaScript required.
function _renderHtmlPins(cfg, groups, unmapped) {
  _injectPinStyles();   // no-op after first call

  // Disable the SVG overlay completely while the HTML pin system is active.
  //
  // Why display:none and not just pointer-events:none?
  // The MetLife <g> elements use pointer-events:all (SVG-only value). After
  // _renderSvgPins writes those nodes, the browser caches an event-hungry hit
  // state on the SVG element. Clearing innerHTML removes the children but does
  // NOT fully reset that state until the next compositing pass — so even an
  // "empty" SVG with pointer-events:none in its inline style can keep swallowing
  // clicks. display:none yanks the element from layout AND hit-testing entirely,
  // which is the only reliable way to silence it.
  const svg = document.getElementById('stadium-svg');
  if (svg) {
    svg.innerHTML     = '';
    svg.style.display = 'none';   // remove from hit-test tree (see comment above)
  }

  const mapImg = document.getElementById('map-base-img');
  if (!mapImg) return;
  const wrapper = mapImg.parentElement;
  if (!wrapper) return;

  // ── Bulletproof layout enforcement ───────────────────────────────────────
  //
  // WRAPPER — must be the positioning root for all absolutely-placed children.
  //   position:relative  → creates the containing block for #pin-layer
  //   width:100%         → explicit width so percentage-based child sizes resolve
  //   overflow:visible   → lets tooltips extend above the top edge of the image
  wrapper.style.position = 'relative';
  wrapper.style.width    = '100%';
  wrapper.style.overflow = 'visible';

  // IMAGE — purely decorative wallpaper; must never intercept pointer events.
  //   display:block      → removes the inline-level gap below <img> elements
  //   width:100%         → fills the wrapper so the image drives the wrapper height
  //   position:relative  → participates in stacking order (z-index works)
  //   z-index:1          → sits at the bottom of the local stacking context
  //   pointer-events:none→ browser hit-tester skips the image entirely and falls
  //                        through to whichever .pin-wrapper is at that coordinate
  mapImg.style.display       = 'block';
  mapImg.style.width         = '100%';
  mapImg.style.position      = 'relative';
  mapImg.style.zIndex        = '1';
  mapImg.style.pointerEvents = 'none';

  // PIN LAYER — full-size transparent overlay that parents all pin wrappers.
  //   position:absolute  → placed relative to wrapper, not the image
  //   top/left/width/height → explicit 100% dimensions; avoids the 0×0 collapse
  //     that breaks hit-testing when inset:0 is parsed incorrectly by some
  //     older WebKit builds (the UA may reject shorthand in cssText).
  //   z-index:50         → above the image (z-index:1) and the SVG (display:none)
  //   pointer-events:none→ the layer itself is transparent; only .pin-wrapper
  //                        children with pointer-events:auto are hit-testable
  //   overflow:visible   → tooltips may extend above the layer's top edge
  let layer = wrapper.querySelector('#pin-layer');
  if (!layer) {
    layer    = document.createElement('div');
    layer.id = 'pin-layer';
    wrapper.appendChild(layer);
  }
  // Always re-apply styles so a stale layer from a previous render is corrected.
  layer.style.position      = 'absolute';
  layer.style.top           = '0';
  layer.style.left          = '0';
  layer.style.width         = '100%';
  layer.style.height        = '100%';
  layer.style.zIndex        = '50';
  layer.style.pointerEvents = 'none';
  layer.style.overflow      = 'visible';
  layer.innerHTML           = '';

  // ── One pin per configured zone (with or without assigned units) ────────
  // Ghost pins (no units yet) render as dim/dashed so the full zone layout is
  // always visible and the interaction layer can be verified independently of
  // whether real data has been entered. Ghost pins are non-clickable.
  Object.entries(cfg.pins).forEach(([zoneId, pos]) => {
    const units   = groups[zoneId] || [];
    const total   = units.length;
    const isGhost = total === 0;

    const installed = units.filter(u => u.status === 'Installed at Venue').length;

    // Status colour — mirrors the legend in the HTML:
    //   all installed  → green  (--s4)
    //   mixed          → amber  (--s2)
    //   none installed → gray   (--s0)
    //   ghost (no data) → dim white outline only
    const color = isGhost           ? 'transparent'
                : installed === total ? 'var(--s4)'
                : installed > 0       ? 'var(--s2)'
                :                       'var(--s0)';

    // ── Outer wrapper — positioned at (x%, y%), centered on that point ─────
    const pin = document.createElement('div');
    pin.className    = 'pin-wrapper';   // CSS hook for :hover .pin-tooltip
    pin.style.cssText = [
      'position:absolute;',
      `left:${pos.x}%;`,
      `top:${pos.y}%;`,
      // translate(-50%,-50%) centers the 36×36 box on the coordinate point.
      // The box is the hit-target; all child elements (bubble, label, tooltip)
      // are centred within it or positioned absolutely relative to it.
      'transform:translate(-50%,-50%);',
      // Explicit hit-box — mirrors the CSS rule in _injectPinStyles.
      // Belt-and-suspenders: if the stylesheet hasn't been parsed yet when
      // the first click fires, the inline value is already in place.
      'width:36px;height:36px;',
      'display:flex;align-items:center;justify-content:center;',
      `pointer-events:${isGhost ? 'none' : 'auto'};`,
      `cursor:${isGhost ? 'default' : 'pointer'};`,
      'z-index:10;',
      // ── iOS/WebKit touch hardening (inline mirrors the CSS rule so it's
      //    present even if the stylesheet loads after the first render).
      //    touch-action:manipulation — kills the 300ms double-tap delay on Safari.
      //    -webkit-tap-highlight-color:transparent — removes the gray tap-flash.
      'touch-action:manipulation;',
      '-webkit-tap-highlight-color:transparent;',
    ].join('');

    // ── Bubble (circle with count) ──────────────────────────────────────────
    const bubble = document.createElement('div');
    bubble.style.cssText = [
      'width:30px;height:30px;border-radius:50%;',
      `background:${color};`,
      isGhost
        ? 'border:2px dashed rgba(255,255,255,0.30);opacity:0.45;'
        : 'border:2.5px solid rgba(255,255,255,0.85);box-shadow:0 2px 10px rgba(0,0,0,0.65);',
      'display:flex;align-items:center;justify-content:center;',
      'font-size:12px;font-weight:800;color:white;',
      'font-family:var(--mono);',
      'transition:transform .12s ease, box-shadow .12s ease;',
      'user-select:none;',
    ].join('');
    bubble.textContent = isGhost ? '' : total;

    // ── Label (section name below bubble) ───────────────────────────────────
    // position:absolute keeps the label out of flex flow so it never
    // contributes to the wrapper's intrinsic size.  top:100% places it
    // just below the 36 px hit-box; translateX(-50%) re-centres it.
    const lbl = document.createElement('div');
    lbl.style.cssText = [
      'position:absolute;top:100%;left:50%;',
      'transform:translateX(-50%);margin-top:2px;',
      'font-size:9px;font-weight:700;font-family:var(--mono);',
      'white-space:nowrap;border-radius:4px;padding:1px 5px;',
      isGhost
        ? 'color:rgba(255,255,255,0.35);background:rgba(255,255,255,0.08);'
        : 'color:white;background:rgba(0,0,0,0.55);text-shadow:0 1px 3px rgba(0,0,0,0.8);',
      'pointer-events:none;',
    ].join('');
    lbl.textContent = pos.label;

    pin.appendChild(bubble);
    pin.appendChild(lbl);

    // Ghost pins: no tooltip, no interaction — just a layout marker
    if (isGhost) {
      layer.appendChild(pin);
      return;
    }

    // ── Tooltip ───────────────────────────────────────────────────────────────
    // Content adapts based on unit count.
    //   1 unit  → key/value rows: S/N, Zone, Status
    //   2+ units → header with count, list of S/Ns (max 3), +N more overflow
    const tooltip = document.createElement('div');
    tooltip.className = 'pin-tooltip';

    const MAX_LISTED = 3;

    if (units.length === 1) {
      // ── Single-unit view ───────────────────────────────────────────────────
      const u         = units[0];
      const sn        = u.digitalHeader || '—';
      const rawZone   = (u.zone && u.zone !== '—') ? u.zone : zoneId;
      const isInstalled = u.status === 'Installed at Venue';
      const statusColor = isInstalled ? 'var(--s4)' : 'var(--s0)';
      const statusText  = isInstalled ? '● Installed' : '● Not Installed';

      tooltip.innerHTML =
        `<div class="ptt-row">` +
          `<span class="ptt-label">S/N</span>` +
          `<span class="ptt-val">${sn}</span>` +
        `</div>` +
        `<hr class="ptt-divider">` +
        `<div class="ptt-row">` +
          `<span class="ptt-label">Zone</span>` +
          `<span class="ptt-val">${rawZone}</span>` +
        `</div>` +
        `<div class="ptt-row">` +
          `<span class="ptt-label">Status</span>` +
          `<span class="ptt-status" style="color:${statusColor}">${statusText}</span>` +
        `</div>`;

    } else {
      // ── Multi-unit view ────────────────────────────────────────────────────
      const listed   = units.slice(0, MAX_LISTED);
      const overflow = units.length - MAX_LISTED;

      tooltip.innerHTML =
        `<div class="ptt-head">${pos.label} &nbsp;·&nbsp; ${units.length} units</div>` +
        listed.map(u =>
          `<span class="ptt-sn">${u.digitalHeader || '—'}</span>`
        ).join('') +
        (overflow > 0
          ? `<span class="ptt-more">+${overflow} more</span>`
          : '');
    }

    pin.appendChild(tooltip);

    // ── Hover effect (bubble scale) ──────────────────────────────────────────
    pin.addEventListener('mouseenter', () => {
      bubble.style.transform  = 'scale(1.18)';
      bubble.style.boxShadow  = '0 4px 16px rgba(0,0,0,0.8)';
    });
    pin.addEventListener('mouseleave', () => {
      bubble.style.transform  = '';
      bubble.style.boxShadow  = '0 2px 10px rgba(0,0,0,0.65)';
    });

    // ── Click → open modal ───────────────────────────────────────────────────
    // stopPropagation prevents the Admin Mapper listener from also firing
    pin.addEventListener('click', e => {
      e.stopPropagation();
      openModal(units[0].id);
    });

    layer.appendChild(pin);
  });

  // ── Unmapped badge ────────────────────────────────────────────────────────
  // Shows a dismissible counter when units exist but their zone couldn't be
  // resolved. Clicking it dumps a full table to the DevTools console so the
  // developer knows exactly which ZONE_ALIASES entries to add.
  wrapper.querySelector('#map-unmapped-badge')?.remove();

  if (unmapped.length > 0) {
    const badge = document.createElement('div');
    badge.id = 'map-unmapped-badge';
    badge.style.cssText = [
      'position:absolute;top:8px;right:8px;z-index:20;',
      'display:flex;align-items:center;gap:5px;',
      'background:rgba(239,68,68,0.88);',
      'border:1px solid rgba(255,100,100,0.4);',
      'border-radius:8px;padding:5px 10px;',
      'font-size:11px;font-weight:700;font-family:var(--mono);',
      'color:white;cursor:pointer;',
      'box-shadow:0 2px 10px rgba(0,0,0,0.5);',
      '-webkit-backdrop-filter:blur(4px);',   // Safari prefix
      'backdrop-filter:blur(4px);',
      'transition:opacity .15s;',
    ].join('');
    badge.textContent = `❓ ${unmapped.length} Unmapped`;
    badge.title =
      `Units with unresolvable zone strings:\n` +
      unmapped.map(u => `  • ${u.digitalHeader}: "${u.zone}"`).join('\n') +
      `\n\nClick to log full table to DevTools console.`;

    badge.addEventListener('click', e => {
      e.stopPropagation();
      console.group(`[MAP] ${unmapped.length} unmapped unit(s) — add these to ZONE_ALIASES in map.js`);
      console.table(unmapped.map(u => ({
        unit:    u.digitalHeader,
        rawZone: u.zone,
        id:      u.id,
      })));
      console.groupEnd();
      showToast(`❓ ${unmapped.length} unmapped unit(s) — see DevTools console`);
    });

    wrapper.appendChild(badge);
  }
}

// ── SVG PIN RENDERER (MetLife / Rockefeller — legacy pixel-based) ─────────────
// Retained as-is for venues still using absolute integer coordinates.
// Will be migrated to the %-based HTML system in a future phase.
function _renderSvgPins(cfg, groups) {
  // Clean up any Lincoln HTML artefacts and restore the map container's clip
  const mapImg = document.getElementById('map-base-img');
  if (mapImg) {
    const w = mapImg.parentElement;
    w?.querySelector('#pin-layer')?.remove();
    w?.querySelector('#map-unmapped-badge')?.remove();
    if (w) w.style.overflow = 'hidden';   // re-enable clip for SVG venues
  }

  // Restore the map image to normal hit-testing — _renderHtmlPins set it to
  // pointer-events:none so clicks would fall through to the HTML pins.
  // For SVG venues the image doesn't need to intercept events either, but
  // resetting it keeps the element in its default state between renders.
  const mapImgSvg = document.getElementById('map-base-img');
  if (mapImgSvg) mapImgSvg.style.pointerEvents = '';

  const svg = document.getElementById('stadium-svg');
  if (!svg) return;

  // Restore SVG visibility — _renderHtmlPins (Lincoln) hides it to prevent the
  // SVG's cached hit-test state from swallowing pointer events on the HTML pins.
  svg.style.display = '';

  const PIN_COLOR = '#F40009';
  let pins = '';

  Object.entries(cfg.pins).forEach(([areaId, pos]) => {
    const units = groups[areaId] || [];
    const count = units.length;
    const cx    = pos.x;
    const cy    = pos.y;

    if (count > 0) {
      const tipY = cy + 26;
      pins += `
        <g style="cursor:pointer;pointer-events:all" onclick="openModal('${units[0].id}')">
          <circle cx="${cx}" cy="${cy}" r="26" fill="${PIN_COLOR}" opacity="0.2">
            <animate attributeName="r" values="22;30;22" dur="2.5s" repeatCount="indefinite"/>
            <animate attributeName="opacity" values="0.3;0;0.3" dur="2.5s" repeatCount="indefinite"/>
          </circle>
          <circle cx="${cx+2}" cy="${cy+3}" r="18" fill="rgba(0,0,0,0.55)"/>
          <circle cx="${cx}" cy="${cy}" r="20" fill="white"/>
          <circle cx="${cx}" cy="${cy}" r="17" fill="${PIN_COLOR}"/>
          <polygon points="${cx-8},${cy+14} ${cx+8},${cy+14} ${cx},${tipY}" fill="${PIN_COLOR}"/>
          <polygon points="${cx-8},${cy+14} ${cx+8},${cy+14} ${cx},${tipY}" fill="none" stroke="white" stroke-width="2" stroke-linejoin="round"/>
          <text x="${cx}" y="${cy+6}" text-anchor="middle" fill="white" font-size="14" font-weight="900" font-family="Arial,sans-serif">${count}</text>
          <text x="${cx}" y="${tipY+12}" text-anchor="middle" fill="white" font-size="9" font-weight="700" font-family="Arial,sans-serif"
            style="text-shadow:0 1px 4px rgba(0,0,0,1)">${pos.label}</text>
        </g>`;
    } else {
      pins += `
        <g style="cursor:pointer;pointer-events:all" onclick="showToast('No units assigned to ${areaId} yet')" opacity="0.35">
          <circle cx="${cx}" cy="${cy}" r="10" fill="white" stroke="rgba(255,255,255,0.5)" stroke-width="1"/>
          <text x="${cx}" y="${cy+4}" text-anchor="middle" fill="rgba(0,0,0,0.6)" font-size="11" font-family="Arial,sans-serif">+</text>
        </g>`;
    }
  });

  svg.innerHTML = pins;
}

// ── AREA LIST — Installed Units Roster ───────────────────────────────────────
// Renders the "Areas & Units" card below the map.
//
// Shows every unit at the current venue that has status 'Installed at Venue',
// sorted by zone then by serial number. Clears and re-renders automatically
// whenever renderStadiumMap() is called (venue switch, Firestore update, etc.).
//
// The `cfg` and `groups` params are kept for signature compatibility but the
// roster pulls directly from state.DATA so it includes units in every zone,
// including those not yet in the pin coordinate dictionary.
// ─────────────────────────────────────────────────────────────────────────────
function _renderAreaList(cfg, groups) {
  const el = document.getElementById('map-area-list');
  if (!el) return;

  // ── 1. Installed units for this venue, sorted zone → serial ──────────────
  // Use _resolveVenueId() to get the actual Firestore venue document ID that
  // lives in d.venue (player.venueId). Matching on state.currentVenue directly
  // fails whenever the UI key ('lincoln') differs from the Firestore ID.
  // Use d.installed===true (boolean) — same source as renderPipeline() which is
  // confirmed to show the correct counts. d.status is a derived string from the
  // same boolean but avoids any risk of string-casing drift.
  const venueId   = _resolveVenueId();
  const installed = state.DATA
    .filter(d => d.venue === venueId && d.installed === true)
    .sort((a, b) => {
      // Units with no zone sort to the end so real sections appear first.
      const zA = (a.zone && a.zone !== '—') ? a.zone : '￿';
      const zB = (b.zone && b.zone !== '—') ? b.zone : '￿';
      return zA.localeCompare(zB) || (a.digitalHeader || '').localeCompare(b.digitalHeader || '');
    });

  // ── 2. Empty state ────────────────────────────────────────────────────────
  if (installed.length === 0) {
    el.innerHTML = `
      <div style="padding:28px 0;text-align:center;
                  font-size:12px;color:var(--text-muted);font-family:var(--mono)">
        No installed units at this venue yet
      </div>`;
    return;
  }

  // ── 3. Counter badge row ──────────────────────────────────────────────────
  const totalVenue = state.DATA.filter(d => d.venue === venueId).length;
  const pct        = totalVenue > 0 ? Math.round(installed.length / totalVenue * 100) : 0;

  // Distinct zones that have ≥1 installed unit (for the "N sections" chip)
  const installedZones = new Set(
    installed.filter(d => d.zone && d.zone !== '—').map(d => d.zone)
  );

  const header = `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px">

      <!-- ⚡ main counter -->
      <div style="display:flex;align-items:center;gap:7px;
                  background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.28);
                  border-radius:10px;padding:8px 14px;flex-shrink:0">
        <span style="font-size:16px;line-height:1">⚡</span>
        <span style="font-family:var(--mono);font-weight:800;font-size:16px;
                     color:var(--s4);letter-spacing:-.3px">${installed.length}</span>
        <span style="font-family:var(--mono);font-size:11px;color:var(--text-sub)">
          Installed
        </span>
      </div>

      <!-- ratio chip -->
      <div style="font-family:var(--mono);font-size:11px;color:var(--text-muted);
                  background:var(--surface);border-radius:8px;padding:6px 11px;
                  border:1px solid var(--border);flex-shrink:0">
        ${installed.length}&thinsp;/&thinsp;${totalVenue} units&ensp;·&ensp;${pct}%
      </div>

      ${installedZones.size > 0 ? `
      <!-- sections chip -->
      <div style="font-family:var(--mono);font-size:11px;color:var(--text-muted);
                  background:var(--surface);border-radius:8px;padding:6px 11px;
                  border:1px solid var(--border);flex-shrink:0">
        ${installedZones.size}&thinsp;section${installedZones.size !== 1 ? 's' : ''}
      </div>` : ''}

    </div>`;

  // ── 4. Unit rows ──────────────────────────────────────────────────────────
  // Each row: [Serial / ID] · [Zone badge] · [Model] · [● Installed]
  // Clickable → opens the detail modal.
  const rows = installed.map(u => {
    const sn    = u.digitalHeader || u.id;
    const zone  = (u.zone && u.zone !== '—') ? u.zone : null;
    const model = u.model || u.platform || '';

    const zoneBadge = zone
      ? `<span style="
            display:inline-flex;align-items:center;
            font-family:var(--mono);font-size:10px;font-weight:700;letter-spacing:.2px;
            background:rgba(34,197,94,.13);color:var(--s4);
            border:1px solid rgba(34,197,94,.30);border-radius:5px;
            padding:2px 8px;white-space:nowrap;flex-shrink:0">
          ${zone}
        </span>`
      : `<span style="font-family:var(--mono);font-size:10px;color:var(--text-muted);
                      flex-shrink:0">—</span>`;

    const modelChip = model
      ? `<span style="font-family:var(--mono);font-size:10px;color:var(--text-muted);
                      background:var(--surface);border-radius:4px;padding:1px 6px;
                      border:1px solid var(--border);flex-shrink:0">${model}</span>`
      : '';

    return `
      <div class="map-roster-row"
           onclick="openModal('${u.id}')"
           style="display:flex;align-items:center;gap:9px;
                  padding:9px 12px;border-radius:8px;margin-bottom:5px;
                  background:var(--card);border:1px solid var(--border);
                  cursor:pointer;transition:background .15s;
                  touch-action:manipulation;
                  -webkit-tap-highlight-color:transparent;
                  -webkit-user-select:none;user-select:none;
                  box-sizing:border-box;">

        <!-- Serial / unit name -->
        <span style="font-family:var(--mono);font-size:12px;font-weight:700;
                     color:var(--text);flex:1;min-width:0;
                     overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
        >${sn}</span>

        <!-- Zone badge — most important, prominently styled -->
        ${zoneBadge}

        <!-- Model chip -->
        ${modelChip}

        <!-- Status dot -->
        <span style="font-family:var(--mono);font-size:10px;font-weight:700;
                     color:var(--s4);white-space:nowrap;flex-shrink:0">● Installed</span>

      </div>`;
  }).join('');

  el.innerHTML = header + rows;
}

// ── UNASSIGNED LIST ───────────────────────────────────────────────────────────
// Units for this venue that have no zone value at all.
// Separate from "unmapped" (which have a zone string that couldn't be resolved).
function _renderUnassignedList() {
  const venueId    = _resolveVenueId();
  const unassigned = state.DATA.filter(
    d => d.venue === venueId && (!d.zone || d.zone === '—')
  );
  const section = document.getElementById('unassigned-section');

  if (unassigned.length === 0) {
    if (section) section.style.display = 'none';
    return;
  }

  if (section) section.style.display = '';
  document.getElementById('unassigned-count').textContent = `(${unassigned.length})`;
  document.getElementById('unassigned-list').innerHTML =
    unassigned.slice(0, 40).map(d =>
      `<button class="map-unit-chip" onclick="openModal('${d.id}')">${d.digitalHeader}</button>`
    ).join('') +
    (unassigned.length > 40
      ? `<div style="font-size:10px;color:var(--text-muted);padding:4px">+${unassigned.length - 40} more</div>`
      : '');
}

// ── ASSIGN MODAL ──────────────────────────────────────────────────────────────
export function openAssignModal(id) {
  openModal(id);
  showToast('Use Import Excel to assign venue & area');
}

// ── DEV TOOL — Admin Mapper toggle ────────────────────────────────────────────
// NOT called automatically. Activate manually from the browser console when
// you need to calibrate new %-based pin coordinates for Lincoln:
//
//   window.enableAdminMapper()
//
// Once enabled, switch to the Lincoln venue and click each section centre.
// The x%/y% is logged, toasted, and copied to clipboard automatically.
// Reloading the page disables it again (_mapperAttached resets to false).
// ─────────────────────────────────────────────────────────────────────────────
window.enableAdminMapper = function () {
  _initAdminMapper();
  showToast('🛠️ Admin Mapper ON — click the Lincoln map to capture % coords');
};
