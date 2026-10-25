export type MeterStatus = 'pending' | 'in_progress' | 'completed'

export type MeterItem = {
  id: string
  subject: string
  activeForm?: string
  status: MeterStatus
  source: 'task' | 'todo'
}

// id: the main-loop turn's id from turn.start, which turn.abort needs.
export type MeterTurn = { id: string; startedAt: number; endedAt?: number; tools: number }

export type MeterRunning = { id: string; label: string }

export type MeterWindow = { kind: string; percentUsed: number; resetsAt?: string }

export type MeterUsage = {
  windows: MeterWindow[]
  contextTokens?: number
  contextWindow: number
  contextPercent?: number
  costUsd?: number
}

export type MeterTok = { input: number; output: number; cacheRead: number; cacheWrite: number }

// last: the most recent main-thread turn; session: every turn since the conversation began, subagents included.
export type MeterTokens = { last: MeterTok | null; session: MeterTok }

// Per rate-limit window kind: the lowest alert threshold already announced, null while above every threshold.
export type MeterAlerts = Record<string, number | null>

// paused: new prompts are refused until the five-hour window resets or the person resumes.
// resetsAt: when the window that caused the pause resets.
// overriddenFor: the window ('unknown' when it has no reset time) the person chose to keep working in.
export type MeterGuard = { paused: boolean; resetsAt?: string; overriddenFor?: string }

declare module 'claude-code' {
  interface PluginState {
    'work-meter': {
      items: MeterItem[]
      turn: MeterTurn | null
      running: MeterRunning[]
      usage: MeterUsage | null
      now: number
      isBandHidden: boolean
      tokens: MeterTokens
      alerted: MeterAlerts
      guard: MeterGuard
    }
  }
}
