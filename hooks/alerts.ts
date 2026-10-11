import type { MeterAlerts, MeterWindow } from '../types'
import { remaining, resetsIn, windowLabel } from './format'

const DEFAULT_LEVELS = [20, 10]

export type AlertPlan = { messages: string[]; next: MeterAlerts }

// "20,10" -> [20, 10]: whole-percent levels between 1 and 99, high to low, no duplicates.
export function parseThresholds(text: string): number[] {
  const levels = new Set<number>()
  for (const part of text.split(',')) {
    const n = Number(part.trim())
    if (Number.isFinite(n) && n >= 1 && n <= 99) levels.add(n)
  }
  return levels.size === 0 ? DEFAULT_LEVELS : [...levels].sort((a, b) => b - a)
}

// What to announce for the latest readings, and what to remember so the same level is not announced twice.
export function planAlerts(
  prev: MeterAlerts,
  windows: readonly MeterWindow[],
  thresholds: readonly number[],
  now: number,
): AlertPlan {
  const next: MeterAlerts = { ...prev }
  const messages: string[] = []
  const levels = [...thresholds].sort((a, b) => b - a)

  for (const w of windows) {
    const left = remaining(w)
    const crossed = levels.filter(level => left <= level)
    const target = crossed.length === 0 ? null : (crossed[crossed.length - 1] ?? null)
    const announced = prev[w.kind] ?? null
    const label = windowLabel(w.kind)

    if (target === null) {
      if (announced !== null) messages.push(`${label}額度已恢復（剩 ${left}%）`)
      next[w.kind] = null
    } else if (announced === null || target < announced) {
      const reset = resetsIn(w, now)
      messages.push(`${label}額度只剩 ${left}%${reset === undefined ? '' : `（${reset}後重置）`}`)
      next[w.kind] = target
    } else {
      next[w.kind] = target
    }
  }

  return { messages, next }
}
