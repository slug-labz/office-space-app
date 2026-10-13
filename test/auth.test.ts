/**
 * Which account pays for this.
 *
 * The reason this file exists at all is that `VISION.md` §7.1 calls the detection a hard
 * requirement and `docs/auth.md` asserted the office already did it, and neither was true —
 * `grep -rn ANTHROPIC_API_KEY src` returned nothing. That combination is the worst one
 * available: the claim was documented, so nobody went looking.
 *
 * These tests are deliberately about the *shape* of the environment rather than about any
 * value, because the module never reads a value and must not start.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { billingRoute, billingWarning } from '../src/main/auth.js'

test('a clean environment is on the subscription, and says nothing', () => {
  const billing = billingRoute({ PATH: '/usr/bin', HOME: '/Users/someone' })
  assert.deepEqual(billing, { state: 'subscription' })
  // An office that warns about the ordinary case teaches people to dismiss its warnings.
  assert.equal(billingWarning(billing), null)
})

test('an exported API key is caught', () => {
  const billing = billingRoute({ ANTHROPIC_API_KEY: 'sk-ant-somethingsomething' })
  assert.equal(billing.state, 'redirected')
  assert.equal(billing.state === 'redirected' && billing.shadows[0]?.name, 'ANTHROPIC_API_KEY')
})

test('an EMPTY API key is caught, and named as the trap it is', () => {
  // The case the obvious check misses. `if (process.env.ANTHROPIC_API_KEY)` is false here, and
  // the variable still occupies its slot in the precedence order and still wins. It is also the
  // state a half-finished `unset` leaves behind, so it is the likely accident rather than an
  // exotic one.
  const billing = billingRoute({ ANTHROPIC_API_KEY: '' })
  assert.equal(billing.state, 'redirected')
  assert.equal(billing.state === 'redirected' && billing.shadows[0]?.blank, true)

  const warning = billingWarning(billing)
  assert.match(warning ?? '', /empty string, which still counts as set/)
  assert.match(warning ?? '', /genuinely unset, not blank/)
})

test('the warning names the variable and the exact fix', () => {
  const warning = billingWarning(billingRoute({ ANTHROPIC_API_KEY: 'sk-ant-x' })) ?? ''
  assert.match(warning, /ANTHROPIC_API_KEY is set/)
  assert.match(warning, /billed at API rates instead of on your subscription/)
  assert.match(warning, /unset ANTHROPIC_API_KEY/)
})

test('the key itself never appears in the warning', () => {
  // The module holds no credential and this is the assertion that keeps it that way. A warning
  // is exactly the kind of string that ends up in a screenshot or a pasted issue.
  const secret = 'sk-ant-do-not-print-me-0123456789'
  const warning = billingWarning(billingRoute({ ANTHROPIC_API_KEY: secret })) ?? ''
  assert.ok(!warning.includes(secret), 'the credential leaked into a user-facing message')
  assert.ok(!warning.includes('sk-ant'), 'a credential prefix leaked into a user-facing message')
})

test('an auth token is caught too', () => {
  const billing = billingRoute({ ANTHROPIC_AUTH_TOKEN: 'tok' })
  assert.equal(billing.state, 'redirected')
  assert.match(billingWarning(billing) ?? '', /ANTHROPIC_AUTH_TOKEN is set/)
})

test('a provider flag is a switch, so off means off', () => {
  // Unlike a key, whose presence alone occupies the slot. `CLAUDE_CODE_USE_BEDROCK=0` is
  // somebody who turned it off, and warning them would be noise.
  for (const off of ['0', 'false', 'no', 'off', '', '  ']) {
    assert.deepEqual(
      billingRoute({ CLAUDE_CODE_USE_BEDROCK: off }),
      { state: 'subscription' },
      `treated ${JSON.stringify(off)} as switched on`,
    )
  }
  for (const on of ['1', 'true', 'yes']) {
    assert.equal(billingRoute({ CLAUDE_CODE_USE_BEDROCK: on }).state, 'redirected')
  }
})

test('two redirects are both reported, not just the first', () => {
  const billing = billingRoute({ ANTHROPIC_API_KEY: 'k', CLAUDE_CODE_USE_VERTEX: '1' })
  assert.equal(billing.state === 'redirected' && billing.shadows.length, 2)
  const warning = billingWarning(billing) ?? ''
  assert.match(warning, /ANTHROPIC_API_KEY/)
  assert.match(warning, /CLAUDE_CODE_USE_VERTEX/)
})
