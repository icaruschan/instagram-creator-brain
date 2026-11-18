import { defineConfig } from "@trigger.dev/sdk/v3";
import { additionalFiles, additionalPackages, ffmpeg } from "@trigger.dev/build/extensions/core";

export default defineConfig({
  project: "proj_xsktxkyadeapydcirmck",
  runtime: "node-24",
  logLevel: "log",
  maxDuration: 14_400,
  retries: {
    enabledInDev: true,
    default: { maxAttempts: 3, minTimeoutInMs: 1_000, maxTimeoutInMs: 10_000, factor: 2, randomize: true },
  },
  dirs: ["./src/trigger"],
  build: {
    external: ["proxy-agent"],
    extensions: [
      additionalFiles({ files: ["./src/data/scriptwriter-v2.3.md"] }),
      additionalPackages({ packages: ["proxy-agent"] }),
      // Fit check shrinks Reel videos to 480p before sending them to Gemini Decision 1 (2026-11-18).
      ffmpeg(),
    ],
  },
});
