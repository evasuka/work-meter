import type { MeterTok, MeterTokens } from '../types'

// The four counts a model response reports, as the engine spells them.
type UsageLike = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

const ZERO: MeterTok = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

export const EMPTY_TOKENS: MeterTokens = { last: null, session: ZERO }

export function fromUsage(usage: UsageLike | undefined): MeterTok {
  if (usage === undefined) return ZERO
  return {
    input: usage.input_tokens,
    output: usage.output_tokens,
    cacheRead: usage.cache_read_input_tokens,
    cacheWrite: usage.cache_creation_input_tokens,
  }
}

export function total(t: MeterTok): number {
  return t.input + t.output + t.cacheRead + t.cacheWrite
}

export function recordTurn(prev: MeterTokens, usage: UsageLike | undefined, isMain: boolean): MeterTokens {
  if (usage === undefined) return prev
  const turn = fromUsage(usage)
  return {
    last: isMain ? turn : prev.last,
    session: {
      input: prev.session.input + turn.input,
      output: prev.session.output + turn.output,
      cacheRead: prev.session.cacheRead + turn.cacheRead,
      cacheWrite: prev.session.cacheWrite + turn.cacheWrite,
    },
  }
}
