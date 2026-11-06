// One line of the clean conversation: a message the person typed, or the
// final answer of a turn. `at` is when it arrived, in milliseconds since 1970;
// absent for a message rebuilt from an earlier transcript, which keeps none.
export type Entry = { id: string; who: 'you' | 'claude'; text: string; at?: number }

declare module 'claude-code' {
  interface PluginState {
    'clean-view': {
      // The clean conversation shown in the panel, oldest first.
      entries: Shaped<Entry[]>
    }
  }
}
