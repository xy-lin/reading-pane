import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionMessage, UiPane } from 'claude-code'

import { fromTranscript, nameOf, shareOf, stamp, typed, widthFor } from '../hooks/register'

// A chat so far: context the engine added, a prompt, a note before a tool
// call, the tool's result, the final answer, a background notice and its own
// answer, then a slash command.
const ROWS: SessionMessage[] = [
  { role: 'user', text: '<system-reminder>context</system-reminder>', toolUses: [] },
  { role: 'user', text: 'fix the typo in notes.md', toolUses: [] },
  {
    role: 'assistant',
    text: "I'll open the file first.",
    toolUses: [{ tool_use_id: 'r1', tool: 'Read', input: { file_path: 'notes.md' } }],
  },
  {
    role: 'user',
    text: '',
    toolUses: [],
    toolResults: [{ tool_use_id: 'r1', text: 'recieve', isError: false }],
  },
  { role: 'assistant', text: 'Fixed: "recieve" is now "receive".', toolUses: [] },
  { role: 'user', text: '<task-notification>done</task-notification>', toolUses: [] },
  { role: 'assistant', text: 'The background job finished.', toolUses: [] },
  { role: 'user', text: '<command-name>/clean</command-name>', toolUses: [] },
]

const PANE = {
  plugin: 'clean-view',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'clean-view',
  props: {
    title: 'Clean view',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

// 21:10 on 6 Nov 2026, local time: the engine's clock in these tests.
const NINE_TEN_PM = new Date(2026, 10, 6, 21, 10).getTime()

// The engine beneath the mod, with a record of the panes it opened (and the
// width it asked for, "-" for none) and closed, and a clock the test moves.
async function engine($: Engine, on: On, rows: SessionMessage[] = ROWS) {
  const log: string[] = []
  let panes: UiPane[] = []
  const clock = mock.clock(on, { now: NINE_TEN_PM })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'clean' } }))
  on('session.messages', () => ({ value: rows }))
  on('ui.open', (_, e) => {
    log.push(`open ${e.id} ${e.columns ?? '-'}`)
    panes = [{ id: e.id, title: e.title ?? e.id, isShown: true, isFocused: false, isPlaced: true }]
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', (_, e) => {
    log.push(`close ${e.id}`)
    panes = []
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: panes }))
  on('ui.scroll', () => ({}))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  // What the engine draws where the mod passes: the hint line's words.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>? for shortcuts</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  return { log, clock }
}

function you(text: string) {
  return { text, origin: { kind: 'composer' as const }, wait: false }
}

function answer(text: string, agentId?: string) {
  return {
    answer: text,
    durationMs: 1000,
    isAborted: false,
    turnId: 't1',
    reason: 'answer' as const,
    ...(agentId === undefined ? {} : { agentId }),
  }
}

test('the transcript gives prompts and final answers, never notes', () => {
  expect(fromTranscript(ROWS).map(entry => `${entry.who}: ${entry.text}`)).toEqual([
    'you: fix the typo in notes.md',
    'claude: Fixed: "recieve" is now "receive".',
    'claude: The background job finished.',
  ])
})

test('only what the person typed counts as theirs', () => {
  expect(typed('hello <system-reminder>x</system-reminder>')).toBe('hello')
  expect(typed('<task-notification>x</task-notification>')).toBeUndefined()
  expect(typed('/clean')).toBeUndefined()
  expect(typed('[Request interrupted by user]')).toBeUndefined()
})

test('the panel opens at the start and shows the chat so far', async ($, on) => {
  const { log, clock } = await engine($, on)
  // No drawing told the window's width: after 3 seconds it opens anyway.
  await clock.advance(3000)
  expect(log).toEqual(['open clean-view -'])

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /fix the typo/ })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: /is now "receive"/ })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: /open the file first/ })).toBeUndefined()
  await ui.unmount()
})

test('new messages and answers are added; a subagent answer is not', async ($, on) => {
  await engine($, on, [])
  await $.prompt.submit(you('what is the weather?'))
  await $.turn.complete(answer('Sunny, 14°C.'))
  await $.turn.complete(answer('subagent report', 'agent-1'))
  await $.prompt.submit({ ...you('/clean'), command: { name: 'clean', args: '' } })

  const ui = await $.ui.mount(PANE)
  const mine = await ui.find({ type: 'Text', text: /what is the weather\?/ })
  expect(mine?.props.color).toBe('suggestion')
  expect(await ui.find({ type: 'Markdown', text: /Sunny/ })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: /subagent report/ })).toBeUndefined()
  expect(await ui.findAll({ type: 'Text', text: /^You$/ })).toHaveLength(1)
  expect((await ui.find({ type: 'Text', text: /^Claude$/ }))?.props.color).toBe('claude')
  await ui.unmount()
})

test('an empty panel says what will show there', async ($, on) => {
  await engine($, on, [])
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /will show here/ })).toBeDefined()
  await ui.unmount()
})

test('/clean closes the open panel, and opens it again', async ($, on) => {
  const { log, clock } = await engine($, on)
  await clock.advance(3000)
  const presentation = { isFullscreen: true, columns: 273 }
  const origin = { kind: 'composer' as const }

  const closed = await $.command.run({ command: 'clean', args: '', origin, presentation })
  expect(closed.text).toMatch(/closed/)
  const opened = await $.command.run({ command: 'clean', args: '', origin, presentation })
  expect(opened.text).toMatch(/opened/)
  expect(log).toEqual(['open clean-view -', 'close clean-view', 'open clean-view 104'])
})

test('a time reads "21:10" today and "5 Nov 21:10" on an earlier day', () => {
  const at = new Date(2026, 10, 5, 21, 10).getTime()
  expect(stamp(at, new Date(2026, 10, 5, 23, 59).getTime())).toBe('21:10')
  expect(stamp(at, new Date(2026, 10, 6, 9, 0).getTime())).toBe('5 Nov 21:10')
  expect(stamp(new Date(2026, 0, 2, 7, 5).getTime(), at)).toBe('2 Jan 07:05')
})

test('each new message shows its time at the end of its name row', async ($, on) => {
  await engine($, on, [])
  await $.prompt.submit(you('what is the weather?'))
  await $.turn.complete(answer('Sunny, 14°C.'))

  const ui = await $.ui.mount(PANE)
  // "21:10" on 6 Nov 2026; "6 Nov 21:10" when the test runs on a later day.
  expect(await ui.findAll({ type: 'Text', text: /21:10$/ })).toHaveLength(2)
  await ui.unmount()
})

test('a reload keeps the times; older messages show none', async ($, on) => {
  await engine($, on)
  await $.prompt.submit(you('fix the typo in notes.md'))
  // A reload rebuilds the panel from the transcript, which keeps no times.
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(PANE)
  expect(await ui.findAll({ type: 'Text', text: /21:10$/ })).toHaveLength(1)
  expect(await ui.find({ type: 'Markdown', text: /The background job finished/ })).toBeDefined()
  await ui.unmount()
})

// The hint line under the prompt, in a window `columns` wide.
function hint(columns = 273) {
  return {
    plugin: 'clean-view',
    surface: 'terminal',
    component: 'PromptHint',
    requestId: 'hint',
    props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
    viewport: { columns, rows: 60, isFullscreen: true },
  } as const
}

test('the hint line keeps its words and gains the panel button', async ($, on) => {
  await engine($, on)
  const ui = await $.ui.mount(hint())
  expect(await ui.find({ type: 'Text', text: /for shortcuts/ })).toBeDefined()
  const button = await ui.find({ type: 'Button', key: 'toggle' })
  expect(button?.props.action).toBe('app:cycleDiffBase')
  await ui.unmount()
})

test('the button hides the panel, then shows it again', async ($, on) => {
  const { log, clock } = await engine($, on)
  const ui = await $.ui.mount(hint(200))
  await clock.advance(200)
  await ui.press({ key: 'toggle' })
  await ui.press({ key: 'toggle' })
  expect(log).toEqual(['open clean-view 76', 'close clean-view', 'open clean-view 76'])
  await ui.unmount()
})

test('names come from the settings, or fall back to the defaults', () => {
  expect(nameOf('  Xinyu ', 'You')).toBe('Xinyu')
  expect(nameOf('', 'You')).toBe('You')
  expect(nameOf(undefined, 'Claude')).toBe('Claude')
  expect(nameOf('x'.repeat(60), 'You')).toHaveLength(40)
})

test('the panel shows the names set in /config', { options: { yourName: 'Xinyu', claudeName: 'CASK' } }, async ($, on) => {
  await engine($, on, [])
  await $.prompt.submit(you('hello'))
  await $.turn.complete(answer('Hi.'))

  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /^Xinyu$/ }))?.props.color).toBe('suggestion')
  expect((await ui.find({ type: 'Text', text: /^CASK$/ }))?.props.color).toBe('claude')
  expect(await ui.find({ type: 'Text', text: /^You$/ })).toBeUndefined()
  await ui.unmount()
})

test('the width: golden section by default, at most 45%', () => {
  const percent = (value: unknown) => Math.round(shareOf(value) * 1000) / 10
  expect(percent(undefined)).toBe(38.2)
  expect(percent(30)).toBe(30)
  expect(percent('40')).toBe(40)
  expect(percent(60)).toBe(45)
  expect(percent(0)).toBe(38.2)
  expect(percent('wide')).toBe(38.2)
  expect(widthFor(273, 0.382)).toBe(104)
  expect(widthFor(40, 0.382)).toBe(24)
})

test('the panel opens at the golden section once the width is known', async ($, on) => {
  const { log, clock } = await engine($, on)
  const ui = await $.ui.mount(hint(273))
  await clock.advance(200)
  expect(log).toEqual(['open clean-view 104'])
  await ui.unmount()
})

test('the "Panel width" setting changes the share', { options: { panelWidth: 30 } }, async ($, on) => {
  const { log, clock } = await engine($, on)
  const ui = await $.ui.mount(hint(273))
  await clock.advance(200)
  expect(log).toEqual(['open clean-view 82'])
  await ui.unmount()
})

test('a narrower window sizes the panel again, keeping its share', async ($, on) => {
  const { log, clock } = await engine($, on)
  const wide = await $.ui.mount(hint(273))
  await clock.advance(200)
  await wide.unmount()
  const narrow = await $.ui.mount(hint(200))
  await clock.advance(1000)
  expect(log).toEqual(['open clean-view 104', 'open clean-view 76'])
  await narrow.unmount()
})
