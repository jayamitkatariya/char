"use client";

import { useSyncExternalStore } from "react";
import { savedTheme, setNativeTheme, type ThemeMode } from "./desktop";

// Light, Dark, or following macOS. The choice is saved by the Mac app (so the window opens in the
// right colours) and cached in localStorage for the first paint; <html data-theme> drives the CSS.

export type { ThemeMode };

import { THEME_KEY as KEY } from "./themeBoot";
const listeners = new Set<() => void>();
let mode: ThemeMode = "system";
let started = false;

const dark = () => window.matchMedia("(prefers-color-scheme: dark)");
const resolve = (m: ThemeMode) => (m === "system" ? (dark().matches ? "dark" : "light") : m);

function paint() {
  document.documentElement.dataset.theme = resolve(mode);
  listeners.forEach((l) => l());
}

export function startTheme() {
  if (started) return;
  started = true;
  let cached: string | null = null;
  try {
    cached = localStorage.getItem(KEY);
  } catch {}
  mode = savedTheme() ?? (cached === "light" || cached === "dark" ? cached : "system");
  // With System, a macOS switch (or nativeTheme catching up after a change) repaints.
  dark().addEventListener("change", paint);
  paint();
}

export function setThemeMode(next: ThemeMode) {
  mode = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {}
  void setNativeTheme(next);
  paint();
}

export const themeMode = () => mode;

/** The chosen mode and what it resolves to right now. */
export function useTheme(): { mode: ThemeMode; resolved: "light" | "dark" } {
  const resolved = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => resolve(mode),
    () => "light" as const,
  );
  return { mode, resolved };
}
