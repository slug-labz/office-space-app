/**
 * Serve the dev harness, at a URL where it actually works.
 *
 * `docs/running.md` said `open dist/renderer/dev.html`, `mock.ts`'s own header said the same, and
 * **it does not work**. Measured in headless Chrome: `window.office` is `undefined`, the switcher
 * has no rows, and you get the chrome with an empty office — the same picture as an app that
 * failed to start, from a different cause.
 *
 * The cause is one directory. `mock.js` imports `../shared/ipc.js`, and `dist/renderer/dev.html`
 * opened directly resolves that above the document's root:
 *
 *     Failed to load resource: 404  /shared/ipc.js
 *     Failed to load resource: 404  /shared/controls.js
 *     net::ERR_ABORTED  Script
 *
 * The module never runs, so nothing can report it — which is why this had been wrong long enough
 * for two people to repeat it as a fact. Served from `dist/` it works: mock bridge installed,
 * eight switcher rows, the fixture office.
 *
 * No dependency. `node:http` and `node:fs` are enough for one directory of static files, and a
 * harness that needed an install to start would be one more reason not to use it.
 */

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(join(fileURLToPath(import.meta.url), '..', '..', 'dist'))
const port = Number(process.env['PORT'] ?? 8765)

const TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
])

const server = createServer(async (req, res) => {
  // `normalize` before joining, so `..` in a request cannot walk out of `dist/`. This serves a
  // build directory on localhost and nothing else, and it should still not be a way to read the
  // filesystem.
  const asked = normalize(decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/'))

  // A **redirect**, not the file served at `/`. Serving `dev.html`'s content from the root leaves
  // the document's base URL at `/`, so `mock.js` resolves to `/mock.js` and 404s — the same
  // one-directory fault this script exists to fix, reintroduced by the convenience. Measured:
  // `window.office` undefined and no switcher rows, from a server that had just printed the
  // right URL.
  if (asked === '/') {
    res.writeHead(302, { location: '/renderer/dev.html' }).end()
    return
  }

  const file = join(root, asked)
  if (!file.startsWith(root)) {
    res.writeHead(403).end('outside the build directory')
    return
  }

  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES.get(extname(file)) ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    // The 404 that mattered here was for a module, where the browser reports it and the page
    // says nothing. Naming the path in the body means a person who does hit one in the address
    // bar gets the answer rather than a bare code.
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`not in dist/: ${asked}\n\nRun \`npm run build\` first if this is a file you expect.`)
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`dev harness → http://127.0.0.1:${port}/renderer/dev.html`)
  console.log('the real renderer against a fake bridge: no Electron, no workspace, no spending.')
})
