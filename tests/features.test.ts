import type { SessionMeasureInput, TurnCompleteInput, TurnUsage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { BAND, engine, PANE, shown, SURFACES } from './helpers'

const NOW = Date.parse('2026-10-10T00:00:00Z')

const reading = (percentUsed: number): SessionMeasureInput => ({
  context: { window: 200_000 },
  rateLimits: [{ kind: 'five_hour', percentUsed, resetsAt: '2026-10-10T02:13:00Z' }],
  changed: ['rateLimits'],
})

const usage = (input: number, output: number, cacheRead: number, cacheWrite: number): TurnUsage => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheWrite,
  model: 'test-model',
})

function turnDone(extra: { durationMs?: number; usage?: TurnUsage; agentId?: string; isAborted?: boolean } = {}): TurnCompleteInput {
  return {
    reason: extra.isAborted ? 'aborted' : 'answer',
    answer: 'ok',
    durationMs: extra.durationMs ?? 5000,
    isAborted: extra.isAborted ?? false,
    turnId: 't1',
    ...(extra.agentId === undefined ? {} : { agentId: extra.agentId }),
    ...(extra.usage === undefined ? {} : { usage: extra.usage }),
  }
}

const CLEAR = { reason: 'clear', sessionId: 's1', resume: { id: 's1' } } as const

// ---- A1: rate-limit alerts, wired through session.measure ----

// Catches: the alert logic never being called from session.measure.
test('a reading below the default threshold toasts once, naming the window and what is left', async ($, on) => {
  mock.clock(on, { now: NOW })
  const { toasts } = engine(on)
  await $.session.measure(reading(82))
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toMatch(/5 小時/)
  expect(toasts[0]).toMatch(/18%/)
})

// Catches: the alert memory not surviving between measurements, so every turn toasts again.
test('the same level measured twice toasts only once', async ($, on) => {
  mock.clock(on, { now: NOW })
  const { toasts } = engine(on)
  await $.session.measure(reading(82))
  await $.session.measure(reading(83))
  expect(toasts.length).toBe(1)
})

// Catches: recovery going unannounced because the memory is never re-armed in the real hook.
test('recovering after an alert toasts the recovery', async ($, on) => {
  mock.clock(on, { now: NOW })
  const { toasts } = engine(on)
  await $.session.measure(reading(95))
  await $.session.measure(reading(45))
  expect(toasts.length).toBe(2)
  expect(toasts[1]).toMatch(/55%/)
})

// Catches: the alerts option being ignored.
test('alerts can be switched off', { options: { alerts: false } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const { toasts } = engine(on)
  await $.session.measure(reading(95))
  expect(toasts.length).toBe(0)
})

// Catches: the threshold option being ignored (the default 20,10 stays silent at 40% left).
test('the threshold option decides when to alert', { options: { alertThresholds: '50' } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const { toasts } = engine(on)
  await $.session.measure(reading(60))
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toMatch(/40%/)
})

// ---- B1: token counts, wired through turn.complete ----

// Catches: turn.complete usage never reaching the screen.
test('after a turn the band shows the token total', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.turn.complete(turnDone({ usage: usage(100, 20, 3000, 400) }))
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await shown(band)).toMatch(/3\.5k/)
    await band.unmount()
  }
})

// Catches: the pane dropping one of the four counts (cache reads dominate real usage).
test('the pane breaks the last turn into its four counts', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.turn.complete(turnDone({ usage: usage(1200, 3400, 5600, 7800) }))
  for (const surface of SURFACES) {
    const pane = await $.ui.mount({ ...PANE, surface })
    const text = await shown(pane)
    expect(text).toMatch(/1\.2k/)
    expect(text).toMatch(/3\.4k/)
    expect(text).toMatch(/5\.6k/)
    expect(text).toMatch(/7\.8k/)
    await pane.unmount()
  }
})

// Catches: subagent usage dropped from the session total, or shown as the last turn.
test('subagent tokens count toward the session but not the last turn', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.turn.complete(turnDone({ usage: usage(500, 100, 400, 0) }))
  await $.turn.complete(turnDone({ agentId: 'a1', usage: usage(7000, 1000, 0, 0) }))
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ ...BAND, surface })
    const text = await shown(band)
    expect(text).toMatch(/9\.0k/)
    expect(text).toMatch(/1\.0k/)
    expect(text).not.toMatch(/8\.0k/)
    await band.unmount()
  }
})

// Catches: a /clear leaving the previous conversation's totals on screen.
test('/clear resets the token totals', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.turn.complete(turnDone({ usage: usage(100, 20, 3000, 400) }))
  await $.session.end(CLEAR)
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await shown(band)).not.toMatch(/tok/i)
    await band.unmount()
  }
})

// Catches: the showTokens option being ignored.
test('token counts can be hidden', { options: { showTokens: false } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.turn.complete(turnDone({ usage: usage(100, 20, 3000, 400) }))
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await shown(band)).not.toMatch(/tok/i)
    await band.unmount()

    const pane = await $.ui.mount({ ...PANE, surface })
    expect(await shown(pane)).not.toMatch(/tok/i)
    await pane.unmount()
  }
})

// ---- C1: long-turn notification (opt-in) ----

// Catches: the notification being on by default.
test('long turns are silent by default', async ($, on) => {
  mock.clock(on, { now: NOW })
  const { notices } = engine(on)
  await $.turn.complete(turnDone({ durationMs: 600_000 }))
  expect(notices.length).toBe(0)
})

// Catches: the option doing nothing, or the duration missing from the message.
test('a turn over the limit notifies with how long it took', { options: { longTurnNotifySeconds: 60 } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const { notices } = engine(on)
  await $.turn.complete(turnDone({ durationMs: 90_000 }))
  expect(notices.length).toBe(1)
  expect(notices[0]).toMatch(/1m30s/)
})

// Catches: a comparison that notifies for every turn.
test('a turn under the limit stays silent', { options: { longTurnNotifySeconds: 60 } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const { notices } = engine(on)
  await $.turn.complete(turnDone({ durationMs: 30_000 }))
  expect(notices.length).toBe(0)
})

// Catches: announcing a turn the person interrupted themselves.
test('an interrupted turn stays silent', { options: { longTurnNotifySeconds: 60 } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const { notices } = engine(on)
  await $.turn.complete(turnDone({ durationMs: 90_000, isAborted: true }))
  expect(notices.length).toBe(0)
})

// Catches: one notification per subagent run instead of one per conversation turn.
test('a subagent turn stays silent', { options: { longTurnNotifySeconds: 60 } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const { notices } = engine(on)
  await $.turn.complete(turnDone({ durationMs: 90_000, agentId: 'a1' }))
  expect(notices.length).toBe(0)
})
