import { expect, test } from 'claude-code/testing'

import { EMPTY_TOKENS, fromUsage, recordTurn, total } from '../hooks/tokens'

const usage = (input: number, output: number, cacheRead: number, cacheWrite: number) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheWrite,
})

// Catches: two of the four counts swapped (distinct values make a swap visible).
test('fromUsage maps each of the four counts to its own field', () => {
  expect(fromUsage(usage(100, 20, 3000, 400))).toEqual({ input: 100, output: 20, cacheRead: 3000, cacheWrite: 400 })
})

// Catches: a crash or NaN on an interrupted turn, which reports no usage at all.
test('fromUsage of nothing is all zeros', () => {
  expect(fromUsage(undefined)).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
})

// Catches: the first turn not showing up as both the last turn and the session total.
test('the first main turn is both the last turn and the session total', () => {
  const state = recordTurn(EMPTY_TOKENS, usage(100, 20, 3000, 400), true)
  expect(state.last).toEqual({ input: 100, output: 20, cacheRead: 3000, cacheWrite: 400 })
  expect(state.session).toEqual({ input: 100, output: 20, cacheRead: 3000, cacheWrite: 400 })
})

// Catches: the session total being replaced instead of accumulated, or the last turn being summed.
test('a second main turn adds to the session and replaces the last turn', () => {
  const first = recordTurn(EMPTY_TOKENS, usage(100, 20, 3000, 400), true)
  const second = recordTurn(first, usage(50, 10, 1000, 0), true)
  expect(second.last).toEqual({ input: 50, output: 10, cacheRead: 1000, cacheWrite: 0 })
  expect(second.session).toEqual({ input: 150, output: 30, cacheRead: 4000, cacheWrite: 400 })
})

// Catches: subagent work (which spends quota too) being left out of the session total, or shown as the last turn.
test('a subagent turn counts toward the session but is not the last turn', () => {
  const main = recordTurn(EMPTY_TOKENS, usage(100, 20, 3000, 400), true)
  const withAgent = recordTurn(main, usage(7, 3, 500, 0), false)
  expect(withAgent.last).toEqual({ input: 100, output: 20, cacheRead: 3000, cacheWrite: 400 })
  expect(withAgent.session).toEqual({ input: 107, output: 23, cacheRead: 3500, cacheWrite: 400 })
})

// Catches: a subagent turn inventing a "last turn" before any main turn happened.
test('a subagent turn before any main turn leaves the last turn empty', () => {
  const state = recordTurn(EMPTY_TOKENS, usage(7, 3, 500, 0), false)
  expect(state.last).toBe(null)
  expect(state.session).toEqual({ input: 7, output: 3, cacheRead: 500, cacheWrite: 0 })
})

// Catches: an interrupted turn wiping the previous last turn or inflating the total.
test('a turn that reports no usage changes nothing', () => {
  const before = recordTurn(EMPTY_TOKENS, usage(100, 20, 3000, 400), true)
  const after = recordTurn(before, undefined, true)
  expect(after).toEqual(before)
})

// Catches: a total that forgets the cache counts or the output.
test('total adds all four counts', () => {
  expect(total({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4 })).toBe(10)
})
