'use strict';

const admin = require('firebase-admin');

function getAdmin() {
  if (!admin.apps.length) {
    const rawKey = process.env.FIREBASE_PRIVATE_KEY || '';
    const cleanKey = rawKey
      .replace(/\\n/g, '\n') // convert escaped newlines to real newlines
      .replace(/^"|"$/g, '') // strip surrounding quotes if Netlify added them
      .trim();

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  cleanKey,
      }),
    });
  }
  return admin;
}

function getDb()   { return getAdmin().firestore(); }
function getAuth() { return getAdmin().auth(); }

module.exports = { getAdmin, getDb, getAuth };
