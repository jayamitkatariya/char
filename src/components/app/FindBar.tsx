"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconSearch, IconX } from "../icons";

// ⌘F in a note. Matches are painted with the CSS Custom Highlight API, so the document itself is
// never touched (nothing to undo, nothing saved).

type Registry = { set: (name: string, h: unknown) => void; delete: (name: string) => void };
const registry = () => (globalThis.CSS as unknown as { highlights?: Registry }).highlights;
const Highlight = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;

function paint(ranges: Range[], current: number) {
  const reg = registry();
  if (!reg || !Highlight) return;
  reg.set("char-find", new Highlight(...ranges));
  if (ranges[current]) reg.set("char-find-current", new Highlight(ranges[current]));
  else reg.delete("char-find-current");
}

function clear() {
  registry()?.delete("char-find");
  registry()?.delete("char-find-current");
}

export function FindBar({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [count, setCount] = useState(0);
  const [at, setAt] = useState(0);
  const ranges = useRef<Range[]>([]);
  const input = useRef<HTMLInputElement>(null);

  const search = useCallback((q: string) => {
    const root = document.querySelector(".char-editor .bn-editor");
    const found: Range[] = [];
    const needle = q.toLowerCase();
    if (root && needle) {
      const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walk.nextNode(); node; node = walk.nextNode()) {
        const text = (node.nodeValue ?? "").toLowerCase();
        for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + needle.length)) {
          const r = document.createRange();
          r.setStart(node, i);
          r.setEnd(node, i + needle.length);
          found.push(r);
        }
      }
    }
    ranges.current = found;
    setCount(found.length);
    return found;
  }, []);

  const show = useCallback((i: number) => {
    const list = ranges.current;
    if (!list.length) return clear();
    const n = ((i % list.length) + list.length) % list.length;
    setAt(n);
    paint(list, n);
    list[n].startContainer.parentElement?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);

  // Typing in the note while the bar is open keeps the matches current.
  useEffect(() => {
    const root = document.querySelector(".char-editor .bn-editor");
    if (!root) return;
    let t: ReturnType<typeof setTimeout>;
    const mo = new MutationObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => {
        const found = search(input.current?.value ?? "");
        const n = Math.max(0, Math.min(at, found.length - 1));
        setAt(n);
        paint(found, n);
      }, 150);
    });
    mo.observe(root, { subtree: true, childList: true, characterData: true });
    return () => {
      clearTimeout(t);
      mo.disconnect();
    };
  }, [search, at]);

  useEffect(() => () => clear(), []);

  return (
    <div className="pop-in card fixed right-5 top-14 z-30 flex items-center gap-2 !rounded-xl py-1.5 pl-3 pr-1.5 shadow-[var(--shadow-lg)]" role="search">
      <IconSearch size={14} />
      <input
        ref={input}
        autoFocus
        className="field w-[200px] text-[13.5px]"
        placeholder="Find in note"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          search(e.target.value);
          show(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || (e.key.toLowerCase() === "g" && e.metaKey)) {
            e.preventDefault();
            show(at + (e.shiftKey ? -1 : 1));
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <span className="label w-[52px] text-right tabular-nums">{query ? (count ? `${at + 1}/${count}` : "none") : ""}</span>
      <button className="icon-btn !h-6 !w-6" onClick={() => show(at - 1)} disabled={!count} aria-label="Previous match" title="Previous (⇧↵)">
        ↑
      </button>
      <button className="icon-btn !h-6 !w-6" onClick={() => show(at + 1)} disabled={!count} aria-label="Next match" title="Next (↵)">
        ↓
      </button>
      <button className="icon-btn !h-6 !w-6" onClick={onClose} aria-label="Close find" title="Close (esc)">
        <IconX size={13} />
      </button>
    </div>
  );
}
