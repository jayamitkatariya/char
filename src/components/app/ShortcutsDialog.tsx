"use client";

import { useEffect } from "react";
import { IconX } from "../icons";

const GROUPS: [string, [string, string][]][] = [
  [
    "Get around",
    [
      ["⌘K", "Search notes, folders and commands"],
      ["⌘⇧H", "Today"],
      ["⌘[  ⌘]", "Back and forward"],
      ["⌘\\", "Show or hide the sidebar"],
      ["⌘F", "Find in this note"],
      ["⌘,", "Settings"],
      ["⌘/", "These shortcuts"],
    ],
  ],
  [
    "Write",
    [
      ["⌘N", "New note"],
      ["/", "Blocks: headings, lists, tables, code…"],
      ["/page", "A new page inside this one"],
      ["@", "Link a note or folder"],
      ["[]  todo:", "Start a checkbox"],
      ["⌘⇧T", "Tidy loose lines into to-dos and bullets"],
      ["⌘⇧P", "Pin or unpin this note"],
      ["⌘Z", "Undo"],
    ],
  ],
  [
    "AI",
    [
      ["⌘J", "Ask char about your notes"],
      ["@charlie", "Hand a task to your coding agent, then ↵"],
    ],
  ],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="scrim fixed inset-0 z-50 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="card pop-in max-h-[88dvh] w-full max-w-[520px] overflow-y-auto !rounded-3xl p-6 !shadow-[var(--shadow-lg)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center">
          <h2 className="font-serif flex-1 text-[24px] font-semibold">Keyboard shortcuts</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <IconX size={16} />
          </button>
        </div>
        {GROUPS.map(([title, rows]) => (
          <section key={title} className="mt-5">
            <h3 className="label mb-2">{title}</h3>
            <dl className="space-y-1.5">
              {rows.map(([k, what]) => (
                <div key={k} className="flex items-center gap-3 text-[13.5px]">
                  <dt className="w-[96px] shrink-0">
                    <span className="kbd whitespace-pre">{k}</span>
                  </dt>
                  <dd className="text-[var(--ink-soft)]">{what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}
