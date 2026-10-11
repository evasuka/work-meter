import { expect, test } from 'claude-code/testing'

import { parseThresholds, planAlerts } from '../hooks/alerts'

const NOW = Date.parse('2026-10-10T00:00:00Z')
const LEVELS = [20, 10]
const five = (percentUsed: number, resetsAt?: string) => ({ kind: 'five_hour', percentUsed, resetsAt })
const week = (percentUsed: number) => ({ kind: 'seven_day', percentUsed })

// Catches: a threshold list that is unsorted, duplicated, out of range or unparsable.
const PARSE: [string, number[]][] = [
  ['20,10', [20, 10]],
  [' 10 , 20 ', [20, 10]],
  ['20,20,10', [20, 10]],
  ['abc,15,0,100,-5', [15]],
  ['', [20, 10]],
  ['abc', [20, 10]],
]
for (const [text, want] of PARSE) {
  test(`parseThresholds(${JSON.stringify(text)})`, () => {
    expect(parseThresholds(text)).toEqual(want)
  })
}

// Catches: no alert on the first reading, a wrong level, or an alert that hides the window or what is left.
test('the first reading below a threshold alerts once with the window, the % left and the reset time', () => {
  const plan = planAlerts({}, [five(82, '2026-10-10T02:13:00Z')], LEVELS, NOW)
  expect(plan.messages.length).toBe(1)
  expect(plan.messages[0]).toMatch(/5 小時/)
  expect(plan.messages[0]).toMatch(/18%/)
  expect(plan.messages[0]).toMatch(/2h13m/)
  expect(plan.next).toEqual({ five_hour: 20 })
})

// Catches: `<` written where `<=` belongs, or the reverse.
test('exactly at the threshold counts as crossed, one point above does not', () => {
  expect(planAlerts({}, [five(80)], LEVELS, NOW).messages.length).toBe(1)
  expect(planAlerts({}, [five(79)], LEVELS, NOW).messages.length).toBe(0)
})

// Catches: alerting while there is still plenty left, or forgetting the window in memory.
test('above every threshold stays silent and remembers nothing alerted', () => {
  const plan = planAlerts({}, [five(50)], LEVELS, NOW)
  expect(plan.messages.length).toBe(0)
  expect(plan.next).toEqual({ five_hour: null })
})

// Catches: a missing dedupe, which would toast on every turn.
test('the same level does not alert again', () => {
  const plan = planAlerts({ five_hour: 20 }, [five(85)], LEVELS, NOW)
  expect(plan.messages.length).toBe(0)
  expect(plan.next).toEqual({ five_hour: 20 })
})

// Catches: stopping after the first level, so the deeper warning never comes.
test('crossing the next threshold alerts again', () => {
  const plan = planAlerts({ five_hour: 20 }, [five(91)], LEVELS, NOW)
  expect(plan.messages.length).toBe(1)
  expect(plan.messages[0]).toMatch(/9%/)
  expect(plan.next).toEqual({ five_hour: 10 })
})

// Catches: two toasts for one drop, or a toast quoting the threshold instead of the real value.
test('a jump past two thresholds alerts once with the current value', () => {
  const plan = planAlerts({ five_hour: null }, [five(92)], LEVELS, NOW)
  expect(plan.messages.length).toBe(1)
  expect(plan.messages[0]).toMatch(/8%/)
  expect(plan.next).toEqual({ five_hour: 10 })
})

// Catches: no recovery notice, or never re-arming so the next drop goes unnoticed.
test('recovering above every threshold says so once and re-arms the alerts', () => {
  const down = planAlerts({}, [five(95)], LEVELS, NOW)
  const up = planAlerts(down.next, [five(45)], LEVELS, NOW)
  expect(up.messages.length).toBe(1)
  expect(up.messages[0]).toMatch(/55%/)
  expect(up.next).toEqual({ five_hour: null })

  const again = planAlerts(up.next, [five(85)], LEVELS, NOW)
  expect(again.messages.length).toBe(1)
  expect(again.next).toEqual({ five_hour: 20 })
})

// Catches: leaving the deeper level armed after a partial recovery, so the second drop below it is silent.
test('a partial recovery is silent but re-arms the deeper threshold', () => {
  const partial = planAlerts({ five_hour: 10 }, [five(85)], LEVELS, NOW)
  expect(partial.messages.length).toBe(0)
  expect(partial.next).toEqual({ five_hour: 20 })

  const deeper = planAlerts(partial.next, [five(91)], LEVELS, NOW)
  expect(deeper.messages.length).toBe(1)
})

// Catches: one window's state leaking into another.
test('windows are tracked independently', () => {
  const plan = planAlerts({}, [five(82), week(40)], LEVELS, NOW)
  expect(plan.messages.length).toBe(1)
  expect(plan.messages[0]).toMatch(/5 小時/)
  expect(plan.messages[0]).not.toMatch(/7 天/)
  expect(plan.next).toEqual({ five_hour: 20, seven_day: null })
})

// Catches: assuming only the two subscription windows exist.
test('a spend limit window is handled like any other', () => {
  const plan = planAlerts({}, [{ kind: 'spend_limit', percentUsed: 95 }], LEVELS, NOW)
  expect(plan.messages.length).toBe(1)
  expect(plan.messages[0]).toMatch(/花費上限/)
  expect(plan.messages[0]).toMatch(/5%/)
})

// Catches: printing "undefined" or NaN when the engine gives no reset time.
test('a window without a reset time omits it from the message', () => {
  const plan = planAlerts({}, [five(82)], LEVELS, NOW)
  expect(plan.messages[0]).not.toMatch(/後重置/)
  expect(plan.messages[0]).not.toMatch(/undefined|NaN/)
})

// Catches: a negative "% left" when usage is reported past 100.
test('usage past 100% reads as 0% left', () => {
  const plan = planAlerts({}, [five(130)], LEVELS, NOW)
  expect(plan.messages[0]).toMatch(/0%/)
  expect(plan.messages[0]).not.toMatch(/-/)
})

// Catches: wiping the memory when a response carries no rate-limit data, which would re-alert later.
test('a reading without windows leaves the memory untouched', () => {
  const plan = planAlerts({ five_hour: 10 }, [], LEVELS, NOW)
  expect(plan.messages.length).toBe(0)
  expect(plan.next).toEqual({ five_hour: 10 })
})
