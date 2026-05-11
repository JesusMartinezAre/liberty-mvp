'use strict';

// ── Just-In-Time Provisioning ──────────────────────────────────────────────
// Shared by the SAML callback and any future IdP flows.
// Matches the exact Firestore document shape used by scim.js on POST /Users.

const { getAdmin } = require('./firebaseAdmin');

const USERS_COLLECTION = 'users';

/**
 * Find an existing user in Firestore or create one with default permissions.
 *
 * Lookup order:
 *   1. userName == email
 *   2. email    == email
 *   3. oktaExternalId == externalId  (when provided)
 *   4. Create new document
 *
 * @param {import('firebase-admin').firestore.Firestore} db
 * @param {{ email: string, givenName: string, familyName: string,
 *           displayName: string, provider: string, externalId: string|null }} identity
 * @returns {Promise<{ docId: string, user: object }>}
 */
async function jitProvision(db, { email, givenName, familyName, displayName, provider, externalId }) {
  // ── 1 & 2. Email-based lookups ─────────────────────────────────────────────
  let snap = await db.collection(USERS_COLLECTION).where('userName', '==', email).limit(1).get();
  console.log('[jit] Attempt 1 (userName ==', email, ') → docs found:', snap.size);

  if (snap.empty) {
    snap = await db.collection(USERS_COLLECTION).where('email', '==', email).limit(1).get();
    console.log('[jit] Attempt 2 (email ==', email, ') → docs found:', snap.size);
  }

  // ── 3. External ID lookup ──────────────────────────────────────────────────
  if (snap.empty && externalId) {
    snap = await db.collection(USERS_COLLECTION)
      .where('oktaExternalId', '==', externalId)
      .limit(1)
      .get();
    console.log('[jit] Attempt 3 (oktaExternalId ==', externalId, ') → docs found:', snap.size);
  }

  // ── Return existing user ───────────────────────────────────────────────────
  if (!snap.empty) {
    const doc = snap.docs[0];
    console.log('[jit] Returning existing user doc:', doc.id);
    return { docId: doc.id, user: doc.data() };
  }

  // ── 4. Create new user ─────────────────────────────────────────────────────
  const admin  = getAdmin();
  const now    = admin.firestore.FieldValue.serverTimestamp();
  const newRef = db.collection(USERS_COLLECTION).doc();

  const resolvedDisplayName =
    displayName ||
    `${givenName || ''} ${familyName || ''}`.trim() ||
    email;

  await newRef.set({
    id:                newRef.id,
    scimId:            newRef.id,
    oktaExternalId:    externalId || null,
    userName:          email,
    email,
    givenName:         givenName  || '',
    familyName:        familyName || '',
    displayName:       resolvedDisplayName,
    active:            true,
    role:              'viewer',
    groups:            [],
    source:            `${provider}-jit`,
    createdAt:         now,
    updatedAt:         now,
    lastProvisionedAt: now,
  });

  const created = await newRef.get();
  console.log('[jit] Created new user doc:', created.id, '| source:', `${provider}-jit`);
  return { docId: created.id, user: created.data() };
}

module.exports = { jitProvision };
