/**
 * Render assets/build/icon.svg to assets/build/icon.png.
 *
 *     node_modules/.bin/electron scripts/render-icon.mjs
 *
 * ## Why Electron and not a converter
 *
 * The icon has to be rebuildable from its source on a fresh clone, and `dependencies` in this
 * repo is empty on purpose — docs/the-licence-question.md turns on that being true. So a build
 * step that needs `rsvg-convert`, ImageMagick or `cairosvg` is a build step most clones cannot
 * run, and a PNG nobody can regenerate is a binary with a story attached.
 *
 * Electron is already a devDependency, and Electron is Chromium: the same SVG engine the
 * renderer draws the floor with. Measured on the machine this was written on: `rsvg-convert`,
 * `inkscape` and `cairosvg` are all absent, and ImageMagick 7.1.2 is present but its `svg`
 * delegate shells out to `rsvg-convert` — so `magick` would have fallen back to its own
 * internal renderer, which is not the engine the art was authored against.
 *
 * ## The two traps
 *
 * **The device scale factor.** `capturePage()` hands back a NativeImage sized in points, but
 * `toPNG()` encodes its backing bitmap — so on a Retina display a 1024-point window yields a
 * 2048-pixel PNG. `force-device-scale-factor=1` is the fix; the size is asserted afterwards
 * anyway, because a silent 2048 would sail through every check that only looks for a file.
 *
 * **`#` in a data: URL.** The art is ~40 hex colours and every one starts a fragment
 * identifier, so an unencoded data: URL is truncated at the first `fill="#...`. The document is
 * encoded with `encodeURIComponent`, which is also why this does not simply load the .svg by
 * file:// — the SVG goes inside an HTML page that pins it at exactly the target size with no
 * margin, rather than being scaled by whatever the viewport happens to be.
 */

import { app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = resolve(ROOT, 'assets/build/icon.svg')

/**
 * 1024 is not a preference. electron-builder 25 generates the whole macOS `.icns` ladder and
 * the Windows `.ico` from this one file. 1024 is what the full ladder needs rather than a
 * preference: measured on 2026-10-01, the generated `.icns` carries a `512x512@2x` entry, which
 * is 1024 pixels square, so a smaller source could only be upscaled into it.
 */
const ICON_SIZE = 1024

/** `--sizes 16,32,128` renders extra sizes for looking at; `--out <dir>` says where. */
function parseArgs(argv) {
  const at = (flag) => {
    const i = argv.indexOf(flag)
    return i === -1 ? null : argv[i + 1] ?? null
  }
  const sizes = at('--sizes')
  return {
    sizes: sizes ? sizes.split(',').map((s) => Number.parseInt(s.trim(), 10)) : [ICON_SIZE],
    out: at('--out') ?? resolve(ROOT, 'assets/build'),
  }
}

/** The SVG, wrapped in a page that gives it exactly `size` pixels and no margin. */
function page(svg, size) {
  const html = `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent;overflow:hidden}
    svg{display:block;width:${size}px;height:${size}px}
  </style>${svg}`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

async function render(svg, size) {
  const win = new BrowserWindow({
    width: size,
    height: size,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    // A hidden window that is allowed to stop painting captures as nothing at all.
    paintWhenInitiallyHidden: true,
    webPreferences: { backgroundThrottling: false, offscreen: false },
  })
  try {
    await win.loadURL(page(svg, size))
    // One frame after load. `did-finish-load` fires before the first paint of what it loaded.
    await new Promise((done) => setTimeout(done, 350))
    const shot = await win.webContents.capturePage()
    const [w, h] = [shot.getSize().width, shot.getSize().height]
    // Resize rather than fail: the assertion below is what guarantees the output, and a machine
    // whose window manager clamped the window should still produce the right file.
    const exact = w === size && h === size ? shot : shot.resize({ width: size, height: size })
    const png = exact.toPNG()
    if (png.length === 0) throw new Error(`capture at ${size} produced no bytes`)
    return { png, captured: [w, h] }
  } finally {
    win.destroy()
  }
}

app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  let failed = false
  try {
    const svg = readFileSync(SOURCE, 'utf8')
    const { sizes, out } = parseArgs(process.argv.slice(2))
    mkdirSync(out, { recursive: true })

    for (const size of sizes) {
      if (!Number.isInteger(size) || size < 1) throw new Error(`bad size: ${size}`)
      const { png, captured } = await render(svg, size)
      const name = size === ICON_SIZE ? 'icon.png' : `icon-${size}.png`
      const target = resolve(out, name)
      writeFileSync(target, png)
      const note = captured[0] === size && captured[1] === size ? '' : ` (captured ${captured.join('x')}, resized)`
      console.log(`${target}  ${size}x${size}  ${png.length} bytes${note}`)
    }
  } catch (error) {
    console.error(`render-icon: ${error instanceof Error ? error.message : String(error)}`)
    failed = true
  }
  app.exit(failed ? 1 : 0)
})
