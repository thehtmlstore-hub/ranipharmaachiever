// Vercel's filesystem router uses a required catch-all segment for plain
// serverless functions. Keep the implementation in one module and expose it
// through this deployable route.
export { default } from './[[...path]].js';
