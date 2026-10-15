import { Instrument_Serif, Nanum_Pen_Script, Patrick_Hand } from "next/font/google";

// Inter / Source Serif 4 / JetBrains Mono / Caveat (--font-sans/-serif/-mono/-hand)
// already come from the root layout. These extra faces are landing-only, scoped
// to the `.landing` wrapper in page.tsx so the notes app never loads them.
export const quote = Instrument_Serif({
  subsets: ["latin"],
  variable: "--font-quote",
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
});
export const hand2 = Patrick_Hand({ subsets: ["latin"], variable: "--font-hand2", weight: "400", display: "swap" });
export const scrawl = Nanum_Pen_Script({ subsets: ["latin"], variable: "--font-scrawl", weight: "400", display: "swap" });

export const landingFontVariables = [quote, hand2, scrawl].map((f) => f.variable).join(" ");
