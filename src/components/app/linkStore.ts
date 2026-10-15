"use client";

import { useSyncExternalStore } from "react";

// Inline @-links render inside the editor's node views, outside the app's React context.
// This tiny store hands them live titles and a way to navigate.

export type LinkKind = "note" | "folder";

type State = {
  titles: Map<string, string>; // id → current title or folder name
  open: (kind: LinkKind, id: string) => void;
};

let state: State = { titles: new Map(), open: () => {} };
const listeners = new Set<() => void>();

export function setLinkState(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

export const openLink = (kind: LinkKind, id: string) => state.open(kind, id);

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

/** Every note/folder id referenced by an @-link anywhere in a BlockNote document. */
export function collectLinks(doc: unknown): string[] {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      const o = v as { type?: string; props?: { id?: string } };
      if (o.type === "noteLink" && o.props?.id) out.add(o.props.id);
      Object.values(o).forEach(walk);
    }
  };
  walk(doc);
  return [...out];
}
