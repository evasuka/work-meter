import type { MeterGuard, MeterWindow } from '../types'
import { duration } from './format'

export const OPEN: MeterGuard = { paused: false }

export type GuardPlan = { engage: boolean; release: boolean; next: MeterGuard }

export type LimitAction = 'ask' | 'pause' | 'off'

const windowKey = (resetsAt: string | undefined) => resetsAt ?? 'unknown'

// A pause holds until its window resets. The timer that lifts it at that moment is lost when the module
// reloads, while the pause itself stays in the session state, so the reset time is checked wherever it matters.
export function stillPaused(guard: MeterGuard, now: number): boolean {
  if (!guard.paused) return false
  if (guard.resetsAt === undefined) return true
  const at = Date.parse(guard.resetsAt)
  return Number.isNaN(at) || at > now
}

// Whether prompts are refused (and the pause shown) right now. Switching limitAction to off ends it at once.
export function isBlocking(guard: MeterGuard, action: LimitAction, now: number): boolean {
  return action !== 'off' && stillPaused(guard, now)
}

// Decides from the latest readings whether the five-hour window has run out (engage),
// or has room again while paused (release). Other windows never pause anything.
export function planGuard(
  guard: MeterGuard,
  windows: readonly MeterWindow[],
  threshold: number,
  now: number,
): GuardPlan {
  const five = windows.find(w => w.kind === 'five_hour')
  if (five === undefined) return { engage: false, release: false, next: guard }

  const isFull = five.percentUsed >= threshold
  if (stillPaused(guard, now)) {
    return isFull
      ? { engage: false, release: false, next: guard }
      : { engage: false, release: true, next: OPEN }
  }

  // Open, or paused for a window that has since reset: either way the person's choice or pause is spent.
  const base = guard.paused ? OPEN : guard
  const isStale = five.resetsAt !== undefined && Date.parse(five.resetsAt) <= now
  if (!isFull || isStale || base.overriddenFor === windowKey(five.resetsAt)) {
    return { engage: false, release: guard.paused, next: base }
  }

  return {
    engage: true,
    release: false,
    next: five.resetsAt === undefined ? { paused: true } : { paused: true, resetsAt: five.resetsAt },
  }
}

// The person chose to keep working: unpause, and do not pause again within this window.
export function resumed(guard: MeterGuard): MeterGuard {
  return { paused: false, overriddenFor: windowKey(guard.resetsAt) }
}

// The window reset: unpause, but only the pause that was caused by that window.
export function lifted(guard: MeterGuard, resetsAt: string | undefined): MeterGuard {
  return guard.paused && guard.resetsAt === resetsAt ? OPEN : guard
}

export function pauseReason(guard: MeterGuard, now: number): string {
  const at = guard.resetsAt === undefined ? Number.NaN : Date.parse(guard.resetsAt)
  const reset = Number.isNaN(at) ? '' : `（${duration(at - now)}後重置）`
  return `5 小時額度已用完，已暫停以避免 extra usage${reset}。輸入 /meter resume 可繼續。`
}
