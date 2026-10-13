/**
 * Where a transcript is looked up, and the one argument that decides it.
 *
 * `locateTranscript` builds `join(home, '.claude/projects', encodeCwd(cwd), `${sessionId}.jsonl`)`
 * — so the session id becomes a filename, and a `../` in it walks the read out of the projects
 * tree. Verified before the guard:
 *
 *     locateTranscript('../../../secrets', '/w', home)
 *     →  { state: 'found', path: '~/secrets.jsonl' }
 *
 * A read rather than a write, so this discloses instead of destroying — and the transcript panel
 * displaying an arbitrary `.jsonl` off somebody's disk is still not what it is for.
 *
 * The ids arrive from the session registry, a JSON file in the workspace that a person can edit.
 * That is the same reachability the `disable`/`enable` guards in `roster.ts` are written against.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { locateTranscript } from '../src/main/transcript-store.js'

import { tempDir } from './temp-dir.js'

async function fixture(t: TestContext): Promise<{ home: string; projects: string }> {
  const home = await tempDir(t, 'office-locate-')
  const projects = join(home, '.claude', 'projects')
  await mkdir(join(projects, '-w'), { recursive: true })
  await writeFile(join(projects, '-w', 'real.jsonl'), '{}\n')
  // Two things a traversal would aim at: one outside the projects tree entirely, and one in a
  // sibling project, which is another user's conversation rather than another user's file.
  await writeFile(join(home, 'secrets.jsonl'), '{"private":"do not show this"}\n')
  await writeFile(join(projects, 'sibling.jsonl'), '{"another":"project"}\n')
  // Claude Code's own global history, which sits beside `projects/` rather than inside it.
  await writeFile(join(home, '.claude', 'history.jsonl'), '{"every":"project"}\n')
  return { home, projects }
}

test('a session id cannot read a file outside its own project', async (t) => {
  const { home, projects } = await fixture(t)

  // Computed rather than counted. Three earlier attempts at this aimed the wrong number of `../`
  // and came back `missing`, which reads exactly like a guard working.
  const escape = relative(join(projects, '-w'), join(home, 'secrets.jsonl')).replace(/\.jsonl$/, '')
  assert.match(escape, /\.\./, 'the fixture is not actually a traversal')

  const out = await locateTranscript(escape, '/w', home)

  assert.notEqual(out.state, 'found', `it read ${out.state === 'found' ? out.path : ''}`)
  // And the refusal says which kind it is: `unreadable` carries a cause, `missing` would imply
  // the office looked in the right place and found nothing.
  assert.equal(out.state, 'unreadable')
})

test('...including one in a sibling project, which is somebody else\'s conversation', async (t) => {
  const { home } = await fixture(t)
  const out = await locateTranscript('../sibling', '/w', home)
  assert.notEqual(out.state, 'found')
})

test('a cwd cannot climb either, which is the other argument to the same join', async (t) => {
  /*
   * The path is `join(home, '.claude/projects', encodeCwd(cwd), `${sessionId}.jsonl`)`, and the
   * first version of this guard checked the *last* component only. `encodeCwd` replaces `/` with
   * `-`, which flattens any cwd containing a separator — and a cwd that is exactly `..` has no
   * separator to replace:
   *
   *     encodeCwd('/w/../..')  →  '-w-..-..'   flattened
   *     encodeCwd('..')        →  '..'          intact
   *
   *     locateTranscript('history', '..', home)  →  found: ~/.claude/history.jsonl
   *
   * One level, and one level is enough: `.claude/` holds Claude Code's own global history, which
   * is every project rather than this one. `cwd` comes from the same registry entry as the id.
   *
   * Found in review, in the call the traversal sweep had already visited and marked fixed —
   * because the sweep asked whether the *site* was guarded when what it had established was that
   * one *argument* was.
   */
  const { home } = await fixture(t)

  const out = await locateTranscript('history', '..', home)

  assert.notEqual(out.state, 'found', `it read ${out.state === 'found' ? out.path : ''}`)
})

test('a real session id still resolves, which is the half a refusing guard would break', async (t) => {
  // The other direction. A guard that refuses everything passes both tests above.
  const { home } = await fixture(t)
  const out = await locateTranscript('real', '/w', home)

  assert.equal(out.state, 'found', out.state === 'unreadable' ? out.cause : out.state)
  assert.match(out.state === 'found' ? out.path : '', /projects[/\\]-w[/\\]real\.jsonl$/)
})
