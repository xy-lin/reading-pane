// clean-view: a panel beside the chat that shows only what is meant for the
// person to read: the messages they typed and Claude's final answer to each.
//
// The chat itself is unchanged. /clean opens or closes the panel.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMessage } from 'claude-code'

import type { Entry } from '../types'

const PANE = 'clean-view'
const TITLE = 'Clean view'
const KEEP = 200 // the panel keeps the last 200 messages

// The app lets a panel take at most 45% of the window, so the panel asks for
// that much; a bigger ask is cut down to it.
const SHARE = 0.45
const WIDEST = 1000

// Colours, as theme names so they follow the person's light or dark theme.
const YOU = 'suggestion' // soft blue: the person's messages
const ME = 'claude' // Claude orange: the answers

// Change the tag when Entry changes: older stored values are then ignored.
const entries = atom({ plugin: 'clean-view', key: 'entries' } as const, [], {
  shape: 'entries-1',
})

// Read by the model, so the last text of each turn makes sense on its own.
const NOTE = `# Clean view panel
The person may read this chat in a side panel that shows only their own messages and your final answer of each turn (the text of your last response in the turn). Make that final answer complete on its own: the outcome, what changed, and anything they must do. Do not point to tool output, diffs or notes "above": the panel does not show them.`

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

// The clean conversation so far, rebuilt from the transcript: each message the
// person typed, and each turn's final answer. Text written before a tool call
// is a note, not an answer, so it is left out.
export function fromTranscript(rows: readonly SessionMessage[]): Entry[] {
  const out: Entry[] = []
  let answer: string | undefined
  const flush = () => {
    if (answer !== undefined) out.push({ id: `t${out.length}`, who: 'claude', text: answer })
    answer = undefined
  }
  for (const row of rows) {
    if (row.role === 'assistant') {
      const text = row.text.trim()
      if (text !== '') {
        flush() // an earlier answer with no tool call after it was final
        answer = text
      }
      if (row.toolUses.length > 0) answer = undefined
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

// Opens the panel as wide as the app allows. `columns` is the window's width
// when known; else the ask is cut down to the limit by the app itself.
async function openPanel($: EngineInterface, columns?: number) {
  const wide = columns === undefined ? WIDEST : Math.max(24, Math.floor(columns * SHARE))
  try {
    return await $.ui.open({ id: PANE, title: TITLE, columns: wide })
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

async function add($: EngineInterface, who: Entry['who'], text: string) {
  const at = await $.clock.now()
  const id = `${who}-${at}`
  await update($, entries, list => [...list, { id, who, text, at }].slice(-KEEP))
  await showNewest($)
}

export const register: Register = on => {
  // False until session.start says so; `claude -p` runs stay untouched.
  let isInteractive = false

  on('session.start', async ($, e, next) => {
    isInteractive = e.isInteractive
    if (!isInteractive) return next(e)
    await $.command.register({
      name: 'clean',
      description: 'Open or close the clean view panel (your messages and my answers only)',
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
    // Opened unasked: it shows where the terminal is wide enough (144 columns,
    // or 110 once the person has opened it with /clean), else it waits.
    const opened = await openPanel($)
    if (opened.isPlaced) await showNewest($)
    return next(e)
  })

  on('command.run', { command: 'clean' }, async ($, e) => {
    const pane = (await $.ui.panes()).find(one => one.id === PANE)
    if (pane?.isPlaced === true) {
      await $.ui.close({ id: PANE })
      return { text: 'Clean view panel closed. Type /clean to open it again.' }
    }
    await openPanel($, e.presentation.columns)
    await showNewest($)
    return { text: 'Clean view panel opened.' }
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

  on('turn.complete', async ($, e, next) => {
    const text = e.answer.trim()
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
      sections: [...composed.sections, { id: 'clean-view:note', text: NOTE, scope: 'session' }],
    }
  })

  // Each message in a rounded frame: the person's in blue, the answers in
  // orange. The top row holds the name, and the time at the end of the row.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Markdown } = $.ui.resolve(e)
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
              {top('You', YOU, entry)}
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
              {top('Claude', ME, entry)}
              <Markdown text={entry.text} />
            </Box>
          ),
        )}
      </Box>
    )
  })
}
