'use strict';

// ── Firebase Admin ─────────────────────────────────────────────────────────
// Shared module handles init + the bulletproof private-key sanitisation.
// Both scim.js and me.js use the same singleton — no double-init risk.
const { getAdmin, getDb } = require('./lib/firebaseAdmin');
const admin               = getAdmin();
const db                  = getDb();
const USERS_COLLECTION    = 'users';

// ── Constants ──────────────────────────────────────────────────────────────
const SCIM_PREFIX       = '/scim/v2';
const SCIM_CONTENT_TYPE = 'application/scim+json';

// ── Auth guard ─────────────────────────────────────────────────────────────
// Okta sends:  Authorization: Bearer <token>
// Token must match the SCIM_AUTH_TOKEN env var set in Netlify dashboard.
function authenticate(headers) {
  // 1. Buscamos la cabecera sin importar si es 'authorization', 'Authorization' o 'AUTHORIZATION'
  const authHeaderKey = Object.keys(headers).find(k => k.toLowerCase() === 'authorization');
  const raw = headers[authHeaderKey] || '';

  console.log("--- DEBUG DE CABECERAS ---");
  console.log("Cabecera encontrada:", authHeaderKey || "NINGUNA");
  console.log("Valor crudo recibido:", raw);

  // 2. Extraemos el token:
  // Si empieza con "Bearer ", le quitamos eso. Si no, tomamos el valor tal cual.
  let token = null;
  if (raw.toLowerCase().startsWith('bearer ')) {
    token = raw.slice(7).trim();
  } else if (raw.length > 0) {
    token = raw.trim();
  }

  // 3. Accepted tokens — any configured token grants access.
  // Add SCIM_AUTH_TOKEN_LIBERTY (or more) in Netlify env vars to allow
  // a second system to push users without sharing the primary token.
  const VALID_TOKENS = [
    process.env.SCIM_AUTH_TOKEN,
    process.env.SCIM_AUTH_TOKEN_LIBERTY,
  ].filter(Boolean);

  console.log("Token extraído final:", `[${token}]`);
  console.log("Tokens válidos configurados:", VALID_TOKENS.length);

  const matches = token && VALID_TOKENS.some(t => t === token);
  console.log("¿Coinciden?:", !!matches);

  return !!matches;
}

// ── Response helpers ───────────────────────────────────────────────────────
function respond(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': SCIM_CONTENT_TYPE },
    body: JSON.stringify(body),
  };
}

function scimError(status, detail, scimType) {
  const body = {
    schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
    status:  String(status),
    detail,
  };
  if (scimType) body.scimType = scimType;
  return respond(status, body);
}

function notImplemented(detail) {
  return scimError(501, detail);
}

// ── Path parser ────────────────────────────────────────────────────────────
// Strips the /scim/v2 prefix and returns { resource, resourceId }.
// Examples:
//   /scim/v2/Users          → { resource: 'Users', resourceId: null }
//   /scim/v2/Users/abc123   → { resource: 'Users', resourceId: 'abc123' }
function parsePath(path) {
  const relative = path.startsWith(SCIM_PREFIX)
    ? path.slice(SCIM_PREFIX.length)
    : path;
  const parts = relative.replace(/^\//, '').split('/');
  return {
    resource:   parts[0] || '',
    resourceId: parts[1] || null,
  };
}

// ── SCIM ↔ Firestore mappers ───────────────────────────────────────────────
// Converts a Firestore user document into a SCIM 2.0 User object.
function toScimUser(docId, data) {
  const given  = data.givenName  || '';
  const family = data.familyName || '';
  return {
    schemas:     ['urn:ietf:params:scim:schemas:core:2.0:User'],
    id:          docId,
    externalId:  data.oktaExternalId || null,
    userName:    data.userName || data.email,
    name: {
      formatted:  data.displayName || `${given} ${family}`.trim(),
      givenName:  given,
      familyName: family,
    },
    displayName: data.displayName || `${given} ${family}`.trim(),
    emails:      [{ value: data.email, primary: true, type: 'work' }],
    active:      data.active !== false,
    meta: {
      resourceType: 'User',
      location:     `/scim/v2/Users/${docId}`,
    },
  };
}

// ── Filter parser ──────────────────────────────────────────────────────────
// Handles the SCIM filter subset Okta actually sends:
//   userName eq "email@domain.com"
// Returns { field: 'username', value: '...' } (field is lowercased), or null.
function parseFilter(filterStr) {
  if (!filterStr) return null;
  const match = filterStr.match(/^(\w+)\s+eq\s+"([^"]+)"$/i);
  if (!match) return null;
  return { field: match[1].toLowerCase(), value: match[2] };
}

// ── GET /Users ─────────────────────────────────────────────────────────────
async function handleGetUsers(event) {
  const filter = (event.queryStringParameters || {}).filter;
  const parsed = parseFilter(filter);

  if (parsed) {
    // Okta uses filter=userName eq "..." to check existence before provisioning.
    if (parsed.field !== 'username') {
      return scimError(400, `Unsupported filter field: "${parsed.field}".`, 'invalidFilter');
    }

    const snap = await db.collection(USERS_COLLECTION)
      .where('email', '==', parsed.value)
      .limit(1)
      .get();

    if (snap.empty) {
      return respond(200, {
        schemas:      ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
        totalResults: 0,
        startIndex:   1,
        itemsPerPage: 0,
        Resources:    [],
      });
    }

    const doc = snap.docs[0];
    return respond(200, {
      schemas:      ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: 1,
      startIndex:   1,
      itemsPerPage: 1,
      Resources:    [toScimUser(doc.id, doc.data())],
    });
  }

  // No filter — return empty list. Full user enumeration is not required
  // for Okta JIT provisioning; Okta drives sync via POST, PATCH, and DELETE.
  return respond(200, {
    schemas:      ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    totalResults: 0,
    startIndex:   1,
    itemsPerPage: 0,
    Resources:    [],
  });
}

// ── GET /Users/{id} ────────────────────────────────────────────────────────
async function handleGetUserById(resourceId) {
  const snap = await db.collection(USERS_COLLECTION).doc(resourceId).get();
  if (!snap.exists) {
    return scimError(404, `User "${resourceId}" not found.`);
  }
  return respond(200, toScimUser(snap.id, snap.data()));
}

// ── POST /Users ────────────────────────────────────────────────────────────
async function handlePostUsers(event) {
  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return scimError(400, 'Request body is not valid JSON.');
  }

  const email           = payload.userName || payload.emails?.[0]?.value || null;
  const givenName       = payload.name?.givenName  || '';
  const familyName      = payload.name?.familyName || '';
  const displayName     = payload.name?.formatted  || `${givenName} ${familyName}`.trim();
  const oktaExternalId  = payload.externalId || payload.id || null;
  const active          = payload.active !== false;

  if (!email) {
    return scimError(400, 'userName (email address) is required.', 'invalidValue');
  }

  // Idempotency: return the existing user rather than creating a duplicate.
  const existing = await db.collection(USERS_COLLECTION)
    .where('email', '==', email)
    .limit(1)
    .get();

  if (!existing.empty) {
    const doc = existing.docs[0];
    return respond(200, toScimUser(doc.id, doc.data()));
  }

  // Pre-generate the document reference so we can embed the ID inside the document.
  const newRef = db.collection(USERS_COLLECTION).doc();
  const now    = admin.firestore.FieldValue.serverTimestamp();
  await newRef.set({
    id:                newRef.id,
    scimId:            newRef.id,
    oktaExternalId,
    userName:          email,
    email,
    givenName,
    familyName,
    displayName,
    active,
    role:              'viewer',
    groups:            [],
    source:            'okta-scim',
    createdAt:         now,
    updatedAt:         now,
    lastProvisionedAt: now,
  });

  const created = await newRef.get();
  return respond(201, toScimUser(created.id, created.data()));
}

// ── PATCH /Users/{id} ─────────────────────────────────────────────────────
// Okta uses PATCH to activate and deactivate users.
// It sends a PatchOp payload in two possible forms:
//   Form A: { op: 'replace', path: 'active', value: false }
//   Form B: { op: 'replace', value: { active: false } }
async function handlePatchUser(resourceId, event) {
  const docRef = db.collection(USERS_COLLECTION).doc(resourceId);
  const snap   = await docRef.get();

  if (!snap.exists) {
    return scimError(404, `User "${resourceId}" not found.`);
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return scimError(400, 'Request body is not valid JSON.');
  }

  const ops     = Array.isArray(payload.Operations) ? payload.Operations : [];
  const updates = {};

  for (const op of ops) {
    const opType = (op.op || '').toLowerCase();

    if (opType === 'replace') {
      if (op.path === 'active' && op.value !== undefined) {
        // Form A
        updates.active = Boolean(op.value);
      } else if (op.value && typeof op.value === 'object' && op.value.active !== undefined) {
        // Form B
        updates.active = Boolean(op.value.active);
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    // No supported ops — return current state unchanged (SCIM spec §3.5.2).
    return respond(200, toScimUser(snap.id, snap.data()));
  }

  updates.updatedAt         = admin.firestore.FieldValue.serverTimestamp();
  updates.lastProvisionedAt = admin.firestore.FieldValue.serverTimestamp();
  await docRef.update(updates);
  const updated = await docRef.get();
  return respond(200, toScimUser(updated.id, updated.data()));
}

// ── PUT /Users/{id} ───────────────────────────────────────────────────────
// Full replacement — Okta sends the complete user object.
// Immutable fields (id, scimId, createdAt, source) are preserved.
async function handlePutUser(resourceId, event) {
  const docRef = db.collection(USERS_COLLECTION).doc(resourceId);
  const snap   = await docRef.get();

  if (!snap.exists) {
    return scimError(404, `User "${resourceId}" not found.`);
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return scimError(400, 'Request body is not valid JSON.');
  }

  const email          = payload.userName || payload.emails?.[0]?.value || snap.data().email;
  const givenName      = payload.name?.givenName  || '';
  const familyName     = payload.name?.familyName || '';
  const displayName    = payload.name?.formatted  || `${givenName} ${familyName}`.trim();
  const oktaExternalId = payload.externalId || payload.id || snap.data().oktaExternalId || null;
  const active         = payload.active !== false;
  const now            = admin.firestore.FieldValue.serverTimestamp();

  await docRef.update({
    oktaExternalId,
    userName:          email,
    email,
    givenName,
    familyName,
    displayName,
    active,
    updatedAt:         now,
    lastProvisionedAt: now,
  });

  const updated = await docRef.get();
  return respond(200, toScimUser(updated.id, updated.data()));
}

// ── /Users router ──────────────────────────────────────────────────────────
async function handleUsers(method, resourceId, event) {
  if (method === 'GET'    && !resourceId) return handleGetUsers(event);
  if (method === 'GET'    &&  resourceId) return handleGetUserById(resourceId);
  if (method === 'POST')                  return handlePostUsers(event);
  if (method === 'PUT'    &&  resourceId) return handlePutUser(resourceId, event);
  if (method === 'PATCH'  &&  resourceId) return handlePatchUser(resourceId, event);
  if (method === 'DELETE' &&  resourceId) return notImplemented('DELETE /Users/{id} not yet implemented.');
  return scimError(405, 'Method not allowed on /Users.');
}

// ── /ServiceProviderConfig ─────────────────────────────────────────────────
// Real response — Okta fetches this on first connection to discover our
// capabilities. Listing the features we actually plan to support.
function handleServiceProviderConfig() {
  return respond(200, {
    schemas:          ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    documentationUri: '',
    patch:            { supported: true },
    bulk:             { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter:           { supported: true, maxResults: 200 },
    changePassword:   { supported: false },
    sort:             { supported: false },
    etag:             { supported: false },
    authenticationSchemes: [
      {
        name:        'OAuth Bearer Token',
        description: 'Authentication via Bearer token in the Authorization header.',
        specUri:     'http://www.rfc-editor.org/info/rfc6750',
        type:        'oauthbearertoken',
        primary:     true,
      },
    ],
  });
}

// ── Main handler ───────────────────────────────────────────────────────────
exports.handler = async (event) => {
  try {
    // 1. Auth — every SCIM request must carry a valid Bearer token.
    if (!authenticate(event.headers)) {
      return scimError(401, 'Invalid or missing Bearer token.');
    }

    const method                   = event.httpMethod.toUpperCase();
    const { resource, resourceId } = parsePath(event.path);

    // 2. Route by SCIM resource type.
    switch (resource) {
      case 'Users':
        return await handleUsers(method, resourceId, event);

      case 'ServiceProviderConfig':
        return method === 'GET'
          ? handleServiceProviderConfig()
          : scimError(405, 'Method not allowed on /ServiceProviderConfig.');

      // Discovery endpoints — return empty lists until Groups are implemented.
      case 'ResourceTypes':
      case 'Schemas':
        return respond(200, {
          schemas:      ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
          totalResults: 0,
          Resources:    [],
        });

      default:
        return scimError(404, `Resource type "${resource}" not found.`);
    }
  } catch (err) {
    console.error('[SCIM] Unhandled error:', err);
    return scimError(500, 'Internal server error.');
  }
};
