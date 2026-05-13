// ── DATA SERVICE — Relational Firestore → Legacy UI Adapter ───────────────────
// Subscribes to three collections simultaneously and emits a flat, joined array
// every time any collection changes. The emitted shape is 100% compatible with
// the existing render/filter/modal layer — no UI code needs to change.
//
// Collections:
//   venues          { id, name, location, section, gpsLocation, createdAt }
//   players         { id, unitSerialNumber, venueId, product, installed,
//                     technician, content, zone, platform, controller,
//                     controllerSN, routerSN, simCard, ipAddress, macAddress,
//                     bottler, status, notes, updatedAt, createdAt }
//   evidence_players { id, playerId, photos[], notes, changeHistory[] }

import { state } from './state.js';

// ── IN-MEMORY CACHES ──────────────────────────────────────────────────────────
// Each collection snapshot replaces its cache entirely (simple last-write-wins).
// Maps are keyed by Firestore document ID for O(1) join lookups.
let _venues   = {};   // { [venueId]:  venueDoc  }
let _players  = {};   // { [playerId]: playerDoc }
let _evidence = {};   // { [playerId]: evidenceDoc }  — indexed by playerId, not doc ID

// Gate: don't emit until every collection has delivered at least one snapshot.
// evidence_players may be an empty collection on first deploy — onSnapshot fires
// immediately with an empty snapshot, so this gate still resolves in one burst.
let _ready = { venues: false, players: false, evidence: false };

let _callback = null;
let _unsubs   = [];

// ── ADAPTER ───────────────────────────────────────────────────────────────────
// Maps one (player, venue, evidence) tuple to the legacy flat object shape.
// Every field the render/filter/modal layer touches is present here.
function adapt(player, venue, evidence) {
  // Status: prefer explicit player.status for intermediate pipeline stages;
  // installed === true always wins as the terminal state.
  const status = player.installed === true ? 'Installed at Venue' : 'Not Installed';

  const platform = !player.product ? '' : player.product === 'KOS' ? 'KOS' : 'POPA';

  return {
    // ── Identity ───────────────────────────────────────────────────────────
    id:            player.id,
    digitalHeader: player.unitSerialNumber || player.id,

    // ── Hardware ───────────────────────────────────────────────────────────
    model:         platform,
    platform:      platform,
    controller:    platform,
    controllerSN:  player.serialNumber  || '—',
    routerSN:      player.router_sn     || '—',
    simCard:       player.sim           || '—',
    bottler:       player.bottler       || 'Coca-Cola Liberty',

    // ── Deployment ─────────────────────────────────────────────────────────
    technician:    player.technician    || '—',
    content:       player.content       || '—',
    zone:          player.zone          || player.section || '—',
    installed:     player.installed     === true,

    // ── Venue JOIN ─────────────────────────────────────────────────────────
    // venue.id is expected to be the slug used throughout the UI
    // (e.g. 'metlife', 'lincoln', 'rockefeller').
    venue:         venue?.id            || player.venueId || '—',
    location:      venue?.location      || player.location || '—',
    section:       venue?.section       || player.section  || '—',

    // ── Pipeline status ────────────────────────────────────────────────────
    status,

    // ── Evidence JOIN ──────────────────────────────────────────────────────
    notes:         evidence?.notes      || player.notes  || '',
    photos:        evidence?.photos     || [],
    changeHistory: evidence?.changeHistory || [],

    // ── Timestamps ─────────────────────────────────────────────────────────
    updatedAt:     player.updatedAt     || null,
    createdAt:     player.createdAt     || null,
  };
}

// ── JOIN + EMIT ───────────────────────────────────────────────────────────────
function computeAndEmit() {
  if (!_ready.venues || !_ready.players || !_ready.evidence) return;
  if (!_callback) return;

  const items = Object.values(_players)
    .map(player => adapt(
      player,
      _venues[player.venueId],
      _evidence[player.id],
    ))
    .sort((a, b) => (a.digitalHeader || '').localeCompare(b.digitalHeader || ''));

  _callback(items);
}

// ── PUBLIC API ────────────────────────────────────────────────────────────────

/**
 * Attach real-time listeners to all three collections. Calls callback(items[])
 * once all collections have loaded, then again on every Firestore change.
 *
 * Returns an unsubscribe function — call it on sign-out to detach all listeners
 * and reset internal state.
 *
 * Usage in api.js / auth.js:
 *   const unsubscribe = subscribeToInventory(items => {
 *     state.DATA = items;
 *     renderAll();
 *   });
 */
export function subscribeToInventory(callback) {
  // Tear down any previous subscription so calling this twice is safe.
  if (_unsubs.length) {
    _unsubs.forEach(u => u());
    _unsubs = [];
  }
  _venues   = {};
  _players  = {};
  _evidence = {};
  _ready    = { venues: false, players: false, evidence: false };
  _callback = callback;

  const db = state.db;

  const unsubVenues = db.collection('venues').onSnapshot(
    snap => {
      _venues = {};
      snap.docs.forEach(d => { _venues[d.id] = { id: d.id, ...d.data() }; });
      _ready.venues = true;
      computeAndEmit();
    },
    err => console.error('[dataService] venues listener error:', err),
  );

  const unsubPlayers = db.collection('players').onSnapshot(
    snap => {
      _players = {};
      snap.docs.forEach(d => { _players[d.id] = { id: d.id, ...d.data() }; });
      _ready.players = true;
      computeAndEmit();
    },
    err => console.error('[dataService] players listener error:', err),
  );

  // evidence_players is indexed by playerId (not its own doc ID) so the
  // adapt() function can do a direct key lookup: _evidence[player.id].
  const unsubEvidence = db.collection('evidence_players').onSnapshot(
    snap => {
      _evidence = {};
      snap.docs.forEach(d => {
        const ev = { id: d.id, ...d.data() };
        if (ev.playerId) _evidence[ev.playerId] = ev;
      });
      _ready.evidence = true;
      computeAndEmit();
    },
    err => console.error('[dataService] evidence_players listener error:', err),
  );

  _unsubs = [unsubVenues, unsubPlayers, unsubEvidence];

  return function unsubscribe() {
    _unsubs.forEach(u => u());
    _unsubs   = [];
    _callback = null;
    _ready    = { venues: false, players: false, evidence: false };
    _venues   = {};
    _players  = {};
    _evidence = {};
  };
}
