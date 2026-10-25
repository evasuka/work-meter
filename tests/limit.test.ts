import type { SessionMeasureInput } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { BAND, engine, RUN, shown, SURFACES } from './helpers'

const NOW = Date.parse('2026-10-25T00:00:00Z')
const R1 = '2026-10-25T02:13:00Z' // 2h13m after NOW
const PAST_RESET = 134 * 60 * 1000 // 2h14m

const reading = (percentUsed: number, resetsAt: string = R1): SessionMeasureInput => ({
  context: { window: 200_000 },
  rateLimits: [{ kind: 'five_hour', percentUsed, resetsAt }],
  changed: ['rateLimits'],
})

const typed = { text: 'hi', wait: false, origin: { kind: 'composer' } } as const
const RESUME = { ...RUN, command: 'meter', args: 'resume' } as const

// Catches: the guard never aborting, so the running turn keeps burning extra usage.
test('running out of the five-hour window aborts the running turn', async ($, on) => {
  mock.clock(on, { now: NOW })
  const { aborts } = engine(on)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.session.measure(reading(100))
  expect(aborts).toEqual(['t1'])
})

// Catches: aborting a turn that already ended (the engine rejects it), or skipping the pause because there is nothing to abort.
test('with no running turn nothing is aborted, but new prompts are still refused', async ($, on) => {
  mock.clock(on, { now: NOW })
  const { aborts } = engine(on)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 5000, isAborted: false, turnId: 't1' })
  await $.session.measure(reading(100))
  expect(aborts.length).toBe(0)
  expect((await $.prompt.submit(typed)).drop).toBeDefined()
})

// Catches: the gate blocking prompts while there is still room.
test('below the limit prompts pass through untouched', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on)
  await $.session.measure(reading(50))
  const result = await $.prompt.submit(typed)
  expect(result.text).toBe('hi')
  expect(result.drop).toBeUndefined()
})

// Catches: a refusal that leaves the person guessing how to continue or when it resets.
test('a paused session refuses prompts and says how to continue', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on)
  await $.session.measure(reading(100))
  const result = await $.prompt.submit(typed)
  expect(result.drop).toMatch(/\/meter resume/)
  expect(result.drop).toMatch(/2h13m/)
})

// Catches: /meter resume not unpausing, or the next reading pausing again in the same window.
test('/meter resume lets prompts through and the same window does not pause again', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on)
  await $.session.measure(reading(100))
  await $.command.run(RESUME)
  expect((await $.prompt.submit(typed)).text).toBe('hi')

  await $.session.measure(reading(100))
  expect((await $.prompt.submit(typed)).text).toBe('hi')
})

// Catches: resume claiming to work when nothing was paused.
test('/meter resume says so when nothing is paused', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on)
  const result = await $.command.run(RESUME)
  expect(result.text).toMatch(/沒有暫停/)
})

// Catches: no timer, so nobody hears that the window has reset until they happen to type something.
// (The gate would lift the pause on the next prompt anyway; the notice at the reset time is the timer's own work.)
test('the pause lifts by itself when the window resets, and says so without anyone typing', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { toasts } = engine(on)
  await $.session.measure(reading(100))
  expect((await $.prompt.submit(typed)).drop).toBeDefined()

  await clock.advance(PAST_RESET)
  expect(toasts.some(t => /已重置/.test(t))).toBe(true)
  expect((await $.prompt.submit(typed)).text).toBe('hi')
})

// Catches: relying on the timer alone. A reload cancels timers while the pause stays in the session state, and
// the gate refuses every prompt, so no reading could ever lift it. The clock stops one second past the reset,
// before the timer's safety margin is over, so only the gate's own check can let the prompt through.
test('the gate lets a prompt through once the reset time has passed, even if no timer lifted the pause', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { toasts } = engine(on)
  await $.session.measure(reading(100))
  await clock.advance(Date.parse(R1) - NOW + 1000)
  expect((await $.prompt.submit(typed)).text).toBe('hi')
  expect(toasts.some(t => /已重置/.test(t))).toBe(true)
})

// Catches: the band still showing a pause whose window has already reset.
test('the band stops showing a pause once its reset time has passed', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engine(on)
  await $.session.measure(reading(100))
  await clock.advance(Date.parse(R1) - NOW + 1000)
  await $.turn.start({ text: 'go', turnId: 't2' })
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await shown(band)).not.toMatch(/已暫停/)
    await band.unmount()
  }
})

// Catches: the band counting "working" forever after the guard aborted a turn that then raised no turn.complete.
test('an aborted turn no longer shows as working', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.session.measure(reading(100))
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await shown(band)).not.toMatch(/工作中/)
    await band.unmount()
  }
})

// Catches: the limitAction option being ignored.
test('limitAction off never aborts or refuses', { options: { limitAction: 'off' } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const { aborts } = engine(on)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.session.measure(reading(100))
  expect(aborts.length).toBe(0)
  expect((await $.prompt.submit(typed)).text).toBe('hi')
})

// Catches: asking a question when the person chose to pause without one.
test('limitAction pause pauses without asking', { options: { limitAction: 'pause' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { asks } = engine(on)
  await $.session.measure(reading(100))
  await clock.advance(1)
  expect(asks.length).toBe(0)
  expect((await $.prompt.submit(typed)).drop).toBeDefined()
})

// Catches: no question at all, or one that does not offer both ways forward.
test('by default a dialog asks whether to pause or to continue', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { asks } = engine(on, { ask: 'first' })
  await $.session.measure(reading(100))
  await clock.advance(1)
  expect(asks.length).toBe(1)
  expect(asks[0]?.labels.length).toBe(2)
})

// Catches: the dialog's "pause" answer resuming anyway.
test('answering pause keeps the session paused', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engine(on, { ask: 'first' })
  await $.session.measure(reading(100))
  await clock.advance(1)
  expect((await $.prompt.submit(typed)).drop).toBeDefined()
})

// Catches: the dialog's "continue" answer not lifting the pause.
test('answering continue lifts the pause for this window', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engine(on, { ask: 'second' })
  await $.session.measure(reading(100))
  await clock.advance(1)
  expect((await $.prompt.submit(typed)).text).toBe('hi')
})

// Catches: a dismissed dialog (or nobody there to answer) resuming work: the safe default is to stay paused.
test('a dismissed dialog leaves the session paused', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engine(on)
  await $.session.measure(reading(100))
  await clock.advance(1)
  expect((await $.prompt.submit(typed)).drop).toBeDefined()
})

// Catches: the pauseAtUsed option being ignored (the default 100 would stay quiet at 92%).
test('pauseAtUsed decides where the guard engages', { options: { pauseAtUsed: 90 } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on)
  await $.session.measure(reading(92))
  expect((await $.prompt.submit(typed)).drop).toBeDefined()
})

// Catches: a rejected turn.abort (the turn was no longer running) cutting the rest of the guard short:
// no notice, no way to learn how to continue.
test('a rejected abort still pauses and still says so', async ($, on) => {
  mock.clock(on, { now: NOW })
  const { toasts } = engine(on, { abort: 'deny' })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.session.measure(reading(100))
  expect((await $.prompt.submit(typed)).drop).toBeDefined()
  expect(toasts.some(t => /\/meter resume/.test(t))).toBe(true)
})

// Catches: the person not being able to see that work is paused.
test('the band shows when work is paused', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on)
  await $.session.measure(reading(50))
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await shown(band)).not.toMatch(/已暫停/)
    await band.unmount()
  }

  await $.session.measure(reading(100))
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await shown(band)).toMatch(/已暫停/)
    await band.unmount()
  }
})
