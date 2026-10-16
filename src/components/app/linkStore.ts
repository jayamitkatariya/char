"use client";

import { useSyncExternalStore } from "react";

// Inline @-links render inside the editor's node views, outside the app's React context.
// This tiny store hands them live titles and a way to navigate.

export type LinkKind = "note" | "folder";

type State = {
  titles: Map<string, string>; // id → current title or folder name
  icons?: Map<string, string>; // note id → its emoji, if it has one
  open: (kind: LinkKind, id: string) => void;
};

let state: State = { titles: new Map(), open: () => {} };
const listeners = new Set<() => void>();

export function setLinkState(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

export const openLink = (kind: LinkKind, id: string) => state.open(kind, id);

/** The current title, for exports written outside React (markdown, the AI's copy). */
export const linkTitle = (id: string) => state.titles.get(id);

export function useLinkIcon(id: string): string | undefined {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state.icons?.get(id),
    () => undefined,
  );
}

export function useLinkTitle(id: string): string | undefined {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state.titles.get(id),
    () => undefined,
  );
}

/** Every note/folder id referenced by an @-link or a /page block anywhere in a BlockNote document. */
export function collectLinks(doc: unknown): string[] {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      const o = v as { type?: string; props?: { id?: string; pageId?: string } };
      if (o.type === "noteLink" && o.props?.id) out.add(o.props.id);
      if (o.type === "subpage" && o.props?.pageId) out.add(o.props.pageId);
      Object.values(o).forEach(walk);
    }
  };
  walk(doc);
  return [...out];
}
