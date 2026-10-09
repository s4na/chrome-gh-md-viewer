import { cp, mkdir, rm } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("extension", "dist", { recursive: true });
await build({
  entryPoints: ["src/content.ts"],
  bundle: true,
  outdir: "dist",
  format: "iife",
  platform: "browser",
  target: "chrome123",
  loader: { ".css": "text" },
  legalComments: "eof",
});
