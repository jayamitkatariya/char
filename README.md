# {char}

An AI notepad that gets things done, as a local-first, open-source **macOS app**. You get a Notion-style editor, folders, and links between notes, plus an optional chatbot that reads all your notes using your own API key.

There is no account and no server. Your notes are one JSON file on your Mac.

## Download

Download the latest release:

- **Apple Silicon** (M1 or later): [char-arm64.dmg](https://github.com/jayamitkatariya/char/releases/latest/download/char-arm64.dmg)
- **Intel**: [char-x64.dmg](https://github.com/jayamitkatariya/char/releases/latest/download/char-x64.dmg)

Open the `.dmg` and drag **char** to Applications. It needs macOS 12 or later.

char is signed with a Developer ID but not notarized, so the first time you open it, right-click **char** → **Open** → **Open**. If macOS still refuses, run:

```bash
xattr -dr com.apple.quarantine /Applications/char.app
```

## What's inside

- **Editor**: BlockNote. Type `/` for headings, checklists, tables, quotes, and code. Type `@` to link a note or folder, or to create a new note and link it. Notes that link here show up under *Linked from*.
- **Pages inside pages**: type `/page` to make a page inside the current one, Notion-style. It's left behind as a row you click to open. Subpages nest in the sidebar (hover a page's icon for its chevron), show in breadcrumbs, and move or go to the Trash with their parent. Drag a note onto a page, or use **Move to…**, to put it inside. Hover a title to give the page an emoji icon.
- **Sidebar**: Today, All notes, Tasks, Pinned, your 5 most recent notes, nested folders (counts include subfolders), and the Trash. Right-click a note (or hover and click `⋯`) to add a subpage, pin, duplicate, copy its link, move it or delete it; right-click a folder for new note, subfolder, rename and delete. Drag notes or folders onto a folder to move them, or use **Move to…** and type part of a folder's or page's name. Double-click a folder to rename it. A note you leave with no title and no text is cleaned up automatically.
- **Tasks**: every checklist item across your notes in one list, grouped by note. Tick them off right there; the note updates.
- **Trash**: deleting a note (with its subpages) or a folder's notes moves them to the Trash, with **Undo** on the toast. Restore or delete for good from the Trash; it empties itself after 30 days.
- **Dark mode**: Settings → Appearance, View → Appearance, the moon in the sidebar, or ⌘K. **Match System** follows macOS; the window, menus and editor change together.
- **Shortcuts**: `⌘K` search and commands (fuzzy, so `wlc` finds “Welcome to char”; opens on your recent and pinned notes), `⌘N` new note, `⌘F` find in note, `⌘J` Ask char, `⌘⇧T` tidy, `⌘⇧P` pin, `⌘⇧H` Today, `⌘\` toggle the sidebar, `⌘[` / `⌘]` back and forward (also the arrows in the top bar), `⌘,` settings, `⌘/` all shortcuts.
- **Command line (for agents)**: Settings → Agents → **Install the char command** puts `char` on your PATH, so Claude Code, Codex, scripts or you can work with your notes from a terminal. Reading (`char list`, `show`, `search`, `tasks`, `tree`, `trash`) comes straight from your notes file and works with char closed. Changes (`char new`, `append`, `prepend`, `replace`, `rename`, `move`, `pin`, `icon`, `check`, `delete`, `restore`, `mkdir`, `open`) go through the running app, so the window updates as they happen; if char isn't open, it starts in the background. Markdown you write becomes real blocks, and `- [ ] x` makes a to-do. Notes can be named by id, title, path (`Work/Weekly sync`) or a unique part of a title, and every command takes `--json`. Run `char help` for the rest. The command runs on char's own runtime, so it needs no Node install.
- **Links**: Copy link gives a `char://note/…` URL that opens the note in char from anywhere.
- **@charlie**: hand a task to a coding agent already on your Mac (Claude Code, Codex, OpenCode, Hermes, or any command). Type `@charlie` and the task, then press Enter. The chip can go anywhere on the line, and text before it is sent as context. charlie sends the agent the note, any notes the line @-links to, and the task. The agent runs in the working folder you pick, and note text is fenced off so the agent treats it as material, not instructions. While it works, a live card shows the agent's real steps (files read, commands run), the elapsed time and a Stop button. Deleting the card stops the run. The answer lands as normal, editable blocks, followed by a slim footer with **Steps** (the saved transcript) and **Follow up**, which continues the same agent session. Long answers get their own note, linked from where you asked. If you switch notes, the answer still lands in the right one. `⌘K` → "Ask charlie" works too.
- **Settings → Agents**:
  - Shows which agents are installed and signed in, with a button that opens the agent's sign-in in Terminal.
  - Picks each agent's default model from the agent's own list (including Hermes' providers), and the working folder.
  - Sets the access level: **Read only**, **Can edit files** or **Full access**. An agent that can't enforce a level doesn't offer it; Hermes approves its own actions, so it always runs with full access.
  - **Connectors** shows what the agent can reach (its MCP servers), and asks the agent to set up GitHub, Google Calendar, Gmail, Notion, Linear, Slack, web search or anything you describe, after a native confirm.
- **Tidy**: write loosely, then press `⌘⇧T` (or the wand button, or `/tidy`). Lines that read like tasks ("need to call mom", "buy milk", "[x] book train") become checklists. Other short lines become bullets. "Groceries: eggs, bread and coffee" becomes a heading with items. Prose stays as it is, and `⌘Z` undoes the whole thing. Typing `todo:` and a space at the start of a line makes a checkbox, as does `[] `.
- **AI (optional, BYOK)**: Settings → AI model. Supports Anthropic, OpenAI, OpenRouter, Groq, Ollama, or any OpenAI-compatible base URL. The key stays on your Mac and is sent only to the provider you choose.
- **Data**: `~/Library/Application Support/char/workspace.json`. Every change is written to disk right away (atomically), and the file as it was at launch is kept as `workspace.json.bak`. Settings → Storage shows the file in Finder. Settings → Import & export reads and writes JSON, including old jknotes `notes.json` files and exports from the old web version.

## Develop

The UI is a Next.js static export (`out/`) that Electron serves over `app://char` (`electron/main.js`). The notepad lives at `/notes`. In a regular browser that route shows a download link, because the notepad needs the Mac app's file access (`electron/preload.js` → `src/lib/desktop.ts`).

Run the dev server and the app in two terminals:

```bash
npm run app:serve
```

```bash
npm run app:dev
```

(`app:serve` is the app build of the UI on port 3210; plain `npm run dev` serves only the homepage.)

To run the production build without packaging:

```bash
npm run app:start
```

Set `CHAR_DATA_DIR=/some/folder` on any of these to use a separate notes file instead of your real one.

## Package

```bash
npm run app:dist
```

This writes `dist/char-arm64.dmg`, `dist/char-x64.dmg` and matching `.zip` files, signed with the first Developer ID certificate in your keychain (`npm run app:dist:adhoc` builds without one). Attach them to a GitHub Release tagged `v<version>`. The app checks that repo's latest release on launch and offers the download when it's newer. The icon is `build/icon.png`; to regenerate it, run `npx electron scripts/make-icon.js`.

## Homepage

`/` is the marketing page. Its buttons link to this repo (`src/lib/site.ts`). `npm run build` exports only the homepage into `out/`, and Vercel deploys it with:

```bash
vercel --prod
```

The two builds share one codebase. Files named `*.web.tsx` belong to the homepage and `*.app.tsx` to the Mac app, and `CHAR_TARGET=app` selects the app build (`next.config.ts`).

## License

MIT
