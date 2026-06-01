'use strict';

// ── Firebase Admin ─────────────────────────────────────────────────────────
const { getAdmin, getDb } = require('./lib/firebaseAdmin');
const admin               = getAdmin();
const db                  = getDb();
const USERS_COLLECTION    = 'users';

// ── Constants ──────────────────────────────────────────────────────────────
const SCIM_PREFIX       = '/scim/v2';
const SCIM_CONTENT_TYPE = 'application/scim+json';

// ── Auth guard ─────────────────────────────────────────────────────────────
// Returns 'entra' | 'okta' | null so callers can tag new users by source.
function authenticate(headers) {
  const authHeaderKey = Object.keys(headers).find(k => k.toLowerCase() === 'authorization');
  const raw = headers[authHeaderKey] || '';

  let token = null;
  if (raw.toLowerCase().startsWith('bearer ')) {
    token = raw.slice(7).trim();
  } else if (raw.length > 0) {
    token = raw.trim();
  }

  if (!token) return null;

  if (process.env.SCIM_AUTH_TOKEN_LIBERTY && token === process.env.SCIM_AUTH_TOKEN_LIBERTY) {
    return 'entra';
  }
  if (process.env.SCIM_AUTH_TOKEN && token === process.env.SCIM_AUTH_TOKEN) {
    return 'okta';
  }
  return null;
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

// ── Boolean coercion ───────────────────────────────────────────────────────
// Entra sends active as the string "False" / "True" in some PATCH payloads.
// Boolean("False") === true in JS (non-empty string), so we need explicit handling.
function coerceBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string')  return v.toLowerCase() !== 'false' && v !== '0';
  return Boolean(v);
}

// ── Path parser ────────────────────────────────────────────────────────────
// Strips the /scim/v2 prefix and returns { resource, resourceId }.
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
function toScimUser(docId, data) {
  const given  = data.givenName  || '';
  const family = data.familyName || '';
  return {
    schemas:     ['urn:ietf:params:scim:schemas:core:2.0:User'],
    id:          docId,
    externalId:  data.entraExternalId || data.oktaExternalId || null,
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
// Handles the SCIM filter subset both Okta and Entra actually send:
//   userName eq "email@domain.com"
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

  // No filter — return empty list. Both Okta and Entra drive sync via
  // POST/PUT/PATCH/DELETE; full enumeration is not required.
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
async function handlePostUsers(event, source) {
  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return scimError(400, 'Request body is not valid JSON.');
  }

  const email       = payload.userName || payload.emails?.[0]?.value || null;
  const givenName   = payload.name?.givenName  || '';
  const familyName  = payload.name?.familyName || '';
  const displayName = payload.name?.formatted  || `${givenName} ${familyName}`.trim();
  const externalId  = payload.externalId || null;
  const active      = coerceBool(payload.active !== undefined ? payload.active : true);

  if (!email) {
    return scimError(400, 'userName (email address) is required.', 'invalidValue');
  }

  // 409 Conflict instead of 200 — Entra's reconciliation logic expects this.
  const existing = await db.collection(USERS_COLLECTION)
    .where('email', '==', email)
    .limit(1)
    .get();

  if (!existing.empty) {
    return scimError(409, `User with userName "${email}" already exists.`, 'uniqueness');
  }

  const newRef = db.collection(USERS_COLLECTION).doc();
  const now    = admin.firestore.FieldValue.serverTimestamp();

  await newRef.set({
    id:               newRef.id,
    scimId:           newRef.id,
    entraExternalId:  source === 'entra' ? externalId : null,
    oktaExternalId:   source === 'okta'  ? externalId : null,
    userName:         email,
    email,
    givenName,
    familyName,
    displayName,
    active,
    role:             'viewer',
    groups:           [],
    source:           source === 'entra' ? 'entra-scim' : 'okta-scim',
    createdAt:        now,
    updatedAt:        now,
    lastProvisionedAt: now,
  });

  const created = await newRef.get();
  return respond(201, toScimUser(created.id, created.data()));
}

// ── PATCH /Users/{id} ─────────────────────────────────────────────────────
// Handles activate/deactivate. Two forms Entra and Okta send:
//   Form A: { op: 'replace', path: 'active', value: false | "False" }
//   Form B: { op: 'replace', value: { active: false | "False" } }
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
        updates.active = coerceBool(op.value);
      } else if (op.value && typeof op.value === 'object' && op.value.active !== undefined) {
        updates.active = coerceBool(op.value.active);
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
// Full replacement. Only overwrites the external ID field that belongs to
// the calling IdP — Okta's field is never clobbered by an Entra request.
async function handlePutUser(resourceId, event, source) {
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

  const existing    = snap.data();
  const email       = payload.userName || payload.emails?.[0]?.value || existing.email;
  const givenName   = payload.name?.givenName  || '';
  const familyName  = payload.name?.familyName || '';
  const displayName = payload.name?.formatted  || `${givenName} ${familyName}`.trim();
  const externalId  = payload.externalId || null;
  const active      = coerceBool(payload.active !== undefined ? payload.active : true);
  const now         = admin.firestore.FieldValue.serverTimestamp();

  const updates = {
    userName:          email,
    email,
    givenName,
    familyName,
    displayName,
    active,
    updatedAt:         now,
    lastProvisionedAt: now,
  };

  if (source === 'entra') updates.entraExternalId = externalId;
  if (source === 'okta')  updates.oktaExternalId  = externalId;

  await docRef.update(updates);
  const updated = await docRef.get();
  return respond(200, toScimUser(updated.id, updated.data()));
}

// ── DELETE /Users/{id} ────────────────────────────────────────────────────
// Soft-delete: sets active=false rather than removing the Firestore document.
// Hard deletion would break audit trails and linked evidence_players records.
async function handleDeleteUser(resourceId) {
  const docRef = db.collection(USERS_COLLECTION).doc(resourceId);
  const snap   = await docRef.get();

  if (!snap.exists) {
    return scimError(404, `User "${resourceId}" not found.`);
  }

  await docRef.update({
    active:            false,
    updatedAt:         admin.firestore.FieldValue.serverTimestamp(),
    lastProvisionedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // SCIM spec §3.6: successful DELETE returns 204 No Content with an empty body.
  return {
    statusCode: 204,
    headers:    { 'Content-Type': SCIM_CONTENT_TYPE },
    body:       '',
  };
}

// ── /Users router ──────────────────────────────────────────────────────────
async function handleUsers(method, resourceId, event, source) {
  if (method === 'GET'    && !resourceId) return handleGetUsers(event);
  if (method === 'GET'    &&  resourceId) return handleGetUserById(resourceId);
  if (method === 'POST')                  return handlePostUsers(event, source);
  if (method === 'PUT'    &&  resourceId) return handlePutUser(resourceId, event, source);
  if (method === 'PATCH'  &&  resourceId) return handlePatchUser(resourceId, event);
  if (method === 'DELETE' &&  resourceId) return handleDeleteUser(resourceId);
  return scimError(405, 'Method not allowed on /Users.');
}

// ── /ServiceProviderConfig ─────────────────────────────────────────────────
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
    // authenticate() returns 'entra' | 'okta' | null — null means unauthorized.
    const source = authenticate(event.headers);
    if (!source) {
      return scimError(401, 'Invalid or missing Bearer token.');
    }

    const method                   = event.httpMethod.toUpperCase();
    const { resource, resourceId } = parsePath(event.path);

    switch (resource) {
      case 'Users':
        return await handleUsers(method, resourceId, event, source);

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
