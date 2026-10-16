import type { Metadata } from "next";
import { THEME_BOOT } from "@/lib/themeBoot";

export const metadata: Metadata = { title: "Notes" };

export default function NotesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      {children}
    </>
  );
}
