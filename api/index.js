// Vercel exposes this one serverless function. vercel.json forwards every
// /api/* request here and preserves the original path in a query parameter.
export { default } from '../lib/portal-api.js';
