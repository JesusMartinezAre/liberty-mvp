'use strict';

const admin                  = require('firebase-admin');
const { FIREBASE_PRIVATE_KEY } = require('./secrets');

function getAdmin() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  FIREBASE_PRIVATE_KEY,
      }),
    });
  }
  return admin;
}

function getDb()   { return getAdmin().firestore(); }
function getAuth() { return getAdmin().auth(); }

module.exports = { getAdmin, getDb, getAuth };
