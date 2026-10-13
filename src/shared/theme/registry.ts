/**
 * Theme discovery.
 *
 * Finds art packs a user has installed into their own workspace. It reads manifests and
 * validates them; it does **not** decode images — the renderer does that, because a browser
 * already decodes PNG natively and writing a decoder in Node would be inventing work.
 *
 * ## The licence position, encoded
 *
 * Office Space ships exactly one theme's art: the procedural one. Every commercial pixel pack
 * we costed — six of them, independently — permits commercial use and forbids redistribution,
 * so a user's purchased art lives in their workspace, is gitignored, and is never committed.
 * This module is what lets them use it anyway.
 *
 * ## The rule
 *
 * A theme that is installed but broken is **reported**. Someone who paid for art and dropped
 * it in is owed an error message, not a silent downgrade to the built-in cast while they
 * wonder why nothing changed.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ThemeProblem } from './theme.js'
import { PROCEDURAL_THEME_ID } from './procedural.js'

/** Where a user drops their own licensed art. Gitignored; never shipped. */
export const THEMES_DIR = join('assets', 'themes')

const MANIFEST = 'theme.json'

/**
 * A theme found on disk, validated but not yet loaded.
 *
 * The renderer turns one of these into a `CharacterTheme` by decoding `sheets` and slicing
 * them according to `layout`.
 */
export interface ThemeDescriptor {
  readonly id: string
  readonly name: string
  readonly credit: string
  readonly directory: string
  readonly frameWidth: number
  readonly frameHeight: number
  /** Sheet filenames, relative to `directory`. One agent is assigned one sheet by hash. */
  readonly sheets: readonly string[]
  readonly layout: {
    /** Row index within the sheet for each facing. `left` is `right`, mirrored. */
    readonly rows: { readonly down: number; readonly up: number; readonly right: number }
    /** Column indices of the three walk steps. */
    readonly steps: readonly [number, number, number]
  }
}

export interface ThemeScan {
  readonly themes: readonly ThemeDescriptor[]
  readonly problems: readonly ThemeProblem[]
}

function fail(themeId: string, path: string, reason: string): ThemeProblem {
  return { themeId, path, reason }
}

/** Validate a parsed manifest. Returns the descriptor, or the reason it is unusable. */
function validate(raw: unknown, directory: string, fallbackId: string): ThemeDescriptor | string {
  if (typeof raw !== 'object' || raw === null) return 'manifest is not an object'
  const m = raw as Record<string, unknown>

  const id = typeof m['id'] === 'string' && m['id'].trim() ? m['id'].trim() : fallbackId
  if (id === PROCEDURAL_THEME_ID) return `"${PROCEDURAL_THEME_ID}" is reserved for the built-in theme`

  const name = typeof m['name'] === 'string' && m['name'].trim() ? m['name'].trim() : id

  // Credit is mandatory, not decorative. Nearly every licence that permits commercial use
  // requires attribution, and a theme that cannot state its own is a theme we will not load.
  const credit = typeof m['credit'] === 'string' ? m['credit'].trim() : ''
  if (!credit) return 'missing "credit" — attribution is required by most asset licences'

  const frameWidth = Number(m['frameWidth'])
  const frameHeight = Number(m['frameHeight'])
  if (!Number.isInteger(frameWidth) || frameWidth <= 0) return 'frameWidth must be a positive integer'
  if (!Number.isInteger(frameHeight) || frameHeight <= 0) return 'frameHeight must be a positive integer'

  const sheets = m['sheets']
  if (!Array.isArray(sheets) || sheets.length === 0) return 'sheets must be a non-empty array'
  if (!sheets.every((s) => typeof s === 'string' && s.length > 0)) return 'sheets must be filenames'

  const layout = m['layout']
  if (typeof layout !== 'object' || layout === null) return 'missing "layout"'
  const l = layout as Record<string, unknown>

  const rows = l['rows'] as Record<string, unknown> | undefined
  if (!rows) return 'missing "layout.rows"'
  for (const facing of ['down', 'up', 'right']) {
    if (!Number.isInteger(rows[facing])) return `layout.rows.${facing} must be an integer`
  }

  const steps = l['steps']
  if (!Array.isArray(steps) || steps.length !== 3 || !steps.every((s) => Number.isInteger(s))) {
    return 'layout.steps must be exactly three integers'
  }

  return {
    id,
    name,
    credit,
    directory,
    frameWidth,
    frameHeight,
    sheets: sheets as string[],
    layout: {
      rows: {
        down: rows['down'] as number,
        up: rows['up'] as number,
        right: rows['right'] as number,
      },
      steps: steps as [number, number, number],
    },
  }
}

/**
 * Scan a workspace for installed themes.
 *
 * Never throws. A missing themes directory is not a problem — it is the normal state of a
 * fresh clone, and means exactly "no themes installed". A directory that *exists* but cannot
 * be read is a problem, and the difference between those two is the whole point.
 */
export async function scanThemes(workspaceRoot: string): Promise<ThemeScan> {
  const root = join(workspaceRoot, THEMES_DIR)
  const themes: ThemeDescriptor[] = []
  const problems: ThemeProblem[] = []

  let entries: string[]
  try {
    entries = await readdir(root)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { themes, problems }
    return {
      themes,
      problems: [fail('*', root, `cannot read themes directory: ${(err as Error).message}`)],
    }
  }

  for (const entry of entries.filter((e) => !e.startsWith('.')).sort()) {
    const directory = join(root, entry)

    try {
      if (!(await stat(directory)).isDirectory()) continue
    } catch {
      continue
    }

    const manifestPath = join(directory, MANIFEST)

    let text: string
    try {
      text = await readFile(manifestPath, 'utf8')
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      problems.push(
        fail(
          entry,
          manifestPath,
          code === 'ENOENT' ? `no ${MANIFEST} — see docs/themes.md` : `unreadable: ${(err as Error).message}`,
        ),
      )
      continue
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (err) {
      problems.push(fail(entry, manifestPath, `invalid JSON: ${(err as Error).message}`))
      continue
    }

    const result = validate(parsed, directory, entry)
    if (typeof result === 'string') {
      problems.push(fail(entry, manifestPath, result))
      continue
    }

    // Every declared sheet must actually be present. A manifest that promises art it does not
    // have would otherwise fail much later, in the renderer, as a blank character.
    const missing: string[] = []
    for (const sheet of result.sheets) {
      try {
        await stat(join(directory, sheet))
      } catch {
        missing.push(sheet)
      }
    }
    if (missing.length > 0) {
      problems.push(fail(result.id, manifestPath, `missing sheet(s): ${missing.join(', ')}`))
      continue
    }

    themes.push(result)
  }

  return { themes, problems }
}
