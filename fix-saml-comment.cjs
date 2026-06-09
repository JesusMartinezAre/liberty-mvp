'use strict';
const fs   = require('fs');
const FILE = 'C:/Users/it/Desktop/Proyectos/liberty/netlify/functions/lib/saml.js';
let   src  = fs.readFileSync(FILE, 'utf8');

// Pure-ASCII anchors confirmed from file inspection.
// BEFORE: last char before the formatCert comment block (a blank line \n\n).
// AFTER:  the first char of the line that starts the buildSamlInstance banner.
//         There is exactly one \n before 'function buildSamlInstance'.
const AFTER_FN   = '\nfunction buildSamlInstance(config) {';
const afterStart = src.indexOf(AFTER_FN);
if (afterStart === -1) { console.error('AFTER marker not found'); process.exit(1); }

// Find the closing brace of formatCert: it is }\n\n just before the banner.
// We can locate it as the last '}\n' before afterStart.
const formEnd = src.lastIndexOf('}\n\n', afterStart);
if (formEnd === -1) { console.error('formatCert closing } not found'); process.exit(1); }

// Find the start of the formatCert comment: last \n\n before 'function formatCert'.
const FN_START   = '\nfunction formatCert(raw) {';
const fnIdx      = src.indexOf(FN_START);
if (fnIdx === -1) { console.error('function formatCert not found'); process.exit(1); }
const blockStart = src.lastIndexOf('\n\n', fnIdx) + 2; // skip the two \n chars

console.log('blockStart:', blockStart, 'formEnd:', formEnd, 'afterStart:', afterStart);

// The replacement — every byte is ASCII (0x00-0x7F) except nothing above 0x7E.
const clean = [
  '// ── Certificate normaliser --------------------------------------------------',
  '// Accepts idpCert in any format Azure / Entra portal provides:',
  '//   - Raw base64  (continuous string, no headers)  <- most common paste',
  '//   - Full PEM    (with -----BEGIN/END CERTIFICATE----- headers)',
  '//   - base64url   (- and _ instead of + and /)',
  '//',
  '// Why this is necessary:',
  '//   The Azure portal clipboard and Firestore web console inject invisible',
  '//   Unicode chars that standard \s does not strip:',
  '//     U+00A0  non-breaking space  (portal cert-display renders NBSP)',
  '//     U+200B  zero-width space    (Azure Copy button injects silently)',
  '//     U+2028  line separator      (Windows/macOS clipboard variant)',
  '//',
  '//   CAUTION: U+2028 is a JavaScript LINE TERMINATOR. Inside a // comment it',
  '//   silently ends the comment; the rest becomes bare code -> SyntaxError at',
  '//   cold-start -> 502 with completely empty Netlify function logs.',
  '//',
  '//   node-saml v5 keyInfoToPem strips only \r\n, then tests',
  '//   /^[A-Za-z0-9+/=]*$/ -- any surviving invisible char fails and throws',
  '//   "idpCert is not in PEM format or in base64 format".',
  '//',
  '// Output: canonical PEM that node-saml v5 unconditionally accepts.',
  'function formatCert(raw) {',
  "  if (!raw || typeof raw !== 'string') {",
  "    throw new Error('[saml] idpCert is missing or not a string');",
  '  }',
  '',
  '  // 1. Strip PEM headers / footers if the full PEM was pasted.',
  '  let body = raw',
  "    .replace(/-----BEGIN CERTIFICATE-----/g, '')",
  "    .replace(/-----END CERTIFICATE-----/g, '');",
  '',
  '  // 2. Remove every character outside printable ASCII (U+0020..U+007E).',
  '  //    Standard \s covers only ASCII whitespace and misses U+00A0, U+200B,',
  '  //    and U+2028. Restricting to 0x20-0x7E removes all of them in one pass.',
  '  // eslint-disable-next-line no-control-regex',
  "  body = body.replace(/[^\x20-\x7E]/g, '');",
  '',
  '  // 3. Strip remaining printable whitespace (spaces, tabs).',
  "  body = body.replace(/\s/g, '');",
  '',
  '  if (!body) {',
  "    throw new Error('[saml] idpCert is empty after stripping headers');",
  '  }',
  '',
  '  // 4. Normalise base64url to standard base64.',
  "  body = body.replace(/-/g, '+').replace(/_/g, '/');",
  '',
  '  // 5. Validate: only standard base64 characters may remain.',
  '  if (!/^[A-Za-z0-9+/=]*$/.test(body)) {',
  '    throw new Error(',
  "      '[saml] idpCert contains invalid characters after normalisation -- ' +",
  "      're-paste from the Azure portal Certificate (Base64) download.',",
  '    );',
  '  }',
  '',
  '  // 6. Chunk into 64-character lines and wrap in PEM headers.',
  '  //    node-saml v5 always accepts this canonical form.',
  "  const lines = body.match(/.{1,64}/g) || [];",
  "  return '-----BEGIN CERTIFICATE-----\n' + lines.join('\n') + '\n-----END CERTIFICATE-----';",
  '}',
].join('\n');

// Assemble: everything before the comment block + clean block + everything from } onward
const result = src.slice(0, blockStart) + clean + '\n' + src.slice(formEnd + 1);
fs.writeFileSync(FILE, result, 'utf8');
console.log('done');
