#!/usr/bin/env node
'use strict';

// ── SCIM Token Generator ──────────────────────────────────────────────────────
// Generates a cryptographically-secure SCIM bearer token and computes BOTH
// hashes required by the dual-hash strategy in scim-auth.js:
//
//   scimTokenSha256  →  SHA-256 hex digest  (stored in Firestore for O(1) index lookup)
//   scimTokenBcrypt  →  bcrypt hash         (stored in Firestore for final verification)
//
// Run once per tenant that needs SCIM access.
// The raw token is shown exactly once — save it in your secrets manager immediately.
//
// Usage:
//   node netlify/functions/_shared/token-generator.js
//   node netlify/functions/_shared/token-generator.js libertycoke.com
//   node netlify/functions/_shared/token-generator.js libertycoke.com --json
//
// Flags:
//   --json   Emit a single JSON object (for CI pipelines / secrets managers).

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// ── Config ────────────────────────────────────────────────────────────────────
// 12 rounds matches the BCRYPT_ROUNDS constant in password-login.js.
// The token generator runs once offline — the extra compute time is irrelevant.
const BCRYPT_ROUNDS = 12;

// ── Parse CLI args ─────────────────────────────────────────────────────────────
const args     = process.argv.slice(2);
const jsonMode = args.includes('--json');
const domain   = args.find(a => !a.startsWith('--')) || null;

// ── Main (async so we can await bcrypt.hash) ──────────────────────────────────
async function main() {
  // 32 random bytes = 256 bits of entropy.
  // base64url encoding: no padding (=), no + or / — safe in HTTP headers and
  // portal UIs without any percent-encoding.
  const rawToken = crypto.randomBytes(32).toString('base64url');

  // SHA-256 — uses the exact same one-liner as sha256Hex() in scim-auth.js.
  // If these ever diverge the lookup will silently break, so keep them identical.
  const sha256 = crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');

  // bcrypt — slow by design, but this script runs once, not per-request.
  process.stderr.write('Computing bcrypt hash (this takes a few seconds)…\n');
  const bcryptHash = await bcrypt.hash(rawToken, BCRYPT_ROUNDS);

  // ── JSON output ─────────────────────────────────────────────────────────────
  if (jsonMode) {
    process.stdout.write(
      JSON.stringify({
        domain:          domain || null,
        rawToken,
        scimTokenSha256: sha256,
        scimTokenBcrypt: bcryptHash,
      }, null, 2) + '\n',
    );
    return;
  }

  // ── Human-readable report ───────────────────────────────────────────────────
  const D = '─'.repeat(64);
  const domainLabel = domain || '{your-domain.com}';

  process.stdout.write(`
${D}
  SCIM Token Generator  ·  Dual-Hash Strategy
  Tenant: ${domainLabel}
${D}

  ① RAW BEARER TOKEN
  ────────────────────────────────────────────────────────────────
  Paste this into Entra ID Provisioning and Postman as the Bearer value.
  This is the ONLY time it will be shown.

     ${rawToken}

  ② FIRESTORE WRITE — sso_configs / ${domainLabel}
  ────────────────────────────────────────────────────────────────
  Set these TWO fields on the tenant document. Both are required.

     scimTokenSha256 : "${sha256}"
     scimTokenBcrypt : "${bcryptHash}"

  Also ensure these fields exist on the document:

     enabled         : true
     scimSource      : "entra"   (or "okta")
     domain          : "${domainLabel}"

  ③ ENTRA ID — Enterprise App → Provisioning → Admin Credentials
  ────────────────────────────────────────────────────────────────

     Tenant URL   :  https://<your-site>.netlify.app/scim/v2
     Secret Token :  ${rawToken}

  ④ POSTMAN — Authorization tab
  ────────────────────────────────────────────────────────────────

     Type  :  Bearer Token
     Token :  ${rawToken}

${D}
  HOW THE DUAL-HASH AUTH WORKS AT RUNTIME
  Phase 1 → scimTokenSha256 is queried as a Firestore index field (O(1)).
  Phase 2 → bcrypt.compare(rawToken, scimTokenBcrypt) is the final gate.
  Both phases must pass. A SHA-256 match alone is not sufficient.
${D}
  ⚠  SECURITY REMINDERS
  • The raw token above is shown ONCE. Store it in a secrets manager now.
  • ONLY the two hashes go in Firestore. Never store the raw token there.
  • Never commit the raw token to git or include it in logs or chat.
${D}
`);
}

main().catch(err => {
  process.stderr.write(`\n[token-generator] Fatal error: ${err.message}\n`);
  process.exit(1);
});
