# clean-view

A Claude Code mod that adds a **clean view panel** beside the chat. The panel shows only
what is meant for you to read: the messages you typed, and Claude's final answer to each
one. Tool calls, command output, diffs and Claude's in-between notes stay in the main chat,
which is not changed.

- Your messages sit in blue frames; Claude's answers sit in orange frames, drawn as
  Markdown. The colours follow your Claude Code theme.
- The panel opens on its own when the terminal is wide enough. Type `/clean` to open or
  close it at any time.
- It asks for the widest panel Claude Code allows: 45% of the window.
- A resumed chat fills the panel from its history.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install clean-view --marketplace xy-lin/clean-view
```

Answer `y` to add the marketplace, then pick a scope (the user scope loads it in every
session).

From a shell:

```
claude plugin install clean-view --marketplace xy-lin/clean-view
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then
**Plugins**, **Add marketplace** with `xy-lin/clean-view`, then **Add plugin**.

## Good to know

- The panel docks beside the chat in Claude Code's fullscreen layout, from 110 columns.
  On the main screen it opens above the prompt box instead.
- The mod adds a short note to Claude's system prompt, asking it to make the last answer of
  each turn complete on its own, since the panel shows nothing else.
- It does nothing in non-interactive runs (`claude -p`).
- It uses Claude Code's mod (function hooks) API, which is in early access and may change
  between releases. Built and tested on Claude Code 2.1.319.

## Tests

```
claude plugin test .
```

## Licence

MIT. See [LICENSE](LICENSE).
