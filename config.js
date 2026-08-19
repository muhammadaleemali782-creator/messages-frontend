// config.js
// The ONE place that knows where the backend lives. Change this to point the
// whole frontend at a different backend (local dev, staging, production) -
// nothing else in this project needs to change.
//
// This is deliberately NOT a secret - it's a public URL, same as any API
// endpoint a browser talks to. No API keys or credentials belong here; those
// stay server-side only (see backend/scripts/create-product.js).
const API_BASE = window.MESSAGES_API_BASE || 'https://messages-backend-e6pe.onrender.com';
