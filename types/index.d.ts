// One line of the clean conversation: a message the person typed, or the
// final answer of a turn.
export type Entry = { id: string; who: 'you' | 'claude'; text: string }

declare module 'claude-code' {
  interface PluginState {
    'clean-view': {
      // The clean conversation shown in the panel, oldest first.
      entries: Shaped<Entry[]>
    }
  }
}
