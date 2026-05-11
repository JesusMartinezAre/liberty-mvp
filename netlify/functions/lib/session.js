'use strict';

// ── Session JWT helpers ────────────────────────────────────────────────────
// Issues and verifies short-lived HS256 JWTs for SAML-authenticated users.
// These tokens are verified by me.js using the same secret, without an
// external JWKS endpoint.

const SESSION_AUDIENCE = 'liberty-app';

function _getKey() {
  const secret = process.env.SESSION_JWT_SECRET;
  if (!secret) throw new Error('SESSION_JWT_SECRET is not configured.');
  return new TextEncoder().encode(secret);
}

function getIssuer() {
  return process.env.SESSION_JWT_ISSUER || 'app://liberty';
}

/**
 * Sign a session JWT (HS256, 8-hour TTL) containing the given claims.
 * Dynamic import works around jose's ESM-only build inside a CJS function.
 *
 * @param {Record<string, unknown>} claims
 * @returns {Promise<string>} Signed compact JWT
 */
async function signSession(claims) {
  const { SignJWT } = await import('jose');
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(getIssuer())
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(_getKey());
}

/**
 * Verify a session JWT and return the decoded payload.
 * Throws if the token is invalid, expired, or mismatched issuer/audience.
 *
 * @param {string} token
 * @returns {Promise<import('jose').JWTPayload>}
 */
async function verifySession(token) {
  const { jwtVerify } = await import('jose');
  const { payload } = await jwtVerify(token, _getKey(), {
    issuer:   getIssuer(),
    audience: SESSION_AUDIENCE,
  });
  return payload;
}

module.exports = { signSession, verifySession, getIssuer, SESSION_AUDIENCE };
