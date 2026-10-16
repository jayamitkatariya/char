#!/usr/bin/env node
// `char`: your notes from the command line, for you and for agents (Claude Code, Codex…).
//
// Reading (list, show, search, tasks…) comes straight from workspace.json, so it works whether or
// not char is open. Every change goes to the running app over a private socket (see main.js), so
// the app stays the only writer and what you see updates live; if char isn't running, it's opened
// in the background first. Markdown you write becomes real blocks (headings, lists, to-dos).

const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { dataDir, socketPath } = require("./cliSocket");

const HELP = `char — your char notes from the command line

Reading (works even when char is closed):
  char list [--folder F] [--pinned]     notes, newest first
  char tree                             folders, and the pages inside pages
  char show NOTE                        a note as Markdown
  char search TEXT                      notes whose title or text match
  char tasks [--all]                    open to-dos across notes (--all: done too)
  char trash                            what's in the Trash
  char folders                          every folder with its path

Writing (goes through the app, which updates live):
  char new TITLE [--folder F | --in NOTE] [--icon 🚀] [BODY | --stdin]
  char append NOTE (TEXT | --stdin)     add Markdown at the end
  char prepend NOTE (TEXT | --stdin)    add Markdown at the start
  char replace NOTE (TEXT | --stdin)    replace the whole body (--empty clears it)
  char rename NOTE TITLE
  char move NOTE (--folder F | --in NOTE)
  char pin NOTE | char unpin NOTE
  char icon NOTE EMOJI | char icon NOTE --none
  char check NOTE TASK | char uncheck NOTE TASK     TASK: part of the to-do's text
  char delete NOTE                      to the Trash (with its subpages)
  char restore NOTE                     back from the Trash
  char mkdir NAME [--in FOLDER]
  char open NOTE                        show it in char

NOTE is an id, a title, a path ("Work/Weekly sync") or a unique part of a title.
FOLDER is an id, a name or a path ("Work/Projects").
Add --json to any command for machine-readable output. Markdown: "- [ ] x" makes a to-do.
`;

/* ---------- arguments ---------- */

const BOOL = new Set(["json", "stdin", "pinned", "all", "none", "help", "empty"]);

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      pos.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const key = (eq > 0 ? a.slice(2, eq) : a.slice(2)).toLowerCase();
      if (eq > 0) flags[key] = a.slice(eq + 1);
      else if (BOOL.has(key)) flags[key] = true;
      else {
        if (i + 1 >= argv.length) fail(`--${key} needs a value`, 2);
        flags[key] = argv[++i];
      }
    } else if (a === "-h") flags.help = true;
    else pos.push(a);
  }
  return { pos, flags };
}

/* ---------- output ---------- */

class CliError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}
function fail(message, code = 1) {
  throw new CliError(message, code);
}

let asJson = false;
const out = (text, json) => process.stdout.write(asJson ? JSON.stringify(json, null, 2) + "\n" : text.endsWith("\n") ? text : text + "\n");

/* ---------- reading the notes ---------- */

function load() {
  const file = path.join(dataDir(), "workspace.json");
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") fail(`No notes yet at ${file}. Open char once first.`);
    fail(`Couldn't read ${file}: ${e.message}`);
  }
  const folders = (data.folders || []).map((f) => ({ id: f.id, name: f.name || "Untitled folder", parentId: f.parentId || null }));
  const all = (data.notes || []).map((n) => ({ ...n, title: n.title || "", content: n.content || "", parentId: n.parentId || null }));
  const notes = all.filter((n) => !n.deletedAt);
  const trash = all.filter((n) => n.deletedAt);
  const folderById = new Map(folders.map((f) => [f.id, f]));
  const noteById = new Map(notes.map((n) => [n.id, n]));

  const folderPath = (id) => {
    const names = [];
    for (let f = folderById.get(id), i = 0; f && i < 64; f = folderById.get(f.parentId), i++) names.unshift(f.name);
    return names.join("/") || "Notes";
  };
  const pagesAbove = (n) => {
    const chain = [];
    for (let p = noteById.get(n.parentId), i = 0; p && i < 64 && p.id !== n.id; p = noteById.get(p.parentId), i++) chain.unshift(p);
    return chain;
  };
  const title = (n) => n.title.trim() || "Untitled";
  const notePath = (n) => [folderPath(n.folderId), ...pagesAbove(n).map(title)].join("/");
  return { folders, notes, trash, folderById, noteById, folderPath, notePath, title };
}

/** One note or folder from what the user typed: an id, a full path, a title, or a unique part of one. */
function pick(kind, ref, items, label, fullPath) {
  const r = String(ref ?? "").trim();
  if (!r) fail(`Which ${kind}?`, 2);
  const byId = items.find((x) => x.id === r);
  if (byId) return byId;
  const lower = r.toLowerCase().replace(/^\/+|\/+$/g, "");
  const tries = [
    (x) => fullPath(x).toLowerCase() === lower,
    (x) => label(x).toLowerCase() === lower,
    (x) => label(x).toLowerCase().includes(lower),
  ];
  for (const t of tries) {
    const hits = items.filter(t);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) {
      const list = hits.slice(0, 10).map((x) => `  ${x.id}  ${label(x)}  (${fullPath(x)})`).join("\n");
      fail(`“${r}” matches ${hits.length} ${kind}s; use an id or a path:\n${list}`);
    }
  }
  fail(`No ${kind} matches “${r}”.`);
}

// A note's full path ends with its own title: "Work/Weekly sync/Agenda".
const pickNoteStrict = (ws, ref, list) =>
  pick("note", ref, list, ws.title, (n) => `${n.deletedAt ? ws.folderPath(n.folderId) : ws.notePath(n)}/${ws.title(n)}`);
const pickFolder = (ws, ref) =>
  pick(
    "folder",
    ref,
    ws.folders,
    (f) => f.name,
    (f) => ws.folderPath(f.id),
  );

const summary = (ws, n) => ({
  id: n.id,
  title: ws.title(n),
  path: ws.notePath(n),
  folderId: n.folderId,
  parentId: n.parentId,
  icon: n.icon || null,
  pinned: !!n.pinned,
  createdAt: n.createdAt,
  updatedAt: n.updatedAt,
});

const ago = (iso) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (!isFinite(s)) return "";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`;
  return iso.slice(0, 10);
};

function tasksOf(n) {
  const outList = [];
  let blocks = null;
  try {
    blocks = n.blocks ? JSON.parse(n.blocks) : null;
  } catch {}
  const text = (list) =>
    (list || [])
      .map((i) => (i.type === "text" ? i.text || "" : i.type === "link" ? text(i.content) : i.type === "noteLink" ? (i.props && i.props.title) || "" : ""))
      .join("");
  if (Array.isArray(blocks)) {
    const walk = (list) => {
      for (const b of list) {
        if (b.type === "checkListItem") {
          const t = Array.isArray(b.content) ? text(b.content).trim() : "";
          if (t) outList.push({ blockId: b.id || null, text: t, checked: !!(b.props && b.props.checked) });
        }
        if (b.children && b.children.length) walk(b.children);
      }
    };
    walk(blocks);
  } else {
    for (const m of n.content.matchAll(/^\s*[-*] \[( |x|X)\] (.+)$/gm)) outList.push({ blockId: null, text: m[2].trim(), checked: m[1] !== " " });
  }
  return outList;
}

/* ---------- talking to the app ---------- */

// Longer than the app's own limits (25 s to open a window + 30 s to answer), so the command never
// reports a failure for a change that then happens anyway.
function request(cmd, args, timeoutMs = 70000) {
  return new Promise((resolve, reject) => {
    const conn = net.createConnection(socketPath());
    let buf = "";
    const t = setTimeout(() => {
      conn.destroy();
      reject(new CliError("char didn't answer in time."));
    }, timeoutMs);
    conn.setEncoding("utf8");
    conn.on("connect", () => conn.write(JSON.stringify({ id: 1, cmd, args }) + "\n"));
    conn.on("data", (d) => {
      buf += d;
      const i = buf.indexOf("\n");
      if (i < 0) return;
      clearTimeout(t);
      conn.end();
      let res;
      try {
        res = JSON.parse(buf.slice(0, i));
      } catch {
        return reject(new CliError("char sent something unreadable."));
      }
      if (res.ok) resolve(res.result);
      else reject(new CliError(res.error || "char couldn't do that."));
    });
    conn.on("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function app(cmd, args) {
  try {
    return await request(cmd, args);
  } catch (e) {
    if (!["ENOENT", "ECONNREFUSED"].includes(e.code)) throw e;
  }
  // Not running: open it in the background and wait for it to listen.
  if (process.env.CHAR_DATA_DIR) fail("char isn't running for this CHAR_DATA_DIR; start it first.");
  try {
    execFileSync("open", ["-g", "-j", "-b", "com.jaykatariya.char"], { stdio: "ignore" });
  } catch {
    fail("char isn't running and couldn't be opened. Is it in /Applications?");
  }
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try {
      await request("ping", {}, 3000);
      return await request(cmd, args);
    } catch (e) {
      if (!["ENOENT", "ECONNREFUSED"].includes(e.code)) throw e;
    }
  }
  fail("char didn't start in time.");
}

// Streamed, not readFileSync(0): that throws EAGAIN on the non-blocking pipes agents often use.
async function readStdin() {
  if (process.stdin.isTTY) fail("--stdin needs text piped in, e.g. char append NOTE --stdin < notes.md", 2);
  let text = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

const bodyFrom = async (flags, rest) => {
  if (flags.stdin || (rest.length === 1 && rest[0] === "-")) return readStdin();
  if (flags.body !== undefined) return String(flags.body);
  return rest.join(" ");
};

/* ---------- commands ---------- */

async function main(argv) {
  const { pos, flags } = parseArgs(argv);
  asJson = !!flags.json;
  const [cmd, ...rest] = pos;
  if (!cmd || cmd === "help" || flags.help) return out(HELP, { help: HELP });

  const ws = load();

  switch (cmd) {
    case "list":
    case "ls": {
      let list = [...ws.notes];
      if (flags.folder) {
        const f = pickFolder(ws, flags.folder);
        list = list.filter((n) => n.folderId === f.id);
      }
      if (flags.pinned) list = list.filter((n) => n.pinned);
      list.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      return out(
        list.length ? list.map((n) => `${n.id}  ${n.icon ? n.icon + " " : ""}${ws.title(n)}  ·  ${ws.notePath(n)}  ·  ${ago(n.updatedAt)}`).join("\n") : "No notes.",
        list.map((n) => summary(ws, n)),
      );
    }

    case "folders":
      return out(
        ws.folders.map((f) => `${f.id}  ${ws.folderPath(f.id)}  (${ws.notes.filter((n) => n.folderId === f.id).length})`).join("\n") || "No folders.",
        ws.folders.map((f) => ({ id: f.id, name: f.name, path: ws.folderPath(f.id), parentId: f.parentId, notes: ws.notes.filter((n) => n.folderId === f.id).length })),
      );

    case "tree": {
      const lines = [];
      const node = (n, depth) => {
        lines.push(`${"  ".repeat(depth)}${n.icon || "·"} ${ws.title(n)}  [${n.id}]`);
        ws.notes.filter((k) => k.parentId === n.id).forEach((k) => node(k, depth + 1));
      };
      const folder = (f, depth) => {
        lines.push(`${"  ".repeat(depth)}▸ ${f.name}/  [${f.id}]`);
        ws.folders.filter((k) => k.parentId === f.id).sort((a, b) => a.name.localeCompare(b.name)).forEach((k) => folder(k, depth + 1));
        ws.notes.filter((n) => n.folderId === f.id && (!n.parentId || !ws.noteById.has(n.parentId))).forEach((n) => node(n, depth + 1));
      };
      ws.folders.filter((f) => !f.parentId || !ws.folderById.has(f.parentId)).sort((a, b) => a.name.localeCompare(b.name)).forEach((f) => folder(f, 0));
      const treeJson = (pid) => ws.notes.filter((n) => n.parentId === pid).map((n) => ({ ...summary(ws, n), pages: treeJson(n.id) }));
      const folderJson = (f) => ({
        id: f.id,
        name: f.name,
        folders: ws.folders.filter((k) => k.parentId === f.id).map(folderJson),
        pages: ws.notes.filter((n) => n.folderId === f.id && (!n.parentId || !ws.noteById.has(n.parentId))).map((n) => ({ ...summary(ws, n), pages: treeJson(n.id) })),
      });
      return out(lines.join("\n") || "Empty.", ws.folders.filter((f) => !f.parentId || !ws.folderById.has(f.parentId)).map(folderJson));
    }

    case "show":
    case "cat":
    case "read": {
      const n = pickNoteStrict(ws, rest.join(" "), ws.notes);
      const subpages = ws.notes.filter((k) => k.parentId === n.id).map((k) => ({ id: k.id, title: ws.title(k) }));
      const backlinks = ws.notes.filter((k) => k.id !== n.id && (k.links || []).includes(n.id)).map((k) => ({ id: k.id, title: ws.title(k) }));
      return out(`# ${n.icon ? n.icon + " " : ""}${ws.title(n)}\n\n${n.content.trim()}\n`, { ...summary(ws, n), content: n.content, links: n.links || [], subpages, backlinks, tasks: tasksOf(n) });
    }

    case "search":
    case "find": {
      const q = rest.join(" ").trim().toLowerCase();
      if (!q) fail("Search for what?", 2);
      const hits = ws.notes
        .map((n) => {
          const t = ws.title(n).toLowerCase();
          const c = n.content.toLowerCase();
          const score = t === q ? 4 : t.startsWith(q) ? 3 : t.includes(q) ? 2 : c.includes(q) ? 1 : 0;
          const at = c.indexOf(q);
          const snippet = at >= 0 ? n.content.slice(Math.max(0, at - 40), at + q.length + 60).replace(/\s+/g, " ").trim() : "";
          return { n, score, snippet };
        })
        .filter((h) => h.score)
        .sort((a, b) => b.score - a.score || String(b.n.updatedAt).localeCompare(String(a.n.updatedAt)));
      return out(
        hits.length ? hits.map((h) => `${h.n.id}  ${ws.title(h.n)}  ·  ${ws.notePath(h.n)}${h.snippet ? `\n    …${h.snippet}…` : ""}`).join("\n") : "No matches.",
        hits.map((h) => ({ ...summary(ws, h.n), snippet: h.snippet })),
      );
    }

    case "tasks":
    case "todo": {
      const groups = [...ws.notes]
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        .map((n) => ({ n, tasks: tasksOf(n).filter((t) => flags.all || !t.checked) }))
        .filter((g) => g.tasks.length);
      return out(
        groups.length ? groups.map((g) => `${ws.title(g.n)}  [${g.n.id}]\n${g.tasks.map((t) => `  [${t.checked ? "x" : " "}] ${t.text}`).join("\n")}`).join("\n\n") : "No open to-dos.",
        groups.flatMap((g) => g.tasks.map((t) => ({ noteId: g.n.id, note: ws.title(g.n), ...t }))),
      );
    }

    case "trash": {
      // Subpages that went with their page are listed under it, as in the app.
      const roots = ws.trash.filter((n) => !ws.trash.some((p) => p.id === n.parentId && p.deletedAt === n.deletedAt));
      const inside = (id) => ws.trash.filter((n) => n.parentId === id).reduce((k, n) => k + 1 + inside(n.id), 0);
      return out(
        roots.length
          ? roots.map((n) => `${n.id}  ${ws.title(n)}  ·  deleted ${ago(n.deletedAt)}${inside(n.id) ? `  ·  ${inside(n.id)} page${inside(n.id) === 1 ? "" : "s"} inside` : ""}`).join("\n")
          : "The Trash is empty.",
        roots.map((n) => ({ id: n.id, title: ws.title(n), deletedAt: n.deletedAt, folderId: n.folderId, pagesInside: inside(n.id) })),
      );
    }

    /* ----- changes, through the app ----- */

    case "new":
    case "create": {
      const [title, ...bodyWords] = rest;
      const args = { title: title || "", markdown: await bodyFrom(flags, bodyWords), icon: flags.icon || "" };
      if (!args.title.trim() && !args.markdown.trim()) fail("Give the note a title (and optionally a body).", 2);
      if (flags.in) args.parentId = pickNoteStrict(ws, flags.in, ws.notes).id;
      else if (flags.folder) args.folderId = pickFolder(ws, flags.folder).id;
      const r = await app("create", args);
      return out(r.id, r);
    }

    case "append":
    case "prepend":
    case "replace":
    case "write": {
      const [ref, ...words] = rest;
      const n = pickNoteStrict(ws, ref, ws.notes);
      const markdown = await bodyFrom(flags, words);
      // An empty replace would wipe the note with no way back, so it has to be asked for.
      if (!markdown.trim() && !(cmd === "replace" && flags.empty)) fail(cmd === "replace" ? "Nothing to replace it with. Pass text or --stdin (or --empty to clear the note)." : "Nothing to add. Pass text or --stdin.", 2);
      const mode = cmd === "write" ? "append" : cmd;
      await app("write", { id: n.id, markdown, mode });
      return out(`${mode === "replace" ? "Replaced" : mode === "prepend" ? "Added to the top of" : "Added to"} “${ws.title(n)}”`, { id: n.id, mode });
    }

    case "rename": {
      const [ref, ...words] = rest;
      const n = pickNoteStrict(ws, ref, ws.notes);
      const title = words.join(" ").trim();
      if (!title) fail("Rename to what?", 2);
      await app("rename", { id: n.id, title });
      return out(`Renamed to “${title}”`, { id: n.id, title });
    }

    case "move":
    case "mv": {
      const n = pickNoteStrict(ws, rest.join(" "), ws.notes);
      if (flags.in) {
        const p = pickNoteStrict(ws, flags.in, ws.notes);
        await app("move", { id: n.id, parentId: p.id });
        return out(`Moved into “${ws.title(p)}”`, { id: n.id, parentId: p.id });
      }
      if (!flags.folder) fail("Move where? --folder F or --in NOTE", 2);
      const f = pickFolder(ws, flags.folder);
      await app("move", { id: n.id, folderId: f.id });
      return out(`Moved to ${ws.folderPath(f.id)}`, { id: n.id, folderId: f.id });
    }

    case "pin":
    case "unpin": {
      const n = pickNoteStrict(ws, rest.join(" "), ws.notes);
      await app("pin", { id: n.id, pinned: cmd === "pin" });
      return out(`${cmd === "pin" ? "Pinned" : "Unpinned"} “${ws.title(n)}”`, { id: n.id, pinned: cmd === "pin" });
    }

    case "icon": {
      const [ref, emoji] = rest;
      const n = pickNoteStrict(ws, ref, ws.notes);
      if (!flags.none && !emoji) fail("Which emoji? Or --none to remove it.", 2);
      await app("icon", { id: n.id, icon: flags.none ? "" : emoji });
      return out(flags.none ? "Icon removed" : `Icon set to ${emoji}`, { id: n.id, icon: flags.none ? null : emoji });
    }

    case "check":
    case "uncheck":
    case "done":
    case "undone": {
      const [ref, ...words] = rest;
      const n = pickNoteStrict(ws, ref, ws.notes);
      const want = words.join(" ").trim().toLowerCase();
      if (!want) fail("Which to-do? Give part of its text.", 2);
      const tasks = tasksOf(n);
      const hits = tasks.filter((t) => t.text.toLowerCase() === want).length ? tasks.filter((t) => t.text.toLowerCase() === want) : tasks.filter((t) => t.text.toLowerCase().includes(want));
      if (!hits.length) fail(`No to-do in “${ws.title(n)}” matches “${want}”.`);
      if (hits.length > 1) fail(`“${want}” matches ${hits.length} to-dos in “${ws.title(n)}”:\n${hits.map((t) => `  [${t.checked ? "x" : " "}] ${t.text}`).join("\n")}`);
      if (!hits[0].blockId) fail("That note hasn't been opened in char since it was imported; open it once, then try again.");
      const checked = cmd === "check" || cmd === "done";
      await app("task", { id: n.id, blockId: hits[0].blockId, checked });
      return out(`${checked ? "Checked" : "Unchecked"}: ${hits[0].text}`, { id: n.id, text: hits[0].text, checked });
    }

    case "delete":
    case "rm": {
      const n = pickNoteStrict(ws, rest.join(" "), ws.notes);
      const r = await app("trash", { id: n.id });
      return out(`Moved “${ws.title(n)}” to the Trash${r.inside ? ` with ${r.inside} page${r.inside === 1 ? "" : "s"} inside` : ""}. Undo with: char restore ${n.id}`, { id: n.id, inside: r.inside });
    }

    case "restore": {
      const n = pickNoteStrict(ws, rest.join(" "), ws.trash);
      await app("restore", { id: n.id });
      return out(`Restored “${ws.title(n)}”`, { id: n.id });
    }

    case "mkdir": {
      const name = rest.join(" ").trim();
      if (!name) fail("Name the folder.", 2);
      const parentId = flags.in ? pickFolder(ws, flags.in).id : null;
      const r = await app("mkdir", { name, parentId });
      return out(r.id, { id: r.id, name, parentId });
    }

    case "open": {
      const n = pickNoteStrict(ws, rest.join(" "), ws.notes);
      await app("open", { id: n.id });
      return out(`Opened “${ws.title(n)}”`, { id: n.id });
    }

    default:
      fail(`Unknown command “${cmd}”. Run: char help`, 2);
  }
}

main(process.argv.slice(2)).catch((e) => {
  const code = e instanceof CliError ? e.code : 1;
  const message = e instanceof CliError ? e.message : `char: ${e.message}`;
  if (asJson) process.stdout.write(JSON.stringify({ error: message }) + "\n");
  else process.stderr.write(message.startsWith("char") ? message + "\n" : `char: ${message}\n`);
  process.exitCode = code;
});
