import type { MeterItem, MeterWindow } from '../types'

export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h${String(m % 60).padStart(2, '0')}m`
  return `${Math.floor(h / 24)}d${h % 24}h`
}

export function bar(fraction: number, width: number): string {
  const filled = Math.round(Math.min(1, Math.max(0, fraction)) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

export function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export function windowLabel(kind: string): string {
  switch (kind) {
    case 'five_hour':
      return '5 小時'
    case 'seven_day':
      return '7 天'
    case 'spend_limit':
      return '花費上限'
    default:
      return kind.replace(/_/g, ' ')
  }
}

export function remaining(w: MeterWindow): number {
  return Math.max(0, Math.round((100 - w.percentUsed) * 10) / 10)
}

export function remainingColor(left: number): 'success' | 'warning' | 'error' {
  if (left >= 50) return 'success'
  if (left >= 20) return 'warning'
  return 'error'
}

export function resetsIn(w: MeterWindow, now: number): string | undefined {
  if (w.resetsAt === undefined) return undefined
  const at = Date.parse(w.resetsAt)
  return Number.isNaN(at) ? undefined : duration(at - now)
}

// Terminal cells: CJK and full-width forms take two.
export function cells(text: string): number {
  let n = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    n += code >= 0x1100 && (code <= 0x115f || (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe30 && code <= 0xfe4f) || (code >= 0xff00 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6)) ? 2 : 1
  }
  return n
}

export function pad(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - cells(text)))
}

export function progress(items: readonly MeterItem[]) {
  const done = items.filter(i => i.status === 'completed').length
  const active = items.find(i => i.status === 'in_progress')
  return { done, total: items.length, active }
}

const ARG_KEYS = ['command', 'file_path', 'notebook_path', 'pattern', 'url', 'query', 'description', 'subject', 'prompt'] as const

export function describeTool(tool: string, args: Record<string, unknown>): string {
  const name = tool.startsWith('mcp__') ? tool.split('__').slice(2).join('__') || tool : tool
  for (const key of ARG_KEYS) {
    const value = args[key]
    if (typeof value !== 'string' || value.trim() === '') continue
    const text = key.endsWith('_path') ? (value.split('/').pop() ?? value) : (value.trim().split('\n')[0] ?? '')
    return `${name}: ${text.length > 48 ? `${text.slice(0, 47)}…` : text}`
  }
  return name
}
