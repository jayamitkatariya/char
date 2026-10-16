import type { Metadata, Viewport } from "next";
import { fontVariables } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "char", template: "%s · char" },
  description: "The AI notepad that gets things done.",
};

export const viewport: Viewport = {
  themeColor: "#fdfcfa",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <body>
        {children}
      </body>
    </html>
  );
}
