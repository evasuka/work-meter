import type { On } from 'claude-code'

export const SURFACES = ['terminal', 'desktop'] as const

export const BAND = {
  plugin: 'work-meter',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 10,
    bodyColumns: 200,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

export const PANE = {
  plugin: 'work-meter',
  component: 'Pane',
  requestId: 'work-meter',
  props: {
    title: '工作進度與額度',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

export const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } } as const

// What sits beneath the plugins in a session: the engine echoes these events, and the
// test keeps what reached the screen (toasts) and the person's notification channel (notices).
// `abort: 'deny'` makes turn.abort reject, as it does when the turn is not the running one.
// `ask` is which option the person picks in a dialog, the first or the second; left out, the dialog is dismissed.
export function engine(on: On, opts: { abort?: 'ok' | 'deny'; ask?: 'first' | 'second' } = {}) {
  const toasts: string[] = []
  const notices: string[] = []
  const aborts: string[] = []
  const asks: { question: string; labels: string[] }[] = []
  on('turn.abort', ($, e) => {
    aborts.push(e.turnId)
    return opts.abort === 'deny' ? { deny: 'not the running turn' } : { value: undefined }
  })
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('tool.call', { tool: 'AskUserQuestion' }, ($, e) => {
    const q = e.questions[0]
    if (q === undefined) return { deny: 'no question' }
    asks.push({ question: q.question, labels: q.options.map(o => o.label) })
    const picked = q.options[opts.ask === 'second' ? 1 : 0]
    return opts.ask === undefined || picked === undefined
      ? { deny: 'dismissed' }
      : { result: { questions: e.questions, answers: { [q.question]: picked.label } } }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.notify', ($, e) => {
    notices.push(e.text)
    return { value: { isSent: true, channel: 'kitty' } }
  })
  return { toasts, notices, aborts, asks }
}

export async function shown(ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) {
  return (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
}
