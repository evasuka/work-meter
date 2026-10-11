export type MeterStatus = 'pending' | 'in_progress' | 'completed'

export type MeterItem = {
  id: string
  subject: string
  activeForm?: string
  status: MeterStatus
  source: 'task' | 'todo'
}

export type MeterTurn = { startedAt: number; endedAt?: number; tools: number }

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
    }
  }
}
