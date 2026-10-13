/**
 * Print what discovery sees in a workspace. Used to eyeball the floor's roster without
 * launching the app.
 *
 *   npm run discover -- [workspace-root]
 */

import { discoverWorkspace } from '../workspace.js'

const root = process.argv[2] ?? process.cwd()
const ws = await discoverWorkspace(root)

console.log(`\nWorkspace: ${ws.root}`)
console.log(`Scanned:   ${ws.scannedAt}\n`)

console.log(`STAFF (${ws.employees.length})`)
for (const e of ws.employees) {
  const tools = e.tools === null ? 'INHERITS ALL' : e.tools.join(', ')
  console.log(`  ${e.id.padEnd(16)} ${e.model ?? '-'}`)
  console.log(`  ${''.padEnd(16)} tools: ${tools}`)
  console.log(`  ${''.padEnd(16)} ${e.description.slice(0, 90)}`)
}

console.log(`\nSKILLS (${ws.skills.length})`)
for (const s of ws.skills) console.log(`  ${s.id.padEnd(16)} ${s.description.slice(0, 90)}`)

console.log(`\nPROBLEMS (${ws.problems.length})`)
if (ws.problems.length === 0) {
  console.log('  none — discovery was clean')
} else {
  for (const p of ws.problems) {
    if (p.kind === 'lint') console.log(`  [${p.rule}] ${p.path}\n      ${p.detail}`)
    else if (p.kind === 'no-frontmatter') console.log(`  [no-frontmatter] ${p.path}`)
    else console.log(`  [${p.kind}] ${p.path}\n      ${p.cause}`)
  }
}
console.log()
