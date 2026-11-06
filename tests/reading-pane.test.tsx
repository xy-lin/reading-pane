import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionMessage, UiPane } from 'claude-code'

import {
  fromTranscript,
  isProgressNote,
  nameOf,
  shareOf,
  stamp,
  tablesToLists,
  typed,
  widthFor,
} from '../hooks/register'

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
  { role: 'user', text: '<command-name>/reading-pane</command-name>', toolUses: [] },
]

const PANE = {
  plugin: 'reading-pane',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'reading-pane',
  props: {
    title: 'Reading pane',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

// What the model's steps answer in a test: their text, and how many tool calls.
let steps: { answer: string; tools: number }[] = []

// 21:10 on 6 Nov 2026, local time: the engine's clock in these tests.
const NINE_TEN_PM = new Date(2026, 10, 6, 21, 10).getTime()

// The engine beneath the mod, with a record of the panes it opened (and the
// width it asked for, "-" for none) and closed, and a clock the test moves.
async function engine($: Engine, on: On, rows: SessionMessage[] = ROWS) {
  const log: string[] = []
  let panes: UiPane[] = []
  const clock = mock.clock(on, { now: NINE_TEN_PM })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'reading-pane' } }))
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
  // Each model step answers with the text and tool calls the test set.
  on('turn.step', async function* (_, e) {
    const step = steps[e.index] ?? { answer: '', tools: 0 }
    return {
      turnId: e.turnId,
      index: e.index,
      answer: step.answer,
      toolUses: Array.from({ length: step.tools }, () => ({ name: 'Bash', input: {} })),
      stopReason: step.tools > 0 ? ('tool_use' as const) : ('end_turn' as const),
      usage: null,
    }
  })
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
  expect(typed('/reading-pane')).toBeUndefined()
  expect(typed('[Request interrupted by user]')).toBeUndefined()
})

test('the panel opens at the start and shows the chat so far', async ($, on) => {
  const { log, clock } = await engine($, on)
  // No drawing told the window's width: after 3 seconds it opens anyway.
  await clock.advance(3000)
  expect(log).toEqual(['open reading-pane -'])

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
  await $.prompt.submit({ ...you('/reading-pane'), command: { name: 'reading-pane', args: '' } })

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

test('/reading-pane hides the panel, and shows it again', async ($, on) => {
  const { log, clock } = await engine($, on)
  await clock.advance(3000)
  const presentation = { isFullscreen: true, columns: 273 }
  const origin = { kind: 'composer' as const }

  const closed = await $.command.run({ command: 'reading-pane', args: '', origin, presentation })
  expect(closed.text).toMatch(/hidden/)
  const opened = await $.command.run({ command: 'reading-pane', args: '', origin, presentation })
  expect(opened.text).toMatch(/shown/)
  expect(log).toEqual(['open reading-pane -', 'close reading-pane', 'open reading-pane 104'])
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
    plugin: 'reading-pane',
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
  expect(log).toEqual(['open reading-pane 76', 'close reading-pane', 'open reading-pane 76'])
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
  expect(log).toEqual(['open reading-pane 104'])
  await ui.unmount()
})

test('the "Panel width" setting changes the share', { options: { panelWidth: 30 } }, async ($, on) => {
  const { log, clock } = await engine($, on)
  const ui = await $.ui.mount(hint(273))
  await clock.advance(200)
  expect(log).toEqual(['open reading-pane 82'])
  await ui.unmount()
})

test('a reload sizes the shown panel from the whole window, once', async ($, on) => {
  const { log, clock } = await engine($, on)
  const first = await $.ui.mount(hint(274))
  await clock.advance(200) // opens at 38.2% of 274 columns: 105
  await first.unmount()
  // Now docked: the chat column is narrower, and the panel says how wide it is.
  const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 84 } })
  const chat = await $.ui.mount(hint(187))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true }) // a reload
  await clock.advance(5000)
  // 187 + 84 + 3 = the same 274 columns, so the same 105, and nothing after it.
  expect(log).toEqual(['open reading-pane 105', 'open reading-pane 105'])
  await chat.unmount()
  await pane.unmount()
})

test('a table shows as a list in the panel; code blocks stay as they are', () => {
  const text = [
    'Before.',
    '',
    '| App | Last used | My suggestion |',
    '|---|---|---|',
    '| Supabase | Never | Revoke |',
    '| **GitHub CLI** | Within a week | Keep |',
    '',
    '```',
    '| not | a | table |',
    '|---|---|---|',
    '```',
    'After.',
  ].join('\n')
  expect(tablesToLists(text)).toBe(
    [
      'Before.',
      '',
      '- **Supabase**: Last used: Never; My suggestion: Revoke',
      '- **GitHub CLI**: Last used: Within a week; My suggestion: Keep',
      '',
      '```',
      '| not | a | table |',
      '|---|---|---|',
      '```',
      'After.',
    ].join('\n'),
  )
})

test("the panel draws an answer's table as a list", async ($, on) => {
  await engine($, on, [])
  await $.turn.complete(answer('Two apps:\n\n| App | Use |\n|---|---|\n| Supabase | Never |'))
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Markdown', text: /Two apps/ }))?.text).toMatch(/- \*\*Supabase\*\*: Use: Never/)
  await ui.unmount()
})

const LONG =
  "You're right, and I'm sorry. I saw the warning at the first check and passed it on as a " +
  'point for later. I should have said plainly that it would probably block the listing, ' +
  'and checked it before you spent half an hour on the form.'

test('a short note before a tool call is left out; longer text there is part of the answer', () => {
  expect(isProgressNote('Checking the file.')).toBe(true)
  expect(isProgressNote(LONG)).toBe(false)
  expect(isProgressNote('My plan:\n1. Fix it.')).toBe(false)
  const rows: SessionMessage[] = [
    { role: 'user', text: 'why?', toolUses: [] },
    { role: 'assistant', text: LONG, toolUses: [{ tool_use_id: 'w1', tool: 'Write', input: {} }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'w1', text: 'ok', isError: false }] },
    { role: 'assistant', text: 'Saving it.', toolUses: [{ tool_use_id: 'b1', tool: 'Bash', input: {} }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'b1', text: 'ok', isError: false }] },
    { role: 'assistant', text: 'The rule is saved.', toolUses: [] },
  ]
  expect(fromTranscript(rows).map(entry => entry.text)).toEqual(['why?', `${LONG}\n\nThe rule is saved.`])
})

test('the panel shows the whole answer of a turn, not only its last text', async ($, on) => {
  steps = [
    { answer: LONG, tools: 1 },
    { answer: 'Saving it.', tools: 1 },
    { answer: 'The rule is saved.', tools: 0 },
  ]
  await engine($, on, [])
  for (const index of [0, 1, 2]) {
    for await (const _ of $.turn.step({ turnId: 't1', index, model: 'opus', messageCount: 1 })) {
      // the steps stream nothing here
    }
  }
  await $.turn.complete(answer('The rule is saved.'))
  const ui = await $.ui.mount(PANE)
  const shown = await ui.find({ type: 'Markdown', text: /sorry/ })
  expect(shown?.text).toContain('The rule is saved.')
  expect(shown?.text).not.toContain('Saving it.')
  await ui.unmount()
  steps = []
})
