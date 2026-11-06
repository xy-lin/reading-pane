# clean-view

A Claude Code mod that adds a **clean view panel** beside the chat. The panel shows only
what is meant for you to read: the messages you typed, and Claude's final answer to each
one. Tool calls, command output, diffs and Claude's in-between notes stay in the main chat,
which is not changed.

- Your messages sit in blue frames; Claude's answers sit in orange frames, drawn as
  Markdown. The colours follow your Claude Code theme.
- Each message has a name and a time on its top row ("21:10", or "5 Nov 21:10" for an
  earlier day). Messages rebuilt from an older chat's history have no time, because the
  transcript does not keep one.
- The panel opens on its own when the terminal is wide enough, and asks for the widest
  panel Claude Code allows: 45% of the window.
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

## Usage

### Show or hide the panel

Any of these:

- Type `/clean` and press Enter.
- Click **◧ clean view** at the end of the hint line under the prompt box.
- Press your shortcut key, once you have set one (see below).

### Set the names

The panel puts a name above each message: "You" and "Claude" unless you change them.
Claude Code asks for both names when you install the mod. To change them later:

1. Type `/config` and press Enter. The settings list opens.
2. Press `/` and type `name` to find **Your name** and **Claude's name**.
3. Select one, type the new name, and press Enter.

The panel shows the new names straight away.

### Set the shortcut key

A mod cannot add a key action of its own. Instead, the **◧ clean view** button borrows a
built-in action, `app:cycleDiffBase`, which Claude Code uses only while its diff panel is
open. Any key you bind to that action shows or hides the panel.

1. Open `~/.claude/keybindings.json` in a text editor. If the file does not exist,
   create it.
2. Bind your key to `app:cycleDiffBase` in the `Global` context. For `ctrl+x c` (press
   ctrl+x, then c), a new file looks like this:

   ```json
   {
     "$schema": "https://www.schemastore.org/claude-code-keybindings.json",
     "$docs": "https://code.claude.com/docs/en/keybindings",
     "bindings": [
       {
         "context": "Global",
         "bindings": {
           "ctrl+x c": "app:cycleDiffBase"
         }
       }
     ]
   }
   ```

   If you already have the file, add only the `Global` entry to its `bindings` list.
3. Save the file. If the key does nothing yet, restart Claude Code.

Pick a key that Claude Code does not already use (see the
[keybindings docs](https://code.claude.com/docs/en/keybindings)). While the diff panel is
open, the key does its usual job there instead.

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
