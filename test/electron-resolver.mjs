/**
 * Resolve `electron` to the stub, so a module that imports it at top level can be loaded.
 *
 * `spotify/store.ts` imports `app` and `safeStorage` at module scope. In plain Node the real
 * package resolves to a path string, so the import throws before a test can reach anything — the
 * module was parked in the census for exactly that reason, and nothing else about it was in the
 * way.
 *
 * Registered by the one test that needs it rather than globally: a suite where every file
 * silently gets a fake Electron is a suite where "this runs in Electron" stops being a fact
 * anybody has to establish.
 */
const STUB = new URL('./electron-stub.mjs', import.meta.url).href

export async function resolve(specifier, context, next) {
  if (specifier === 'electron') return { url: STUB, shortCircuit: true, format: 'module' }
  return next(specifier, context)
}
