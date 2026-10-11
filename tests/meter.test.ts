import type { RenderElement } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { BAND, engine, PANE, RUN, shown, SURFACES } from './helpers'

test('tasks and the running turn show as progress', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: 1_000_000 })
  on('tool.call', { tool: 'TaskCreate' }, ($, e) => ({
    result: { task: { id: e.subject === 'A' ? '1' : '2', subject: e.subject } },
  }))
  on('tool.call', { tool: 'TaskUpdate' }, ($, e) => ({
    result: { success: true, taskId: e.taskId, updatedFields: ['status'] },
  }))

  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'A', description: 'a', activeForm: 'Doing A' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'B', description: 'b' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'in_progress', activeForm: 'Doing B' })
  await clock.advance(5000)

  for (const surface of SURFACES) {
    const band = await $.ui.mount({ ...BAND, surface })
    const text = await shown(band)
    expect(text).toMatch(/1\/2/)
    expect(text).toMatch(/Doing B/)
    expect(text).toMatch(/工具 4 次/)
    await band.unmount()

    const pane = await $.ui.mount({ ...PANE, surface })
    const detail = await shown(pane)
    expect(detail).toMatch(/✔ A/)
    expect(detail).toMatch(/▶ Doing B/)
    await pane.unmount()
  }
})

test('TodoWrite replaces the todo list', async ($, on) => {
  on('tool.call', { tool: 'TodoWrite' }, ($, e) => ({ result: { oldTodos: [], newTodos: e.todos } }))
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'one', status: 'completed', activeForm: 'Doing one' },
      { content: 'two', status: 'in_progress', activeForm: 'Doing two' },
      { content: 'three', status: 'pending', activeForm: 'Doing three' },
    ],
  })

  for (const surface of SURFACES) {
    const band = await $.ui.mount({ ...BAND, surface })
    const text = await shown(band)
    expect(text).toMatch(/1\/3/)
    expect(text).toMatch(/Doing two/)
    await band.unmount()
  }
})

test('rate-limit windows show what is left and when they reset', async ($, on) => {
  engine(on)
  mock.clock(on, { now: Date.parse('2026-10-10T00:00:00Z') })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.session.measure({
    context: { window: 200_000, tokens: 46_000, percent: 23 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 23, resetsAt: '2026-10-10T02:13:00Z' },
      { kind: 'seven_day', percentUsed: 88.5 },
    ],
    cost: { usd: 1.234 },
    changed: ['context', 'rateLimits', 'cost'],
  })

  for (const surface of SURFACES) {
    const band = await $.ui.mount({ ...BAND, surface })
    const text = await shown(band)
    expect(text).toMatch(/5 小時 剩 77%/)
    expect(text).toMatch(/2h13m後重置/)
    expect(text).toMatch(/7 天 剩 11.5%/)
    expect(text).toMatch(/context 23%/)
    expect(text).toMatch(/US\$1\.23/)
    await band.unmount()

    const pane = await $.ui.mount({ ...PANE, surface })
    const detail = await shown(pane)
    expect(detail).toMatch(/剩 77%/)
    expect(detail).toMatch(/46\.0k \/ 200\.0k/)
    await pane.unmount()
  }
})

test('/meter hide and show toggle the band', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-10T00:00:00Z') })
  engine(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine band') as RenderElement
  })
  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 10 }],
    changed: ['rateLimits'],
  })
  const hidden = await $.command.run({ ...RUN, command: 'meter', args: 'hide' })
  expect(hidden.text).toMatch(/隱藏/)
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ ...BAND, surface })
    const text = await shown(band)
    expect(text).not.toMatch(/剩 90%/)
    expect(text).toMatch(/engine band/)
    await band.unmount()
  }

  await $.command.run({ ...RUN, command: 'meter', args: 'show' })
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await shown(band)).toMatch(/剩 90%/)
    await band.unmount()
  }
})
