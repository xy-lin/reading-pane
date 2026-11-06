// reading-pane: a panel beside the chat that shows only what is meant for the
// person to read: the messages they typed and Claude's final answer to each.
//
// The chat itself is unchanged. The "◧ reading pane" button at the end of the
// hint line under the prompt (and the key bound to it) shows or hides the
// panel; so does /reading-pane.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMessage } from 'claude-code'

import type { Entry } from '../types'

const PANE = 'reading-pane'
const TITLE = 'Reading pane'
const KEEP = 200 // the panel keeps the last 200 messages

// The panel's width, as a share of the window: the golden section unless set
// in /config ("Panel width"), so the panel takes 38.2% and the chat 61.8%.
// The app allows a panel at most 45% of the window.
const GOLDEN = 38.2
const MOST = 45

// The "Panel width" setting as a share: a percentage up to 45, else golden.
export function shareOf(value: unknown): number {
  const n =
    typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : Number.NaN
  return (Number.isFinite(n) && n > 0 ? Math.min(n, MOST) : GOLDEN) / 100
}

// The panel's width in columns for a window `columns` wide: at least 24.
export function widthFor(columns: number, share: number): number {
  return Math.max(24, Math.round(columns * share))
}

// The key that shows or hides the panel. A mod cannot add a key action of its
// own, so the hint-line button borrows this one: the engine handles it only
// while its diff panel is open, and otherwise the key bound to it presses the
// button. Bind a key to it in ~/.claude/keybindings.json (see the README).
const SHORTCUT = 'app:cycleDiffBase'

// A name from the settings (/config): trimmed, kept short, else the default.
export function nameOf(value: unknown, fallback: string): string {
  const name = typeof value === 'string' ? value.trim() : ''
  return name === '' ? fallback : name.slice(0, 40)
}

// Colours, as theme names so they follow the person's light or dark theme.
const YOU = 'suggestion' // soft blue: the person's messages
const ME = 'claude' // Claude orange: the answers

// Change the tag when Entry changes: older stored values are then ignored.
const entries = atom({ plugin: 'reading-pane', key: 'entries' } as const, [], {
  shape: 'entries-1',
})

// Read by the model, so each turn's answer reads well in the panel.
const NOTE = `# Reading pane
The person may read this chat in a side panel that shows only their own messages and your answer of each turn: the text of your last response in the turn, plus any longer text you wrote earlier in the turn. Short progress notes before a tool call are left out. Write the answer last: finish any tool work first (saving notes, journal entries, commit messages), then write it. Make it complete on its own: the outcome, what changed, and anything they must do. Do not point to tool output, diffs or notes "above": the panel does not show them.`

// Text written before a tool call is a progress note when it is short: one
// line of under 200 characters. Longer text there is part of the answer.
export function isProgressNote(text: string): boolean {
  const t = text.trim()
  return t.length < 200 && !t.includes('\n')
}

// What the person typed, without what the engine adds to a message. Undefined
// for anything they did not type (reminders, notices, commands, interrupts).
export function typed(text: string): string | undefined {
  const t = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()
  if (t === '' || t.startsWith('<') || t.startsWith('/') || t.startsWith('[Request interrupted')) {
    return undefined
  }
  return t
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// A message's time, local: "21:10" today, "5 Nov 21:10" on an earlier day.
export function stamp(at: number, now: number): string {
  const d = new Date(at)
  const today = new Date(now)
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const isToday =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  return isToday ? time : `${d.getDate()} ${MONTHS[d.getMonth()]} ${time}`
}

// A Markdown table is too wide for the narrow panel, so the panel shows each
// row as one list line instead: the first cell in bold, then each other cell
// after its column's name. Text inside code blocks is left as it is.
export function tablesToLists(text: string): string {
  const isRow = (line: string) => /^\s*\|.*\|\s*$/.test(line)
  const isRule = (line: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line)
  const cells = (line: string) =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split(/(?<!\\)\|/)
      .map(cell => cell.trim().replace(/\\\|/g, '|'))
  const lines = text.split('\n')
  const out: string[] = []
  let isCode = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (/^\s*(```|~~~)/.test(line)) isCode = !isCode
    const rule = lines[i + 1]
    if (isCode || !isRow(line) || rule === undefined || !isRule(rule)) {
      out.push(line)
      continue
    }
    const head = cells(line)
    i += 1
    while (isRow(lines[i + 1] ?? '')) {
      i += 1
      const row = cells(lines[i] ?? '')
      const label = (row[0] ?? '').replace(/^\*\*(.*)\*\*$/, '$1')
      const rest = row
        .slice(1)
        .map((cell, k) => (head[k + 1] ? `${head[k + 1]}: ${cell}` : cell))
        .filter(part => part.trim() !== '')
      out.push(`- **${label}**${rest.length > 0 ? `: ${rest.join('; ')}` : ''}`)
    }
  }
  return out.join('\n')
}

// The clean conversation so far, rebuilt from the transcript: each message the
// person typed, and Claude's answer to it, made of its texts in order. A short
// progress note written before a tool call is left out.
export function fromTranscript(rows: readonly SessionMessage[]): Entry[] {
  const out: Entry[] = []
  let parts: string[] = [] // the answer so far
  let latest: string | undefined // the latest text, until we know what follows it
  const settle = (isBeforeTool: boolean) => {
    if (latest !== undefined && !(isBeforeTool && isProgressNote(latest))) parts.push(latest)
    latest = undefined
  }
  const flush = () => {
    settle(false)
    if (parts.length > 0) out.push({ id: `t${out.length}`, who: 'claude', text: parts.join('\n\n') })
    parts = []
  }
  for (const row of rows) {
    if (row.role === 'assistant') {
      const text = row.text.trim()
      if (text !== '') {
        settle(false) // another text came next, not a tool call
        latest = text
      }
      if (row.toolUses.length > 0) settle(true)
      continue
    }
    if (row.toolResults !== undefined && row.toolResults.length > 0) continue
    flush()
    const prompt = typed(row.text)
    if (prompt !== undefined) out.push({ id: `t${out.length}`, who: 'you', text: prompt })
  }
  flush()
  return out
}

// Opens the panel at its share of a window `columns` wide; with the width not
// known, at the app's own default width.
async function openPanel($: EngineInterface, share: number, columns?: number) {
  const ask = columns === undefined ? {} : { columns: widthFor(columns, share) }
  try {
    return await $.ui.open({ id: PANE, title: TITLE, ...ask })
  } catch {
    return await $.ui.open({ id: PANE, title: TITLE })
  }
}

// Bring the newest messages into view. A pane that is not open is left alone.
async function showNewest($: EngineInterface) {
  try {
    await $.ui.scroll({ in: PANE, to: 'end' })
  } catch {
    // not open, or not drawn yet: nothing to scroll
  }
}

// Whether the panel shows now.
async function isShown($: EngineInterface) {
  return (await $.ui.panes()).some(one => one.id === PANE && one.isPlaced)
}

// The panel's share of the window ("Panel width" in /config), and what the
// mod's drawings report of the window: the chat column's width (the hint line
// is drawn in it) and the docked panel's width (0 when it isn't docked). The
// window is the two together. Set again at every load.
const panel: { share: number; chatColumns?: number; paneColumns?: number } = {
  share: GOLDEN / 100,
}

// Columns the docked panel takes beside its body: the divider and its margin.
const FRAME = 3

// The window's width: the chat column alone while the panel doesn't show, the
// chat column and the docked panel together while it does; undefined until
// the drawings have told it.
async function windowWidth($: EngineInterface) {
  const chat = panel.chatColumns
  if (chat === undefined) return undefined
  if (!(await isShown($))) return chat
  return panel.paneColumns === undefined ? undefined : chat + panel.paneColumns
}

// Opens the panel at its share of the window. Each open sizes it once; nothing
// sizes it again by itself, so it never moves while you read.
async function openSized($: EngineInterface, columns?: number) {
  const opened = await openPanel($, panel.share, columns ?? (await windowWidth($)))
  if (opened.isPlaced) await showNewest($)
  return opened
}

// Opens the panel once the window's width is known, or anyway when `force`.
async function tryOpen($: EngineInterface, force: boolean) {
  const width = await windowWidth($)
  if (width === undefined && !force) return false
  await openSized($, width)
  return true
}

// Closes the panel where it shows, else opens it: for the button and the command.
async function toggle($: EngineInterface, columns?: number) {
  if (await isShown($)) {
    await $.ui.close({ id: PANE })
    return 'closed' as const
  }
  await openSized($, columns)
  return 'opened' as const
}

let serial = 0 // keeps ids apart for messages that arrive in the same millisecond

async function add($: EngineInterface, who: Entry['who'], text: string) {
  const at = await $.clock.now()
  const id = `${who}-${at}-${serial++}`
  await update($, entries, list => [...list, { id, who, text, at }].slice(-KEEP))
  await showNewest($)
}

export const register: Register = (on, options) => {
  // The names above the messages, set in /config ("Your name", "Claude's name").
  const names = {
    you: nameOf(options.yourName, 'You'),
    claude: nameOf(options.claudeName, 'Claude'),
  }

  panel.share = shareOf(options.panelWidth)
  panel.chatColumns = undefined
  panel.paneColumns = undefined

  // False until session.start says so; `claude -p` runs stay untouched.
  let isInteractive = false

  on('session.start', async ($, e, next) => {
    isInteractive = e.isInteractive
    if (!isInteractive) return next(e)
    await $.command.register({
      name: 'reading-pane',
      description: 'Show or hide the reading pane (your messages and my answers only)',
    })
    // Rebuilt at every start and reload, so a resumed chat fills the panel too.
    // The transcript keeps no times, so each message keeps the time the panel
    // already had for it (after a reload); older ones show none.
    try {
      const held = await read($, entries)
      const times = new Map(held.map(entry => [`${entry.who}\n${entry.text}`, entry.at]))
      const rebuilt = fromTranscript(await $.session.messages())
        .slice(-KEEP)
        .map(entry => {
          const at = times.get(`${entry.who}\n${entry.text}`)
          return at === undefined ? entry : { ...entry, at }
        })
      await update($, entries, () => rebuilt)
    } catch {
      // keep what the panel had
    }
    // Open once the window's width is known (the drawings tell it), or after
    // 3 seconds without it. Opened unasked, the panel shows where the window
    // is wide enough (144 columns, or 110 once the person has opened it by
    // hand), else it waits.
    let waited = 0
    let isTrying = false
    const start = $.clock.every(200, () => {
      if (isTrying) return
      isTrying = true
      waited += 200
      tryOpen($, waited >= 3000)
        .then(isOpened => {
          if (isOpened) start.cancel()
        })
        .catch(() => start.cancel())
        .finally(() => {
          isTrying = false
        })
    })
    return next(e)
  })

  on('command.run', { command: 'reading-pane' }, async ($, e) =>
    (await toggle($, e.presentation.columns)) === 'closed'
      ? { text: 'Reading pane hidden.' }
      : { text: 'Reading pane shown.' },
  )

  // The hint line under the prompt keeps its words, with the panel's button at
  // the end. The button is always there, so its key works whether the panel
  // shows or not.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (e.surface === 'terminal' && e.viewport !== undefined) {
      panel.chatColumns = e.viewport.columns
    }
    const line = await next(e)
    const { Box, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" justifyContent="space-between">
        {line}
        <Button
          key="toggle"
          label="◧ reading pane"
          plain
          dimColor
          action={SHORTCUT}
          onPress={async () => {
            await toggle($)
          }}
        />
      </Box>
    )
  })

  on('prompt.submit', async ($, e, next) => {
    const isPerson = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    const text = isPerson && e.command === undefined && e.isMeta !== true ? typed(e.text) : undefined
    if (isInteractive && text !== undefined) {
      try {
        await add($, 'you', text)
      } catch {
        // the panel misses one line; the prompt goes on
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e)) // a fault here never holds up a prompt

  // The longer texts Claude wrote before a tool call, per running turn: they are
  // part of that turn's answer. Each step is passed on unchanged.
  const earlier = new Map<string, string[]>()

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    try {
      const text = result.answer.trim()
      const isPart = text !== '' && result.toolUses.length > 0 && !isProgressNote(text)
      if (isInteractive && e.agentId === undefined && isPart) {
        earlier.set(e.turnId, [...(earlier.get(e.turnId) ?? []), text])
      }
    } catch {
      // the panel may miss a part of the answer; the step goes on
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const parts = earlier.get(e.turnId) ?? []
    earlier.delete(e.turnId)
    const last = e.answer.trim()
    if (last !== '' && last !== parts[parts.length - 1]) parts.push(last)
    const text = parts.join('\n\n')
    if (isInteractive && e.agentId === undefined && text !== '') {
      try {
        await add($, 'claude', text)
      } catch {
        // the panel misses one answer; the turn ends as before
      }
    }
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!isInteractive || e.traits.includes('bare') || e.traits.includes('print')) {
      return composed
    }
    return {
      sections: [...composed.sections, { id: 'reading-pane:note', text: NOTE, scope: 'session' }],
    }
  })

  // Each message in a rounded frame: the person's in blue, the answers in
  // orange. The top row holds the name, and the time at the end of the row.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Markdown } = $.ui.resolve(e)
    if (e.surface === 'terminal') {
      panel.paneColumns = e.props.placement === 'dock' ? e.props.bodyColumns + FRAME : 0
    }
    const list = await read($, entries)
    const now = Date.now()
    const top = (name: string, color: string, entry: Entry) => (
      <Box flexDirection="row" justifyContent="space-between">
        <Text color={color} bold>
          {name}
        </Text>
        {entry.at === undefined ? null : <Text dimColor>{stamp(entry.at, now)}</Text>}
      </Box>
    )
    if (list.length === 0) {
      return <Text dimColor>Your messages and my answers will show here.</Text>
    }
    return (
      <Box flexDirection="column">
        {list.map(entry =>
          entry.who === 'you' ? (
            <Box
              key={entry.id}
              flexDirection="column"
              marginTop={1}
              borderStyle="round"
              borderColor={YOU}
              paddingX={1}
            >
              {top(names.you, YOU, entry)}
              <Text color={YOU}>
                {entry.text.length > 500 ? `${entry.text.slice(0, 500)}…` : entry.text}
              </Text>
            </Box>
          ) : (
            <Box
              key={entry.id}
              flexDirection="column"
              borderStyle="round"
              borderColor={ME}
              paddingX={1}
            >
              {top(names.claude, ME, entry)}
              <Markdown text={tablesToLists(entry.text)} />
            </Box>
          ),
        )}
      </Box>
    )
  })
}
