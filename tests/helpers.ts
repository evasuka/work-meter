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
export function engine(on: On) {
  const toasts: string[] = []
  const notices: string[] = []
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
  return { toasts, notices }
}

export async function shown(ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) {
  return (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
}
