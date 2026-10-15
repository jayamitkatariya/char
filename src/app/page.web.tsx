import type { Metadata } from "next";
import FinalCta from "@/components/landing/FinalCta";
import Footer from "@/components/landing/Footer";
import Hero from "@/components/landing/Hero";
import Manifesto from "@/components/landing/Manifesto";
import Minimap from "@/components/landing/Minimap";
import ReadingProgress from "@/components/landing/ReadingProgress";
import RevealObserver from "@/components/landing/RevealObserver";
import ScrollNav from "@/components/landing/ScrollNav";
import { landingFontVariables } from "@/components/landing/fonts";
import "./landing.css";

export const metadata: Metadata = {
  title: { absolute: "char — the AI notepad that gets things done" },
  description:
    "char is a notepad with a brain: Notion-style notes, a chat that knows everything you've written, and your own AI key. Write it down — char helps get it done.",
};

export default function HomePage() {
  return (
    <div className={`landing ${landingFontVariables}`}>
      <ReadingProgress />
      <ScrollNav />
      <main>
        <Hero />
        <Manifesto />
        <FinalCta />
      </main>
      <Footer />
      <Minimap />
      <RevealObserver />
    </div>
  );
}
