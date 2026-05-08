'use strict';

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/scim+json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
    body: JSON.stringify(body, null, 2),
  };
}

function appJson(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
    body: JSON.stringify(body, null, 2),
  };
}

function noContent() {
  return { statusCode: 204, headers: { 'Cache-Control': 'no-store' }, body: '' };
}

module.exports = { json, appJson, noContent };
