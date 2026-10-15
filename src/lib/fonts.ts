import { Caveat, Inter, JetBrains_Mono, Source_Serif_4 } from "next/font/google";

// The same type families as the homepage, so the app reads as one product.
export const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
export const serif = Source_Serif_4({ subsets: ["latin"], variable: "--font-serif", display: "swap" });
export const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });
export const hand = Caveat({ subsets: ["latin"], variable: "--font-hand", display: "swap" });

export const fontVariables = [sans.variable, serif.variable, mono.variable, hand.variable].join(" ");
