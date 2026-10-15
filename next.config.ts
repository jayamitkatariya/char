import type { NextConfig } from "next";

// One codebase, two static builds: the homepage (`page.web.tsx`, deployed to Vercel) and the
// notepad (`*.app.tsx`, bundled into the Mac app). CHAR_TARGET=app selects the app build.
const target = process.env.CHAR_TARGET === "app" ? "app" : "web";

const nextConfig: NextConfig = {
  pageExtensions: [`${target}.tsx`, "tsx", "ts"],
  // Static export: the Mac app serves out/ itself (electron/main.js); the homepage deploys as plain files.
  output: "export",
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
