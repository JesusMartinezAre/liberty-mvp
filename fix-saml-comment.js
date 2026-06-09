'use strict';
const fs   = require('fs');
const path = 'C:/Users/it/Desktop/Proyectos/liberty/netlify/functions/lib/saml.js';
let   src  = fs.readFileSync(path, 'utf8');

// Match the problematic comment block. [\s\S] crosses U+2028 (a JS line terminator)
// so the dotAll-style pattern works even though U+2028 looks like a newline to V8.
const bad = /\/\/ Why this is necessary:[\s\S]*?"idpCert is not in PEM format or in base64 format" error\./;

// Pure ASCII replacement — NO Unicode demonstration characters this time.
const good = [
  '// Why this is necessary:',
  '//   The Azure portal clipboard and Firestore web console inject invisible',
  '//   Unicode chars that standard \s does not strip:',
  '//     U+00A0  non-breaking space — portal cert-display renders spaces as NBSP',
  '//     U+200B  zero-width space   — Azure "Copy" button injects this silently',
  '//     U+2028  line separator     — Windows/macOS clipboard newline variant',
  '//              *** U+2028 is a JS line terminator: it ends a // comment early',
  '//              and leaves the rest as bare code, causing a parse error. ***',
  '//   node-saml v5 keyInfoToPem strips only \r\n, then runs',
  '//   /^[A-Za-z0-9+/=]*$/ — any surviving char fails that test and throws',
  '//   "idpCert is not in PEM format or in base64 format".',
].join('\n');

const next = src.replace(bad, good);
if (next === src) {
  console.error('PATTERN DID NOT MATCH — dumping lines around U+2028:');
  src.split('\n').forEach((line, i) => {
    if ([...line].some(c => c.codePointAt(0) > 0x7E)) {
      console.error(i + 1, JSON.stringify(line));
    }
  });
  process.exit(1);
}
fs.writeFileSync(path, next, 'utf8');
console.log('patched');
