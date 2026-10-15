# {char}

An AI notepad that gets things done, as a local-first, open-source **macOS app**. You get a Notion-style editor, folders, and links between notes, plus an optional chatbot that reads all your notes using your own API key.

There is no account and no server. Your notes are one JSON file on your Mac.

## Download

Grab the latest `.dmg` from [Releases](https://github.com/jayamitkatariya/char/releases), open it, and drag **char** to Applications.

The build is ad-hoc signed, not notarized. The first time you open it, right-click **char** → **Open**, or run:

```bash
xattr -dr com.apple.quarantine /Applications/char.app
```

## What's inside

- **Editor**: BlockNote. Type `/` for headings, checklists, tables, quotes, and code. Type `@` to link a note or folder, or to create a new note and link it. Notes that link here show up under *Linked from*.
- **Folders**: nested folders in a sidebar tree. Drag notes or folders onto a folder to move them. Double-click a folder to rename it.
- **Shortcuts**: `⌘K` search and commands, `⌘N` new note, `⌘J` Ask char, `⌘\` toggle the sidebar.
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

This writes `dist/char-<version>-arm64.dmg` and a `.zip`. Upload them to a GitHub Release. The icon is `build/icon.png`; to regenerate it, run `npx electron scripts/make-icon.js`.

## Homepage

`/` is the marketing page. Its buttons link to this repo (`src/lib/site.ts`). `npm run build` exports only the homepage into `out/`, and Vercel deploys it with:

```bash
vercel --prod
```

The two builds share one codebase. Files named `*.web.tsx` belong to the homepage and `*.app.tsx` to the Mac app, and `CHAR_TARGET=app` selects the app build (`next.config.ts`).

## License

MIT
