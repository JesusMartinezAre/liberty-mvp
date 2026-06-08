'use strict';

// ── Firebase Admin — shared singleton ────────────────────────────────────────
// Thin re-export of lib/firebaseAdmin so every _shared/ module uses one
// consistent import path and Firebase Admin is never initialised twice within
// the same Node.js runtime (double-init throws a "default app already exists"
// error that is hard to diagnose in Lambda/serverless contexts).
//
// Multi-tenant functions (new) import from here:
//   const { getDb } = require('./_shared/firebase');
//
// Existing lib/ functions (saml-callback, me, etc.) continue to
//   require('./lib/firebaseAdmin')
// until they are migrated in Step 2 — both paths resolve to the same singleton.

const { getDb, getAuth } = require('../lib/firebaseAdmin');

module.exports = { getDb, getAuth };
