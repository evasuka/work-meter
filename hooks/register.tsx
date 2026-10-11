import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage } from 'claude-code'

import type { MeterItem, MeterUsage } from '../types'
import { parseThresholds, planAlerts } from './alerts'
import {
  bar,
  breakdown,
  describeTool,
  duration,
  pad,
  progress,
  remaining,
  remainingColor,
  resetsIn,
  tokens,
  windowLabel,
} from './format'
import { EMPTY_TOKENS, recordTurn, total } from './tokens'

const PANE = 'work-meter'
const PANE_TITLE = '工作進度與額度'
const ALERT_TOAST_MS = 10_000

const items = atom({ plugin: 'work-meter', key: 'items' } as const, [])
const turn = atom({ plugin: 'work-meter', key: 'turn' } as const, null)
const running = atom({ plugin: 'work-meter', key: 'running' } as const, [])
const usage = atom({ plugin: 'work-meter', key: 'usage' } as const, null)
const now = atom({ plugin: 'work-meter', key: 'now' } as const, 0)
const isBandHidden = atom({ plugin: 'work-meter', key: 'isBandHidden' } as const, false)
const spent = atom({ plugin: 'work-meter', key: 'tokens' } as const, EMPTY_TOKENS)
const alerted = atom({ plugin: 'work-meter', key: 'alerted' } as const, {})

function toUsage(u: Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>): MeterUsage {
  return {
    windows: u.rateLimits.map(w => ({ kind: w.kind, percentUsed: w.percentUsed, resetsAt: w.resetsAt })),
    contextTokens: u.context.tokens,
    contextWindow: u.context.window,
    contextPercent: u.context.percent,
    costUsd: u.cost?.usd,
  }
}

function upsertTask(list: MeterItem[], id: string, patch: Partial<MeterItem>): MeterItem[] {
  const isKnown = list.some(i => i.source === 'task' && i.id === id)
  if (!isKnown) {
    return [...list, { id, subject: `任務 #${id}`, status: 'pending', source: 'task', ...patch }]
  }
  return list.map(i => (i.source === 'task' && i.id === id ? { ...i, ...patch } : i))
}

// Ticks the clock the band reads: every second while a turn runs, else every 30s for the reset countdowns.
async function tick($: EngineInterface) {
  const t = await $.clock.now()
  const current = await read($, turn)
  const isWorking = current !== null && current.endedAt === undefined
  if (isWorking || t - (await read($, now)) >= 30_000) {
    await update($, now, () => t)
  }
}

export const register: Register = (on, options) => {
  const isAlertOn = options.alerts !== false
  const levels = parseThresholds(String(options.alertThresholds ?? ''))
  const isTokenShown = options.showTokens !== false
  const longTurnSeconds = Number(options.longTurnNotifySeconds)
  const longTurnMs = Number.isFinite(longTurnSeconds) && longTurnSeconds > 0 ? longTurnSeconds * 1000 : 0

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'meter',
      description: '開啟工作進度與帳號額度面板；/meter hide|show 切換上方橫條',
      argumentHint: '[hide|show]',
    })
    const measured = toUsage(await $.session.usage())
    await update($, usage, () => measured)
    const t = await $.clock.now()
    await update($, now, () => t)
    $.clock.every(1000, () => void tick($))

    return next(e)
  })

  on('command.run', { command: 'meter' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'hide' || arg === 'show') {
      await update($, isBandHidden, () => arg === 'hide')
      return { text: arg === 'hide' ? '已隱藏工作進度橫條（/meter show 可再顯示）。' : '已顯示工作進度橫條。' }
    }
    const opened = await $.ui.open({ id: PANE, title: PANE_TITLE })

    return { text: opened.isPlaced ? '已開啟工作進度面板。' : '工作進度面板等待中：終端機寬度不足。' }
  })

  on('session.measure', async ($, e, next) => {
    const measured = toUsage(e)
    await update($, usage, () => measured)

    if (isAlertOn) {
      const t = await $.clock.now()
      const plan = planAlerts(await read($, alerted), measured.windows, levels, t)
      await update($, alerted, () => plan.next)
      for (const message of plan.messages) $.ui.toast(message, { timeoutMs: ALERT_TOAST_MS })
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const t = await $.clock.now()
    await update($, turn, () => ({ startedAt: t, tools: 0 }))
    await update($, running, () => [])
    await update($, now, () => t)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await update($, spent, prev => recordTurn(prev, e.usage, e.agentId === undefined))
    if (e.agentId !== undefined) return next(e)
    const t = await $.clock.now()
    await update($, turn, prev => (prev === null ? null : { ...prev, endedAt: t }))
    await update($, running, () => [])

    if (longTurnMs > 0 && !e.isAborted && e.durationMs >= longTurnMs) {
      // Goes through the person's own notification channel; "not sent" (no channel set up) is fine.
      await $.ui.notify(`回合完成（耗時 ${duration(e.durationMs)}）`, { title: 'work-meter' })
    }

    return next(e)
  })

  // A /clear starts a new conversation in the same process: its token totals start over.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await update($, spent, () => EMPTY_TOKENS)

    return next(e)
  })

  // Every tool call: count it, and show the main thread's running ones.
  on('tool.call', async ($, e, next) => {
    await update($, turn, prev => (prev === null || prev.endedAt !== undefined ? prev : { ...prev, tools: prev.tools + 1 }))
    if (e.agentId !== undefined) return next(e)
    const entry = { id: e.tool_use_id, label: describeTool(String(e.tool), e as unknown as Record<string, unknown>) }
    await update($, running, list => [...list, entry].slice(-20))
    try {
      return await next(e)
    } finally {
      await update($, running, list => list.filter(r => r.id !== entry.id))
    }
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true && ran.result?.task) {
      const { id } = ran.result.task
      await update($, items, list =>
        upsertTask(list, id, { subject: e.subject, activeForm: e.activeForm, status: 'pending' }),
      )
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    if (e.status === 'deleted') {
      await update($, items, list => list.filter(i => !(i.source === 'task' && i.id === e.taskId)))
    } else {
      const patch: Partial<MeterItem> = {}
      if (e.subject !== undefined) patch.subject = e.subject
      if (e.activeForm !== undefined) patch.activeForm = e.activeForm
      if (e.status !== undefined) patch.status = e.status
      await update($, items, list => upsertTask(list, e.taskId, patch))
    }

    return ran
  }).catch(($, e, next) => next(e))

  // A full listing resyncs the tasks, keeping each one's activeForm.
  on('tool.call', { tool: 'TaskList' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true && Array.isArray(ran.result?.tasks)) {
      const listed = ran.result.tasks
      await update($, items, list => {
        const kept = new Map(list.filter(i => i.source === 'task').map(i => [i.id, i]))
        const tasks: MeterItem[] = listed.map(t => ({
          id: t.id,
          subject: t.subject,
          activeForm: kept.get(t.id)?.activeForm,
          status: t.status,
          source: 'task',
        }))
        return [...tasks, ...list.filter(i => i.source !== 'task')]
      })
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskGet' }, async ($, e, next) => {
    const ran = await next(e)
    const task = ran.deny === undefined && ran.isError !== true ? ran.result?.task : undefined
    if (task) {
      await update($, items, list => upsertTask(list, task.id, { subject: task.subject, status: task.status }))
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    if (e.agentId === undefined) {
      const todos: MeterItem[] = e.todos.map((t, i) => ({
        id: `todo-${i}`,
        subject: t.content,
        activeForm: t.activeForm,
        status: t.status,
        source: 'todo',
      }))
      await update($, items, list => [...list.filter(i => i.source !== 'todo'), ...todos])
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isBandHidden))) return next(e)
    const list = await read($, items)
    const current = await read($, turn)
    const u = await read($, usage)
    const t = await read($, now)
    const calls = await read($, running)
    const spentTokens = await read($, spent)
    const hasWork = list.length > 0 || current !== null
    if (!hasWork && u === null) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const p = progress(list)
    const isWorking = current !== null && current.endedAt === undefined
    const tool = calls.at(-1)
    const turnBase =
      current === null
        ? ''
        : isWorking
          ? `工作中 ${duration(t - current.startedAt)} · 工具 ${current.tools} 次${tool ? ` · ${tool.label}` : ''}`
          : `上回合 ${duration((current.endedAt ?? t) - current.startedAt)} · 工具 ${current.tools} 次`
    const lastTokens =
      isTokenShown && !isWorking && spentTokens.last !== null ? ` · ${tokens(total(spentTokens.last))} tok` : ''
    const sessionTokens =
      isTokenShown && total(spentTokens.session) > 0 ? ` │ 本 session ${tokens(total(spentTokens.session))} tok` : ''
    const turnText = turnBase === '' ? '' : `${turnBase}${lastTokens}${sessionTokens}`

    return (
      <Box flexDirection="column">
        {hasWork && (
          <Text key="work" wrap="truncate-end">
            {p.total > 0 && (
              <Text>
                <Text dimColor>進度 </Text>
                <Text color="success">{bar(p.done / p.total, 10)}</Text>
                {` ${p.done}/${p.total}`}
                {p.active && <Text color="claude">{` ▶ ${p.active.activeForm ?? p.active.subject}`}</Text>}
                {turnText !== '' && <Text dimColor> │ </Text>}
              </Text>
            )}
            {turnText !== '' && <Text dimColor={!isWorking}>{turnText}</Text>}
          </Text>
        )}
        {u !== null && (
          <Text key="usage" wrap="truncate-end">
            <Text dimColor>額度 </Text>
            {u.windows.length === 0 && <Text dimColor>（尚無 rate limit 資料） </Text>}
            {u.windows.map(w => {
              const left = remaining(w)
              const reset = resetsIn(w, t)
              return (
                <Text>
                  {`${windowLabel(w.kind)} `}
                  <Text color={remainingColor(left)} bold>{`剩 ${left}%`}</Text>
                  {reset !== undefined && <Text dimColor>{` (${reset}後重置)`}</Text>}
                  <Text dimColor> │ </Text>
                </Text>
              )
            })}
            {u.contextPercent !== undefined && (
              <Text>
                {'context '}
                <Text color={remainingColor(100 - u.contextPercent)}>{`${u.contextPercent}%`}</Text>
              </Text>
            )}
            {u.costUsd !== undefined && <Text dimColor>{` │ US$${u.costUsd.toFixed(2)}`}</Text>}
          </Text>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, items)
    const current = await read($, turn)
    const u = await read($, usage)
    const t = await read($, now)
    const calls = await read($, running)
    const spentTokens = await read($, spent)
    const p = progress(list)
    const width = Math.min(24, Math.max(8, e.props.bodyColumns - 34))
    const isWorking = current !== null && current.endedAt === undefined
    const hasTokens = isTokenShown && (spentTokens.last !== null || total(spentTokens.session) > 0)

    return (
      <Box flexDirection="column">
        <Text bold>
          工作進度{p.total > 0 && <Text dimColor>{`  ${p.done}/${p.total} 完成`}</Text>}
        </Text>
        {p.total > 0 && (
          <Text>
            <Text color="success">{bar(p.done / p.total, width + 12)}</Text>
            {` ${Math.round((p.done / p.total) * 100)}%`}
          </Text>
        )}
        {list.length === 0 && <Text dimColor>（目前沒有任務清單）</Text>}
        {list.map(item =>
          item.status === 'completed' ? (
            <Text dimColor wrap="truncate-end">{`✔ ${item.subject}`}</Text>
          ) : item.status === 'in_progress' ? (
            <Text color="claude" bold wrap="truncate-end">{`▶ ${item.activeForm ?? item.subject}`}</Text>
          ) : (
            <Text wrap="truncate-end">{`○ ${item.subject}`}</Text>
          ),
        )}
        <Text> </Text>
        <Text bold>本回合</Text>
        {current === null ? (
          <Text dimColor>（尚未開始）</Text>
        ) : (
          <Text>
            {isWorking ? '工作中 ' : '已結束 · 耗時 '}
            {duration((current.endedAt ?? t) - current.startedAt)}
            {` · 工具 ${current.tools} 次`}
          </Text>
        )}
        {calls.map(c => (
          <Text dimColor wrap="truncate-end">{`  執行中：${c.label}`}</Text>
        ))}
        {hasTokens && <Text> </Text>}
        {hasTokens && <Text bold>Token</Text>}
        {hasTokens && spentTokens.last !== null && (
          <Text wrap="truncate-end">{`上回合    ${breakdown(spentTokens.last)}`}</Text>
        )}
        {hasTokens && <Text wrap="truncate-end">{`本 session ${breakdown(spentTokens.session)}`}</Text>}
        <Text> </Text>
        <Text bold>帳號額度</Text>
        {u === null || (u.windows.length === 0 && u.contextPercent === undefined) ? (
          <Text dimColor>（等待第一次 API 回應後顯示）</Text>
        ) : null}
        {u !== null && u.windows.length === 0 && (
          <Text dimColor>沒有 rate limit 資料（API key 帳號不提供，訂閱帳號於回應後出現）</Text>
        )}
        {u?.windows.map(w => {
          const left = remaining(w)
          const reset = resetsIn(w, t)
          return (
            <Text wrap="truncate-end">
              {pad(windowLabel(w.kind), 9)}
              <Text color={remainingColor(left)}>{bar(left / 100, width)}</Text>
              <Text color={remainingColor(left)} bold>{`  剩 ${left}%`}</Text>
              {reset !== undefined && <Text dimColor>{`  ${reset}後重置`}</Text>}
            </Text>
          )
        })}
        {u?.contextPercent !== undefined && (
          <Text wrap="truncate-end">
            {pad('Context', 9)}
            <Text color={remainingColor(100 - u.contextPercent)}>{bar(u.contextPercent / 100, width)}</Text>
            {`  已用 ${u.contextPercent}%`}
            {u.contextTokens !== undefined && (
              <Text dimColor>{`  ${tokens(u.contextTokens)} / ${tokens(u.contextWindow)}`}</Text>
            )}
          </Text>
        )}
        {u?.costUsd !== undefined && <Text dimColor>{`本 session 花費 US$${u.costUsd.toFixed(2)}`}</Text>}
      </Box>
    )
  })
}
