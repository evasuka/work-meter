import { expect, test } from 'claude-code/testing'

import { isBlocking, lifted, pauseReason, planGuard, resumed, stillPaused } from '../hooks/guard'

const NOW = Date.parse('2026-10-25T00:00:00Z')
const R1 = '2026-10-25T02:13:00Z' // 2h13m after NOW
const R2 = '2026-10-25T07:13:00Z'
const OPEN = { paused: false }
const five = (percentUsed: number, resetsAt: string | undefined = R1) => ({ kind: 'five_hour', percentUsed, resetsAt })
const fiveNoReset = (percentUsed: number) => ({ kind: 'five_hour', percentUsed })
const week = (percentUsed: number) => ({ kind: 'seven_day', percentUsed })

// Catches: the guard never engaging, or forgetting when the window resets (the timer and the message need it).
test('the five-hour window at 100% engages the guard and remembers its reset time', () => {
  const plan = planGuard(OPEN, [five(100)], 100, NOW)
  expect(plan.engage).toBe(true)
  expect(plan.release).toBe(false)
  expect(plan.next).toEqual({ paused: true, resetsAt: R1 })
})

// Catches: `>` written where `>=` belongs, or the reverse.
test('exactly at the threshold engages, a tenth below does not', () => {
  expect(planGuard(OPEN, [five(100)], 100, NOW).engage).toBe(true)
  expect(planGuard(OPEN, [five(99.9)], 100, NOW).engage).toBe(false)
})

// Catches: the threshold being hard-coded to 100.
test('a lower threshold engages earlier', () => {
  expect(planGuard(OPEN, [five(96)], 95, NOW).engage).toBe(true)
  expect(planGuard(OPEN, [five(94)], 95, NOW).engage).toBe(false)
})

// Catches: pausing because of the 7-day window, which would lock the person out for days.
test('only the five-hour window counts', () => {
  const plan = planGuard(OPEN, [week(100)], 100, NOW)
  expect(plan.engage).toBe(false)
  expect(plan.next).toEqual(OPEN)
})

// Catches: a crash or a state change when a response carries no rate-limit data.
test('no windows leaves the guard as it was', () => {
  const plan = planGuard({ paused: true, resetsAt: R1 }, [], 100, NOW)
  expect(plan.engage).toBe(false)
  expect(plan.release).toBe(false)
  expect(plan.next).toEqual({ paused: true, resetsAt: R1 })
})

// Catches: engaging again on every reading while paused (a second abort, a second dialog).
test('an already paused guard does not engage again', () => {
  const plan = planGuard({ paused: true, resetsAt: R1 }, [five(100)], 100, NOW)
  expect(plan.engage).toBe(false)
  expect(plan.next).toEqual({ paused: true, resetsAt: R1 })
})

// Catches: ignoring the person's choice to continue, or never guarding the next window.
test('a window the person chose to continue in is not guarded again, the next one is', () => {
  const sameWindow = planGuard({ paused: false, overriddenFor: R1 }, [five(100, R1)], 100, NOW)
  expect(sameWindow.engage).toBe(false)

  const nextWindow = planGuard({ paused: false, overriddenFor: R1 }, [five(100, R2)], 100, NOW)
  expect(nextWindow.engage).toBe(true)
  expect(nextWindow.next).toEqual({ paused: true, resetsAt: R2 })
})

// Catches: pausing on a reading whose window already ended.
test('a reading whose reset time has passed is stale and does not engage', () => {
  const plan = planGuard(OPEN, [five(100, '2026-10-24T23:00:00Z')], 100, NOW)
  expect(plan.engage).toBe(false)
})

// Catches: staying paused after a reading shows the window has room again.
test('a reading below the threshold releases a paused guard', () => {
  const plan = planGuard({ paused: true, resetsAt: R1 }, [five(10, R2)], 100, NOW)
  expect(plan.release).toBe(true)
  expect(plan.next.paused).toBe(false)
})

// Catches: a missing reset time breaking the override (the window then has no name to compare).
test('a window without a reset time can still be guarded and overridden', () => {
  const plan = planGuard(OPEN, [fiveNoReset(100)], 100, NOW)
  expect(plan.engage).toBe(true)
  expect(plan.next).toEqual({ paused: true })

  const back = resumed(plan.next)
  expect(planGuard(back, [fiveNoReset(100)], 100, NOW).engage).toBe(false)
})

// Catches: resuming without remembering the window, so the very next reading pauses again.
test('resuming unpauses and remembers the window it was paused in', () => {
  expect(resumed({ paused: true, resetsAt: R1 })).toEqual({ paused: false, overriddenFor: R1 })
})

// Catches: a stale timer lifting a pause that belongs to a later window.
test('lifting only applies to the window the timer was set for', () => {
  expect(lifted({ paused: true, resetsAt: R1 }, R1).paused).toBe(false)
  expect(lifted({ paused: true, resetsAt: R2 }, R1)).toEqual({ paused: true, resetsAt: R2 })
})

// Catches: a pause that outlives its window because the timer that should lift it was lost (a reload cancels timers).
test('a pause holds until its reset time and no longer applies after it', () => {
  expect(stillPaused({ paused: true, resetsAt: R1 }, NOW)).toBe(true)
  expect(stillPaused({ paused: true, resetsAt: R1 }, Date.parse(R1))).toBe(false)
  expect(stillPaused({ paused: true, resetsAt: R1 }, Date.parse(R1) + 1000)).toBe(false)
})

// Catches: an open guard reporting itself paused, or a pause with no reset time ending by itself.
test('an open guard is never paused, a pause without a reset time holds until resumed', () => {
  expect(stillPaused(OPEN, NOW)).toBe(false)
  expect(stillPaused({ paused: true }, NOW + 1e12)).toBe(true)
})

// Catches: switching limitAction to off in /config leaving a pause on record that still refuses prompts
// (the test kit cannot write a plugin's state, so this is tested here rather than through the hooks).
test('a pause blocks only while limitAction is not off and the window has not reset', () => {
  const paused = { paused: true, resetsAt: R1 }
  expect(isBlocking(paused, 'ask', NOW)).toBe(true)
  expect(isBlocking(paused, 'pause', NOW)).toBe(true)
  expect(isBlocking(paused, 'off', NOW)).toBe(false)
  expect(isBlocking(paused, 'ask', Date.parse(R1) + 1000)).toBe(false)
  expect(isBlocking(OPEN, 'ask', NOW)).toBe(false)
})

// Catches: an expired pause blocking the next window from being guarded.
test('an expired pause counts as open, so a full reading in the new window engages again', () => {
  const plan = planGuard({ paused: true, resetsAt: R1 }, [five(100, R2)], 100, Date.parse(R1) + 1000)
  expect(plan.engage).toBe(true)
  expect(plan.next).toEqual({ paused: true, resetsAt: R2 })
})

// Catches: an expired pause that a reading with room never clears from the state.
test('an expired pause is released by a reading with room', () => {
  const plan = planGuard({ paused: true, resetsAt: R1 }, [five(10, R2)], 100, Date.parse(R1) + 1000)
  expect(plan.engage).toBe(false)
  expect(plan.release).toBe(true)
  expect(plan.next.paused).toBe(false)
})

// Catches: a message that does not tell the person how to continue, or prints "undefined"/NaN without a reset time.
test('the pause reason says how to continue and when the window resets', () => {
  const withTime = pauseReason({ paused: true, resetsAt: R1 }, NOW)
  expect(withTime).toMatch(/\/meter resume/)
  expect(withTime).toMatch(/2h13m/)

  const withoutTime = pauseReason({ paused: true }, NOW)
  expect(withoutTime).toMatch(/\/meter resume/)
  expect(withoutTime).not.toMatch(/undefined|NaN/)
})
