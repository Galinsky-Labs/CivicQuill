// Bundles the CivicQuill browser application (engine pages + civic pages).
import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const engineRoot = dirname(createRequire(import.meta.url).resolve("@distributed-governance/engine/package.json"));
await mkdir("dist", { recursive: true });
await build({
  entryPoints: { app: "web/main.jsx" }, bundle: true, format: "esm", platform: "browser", target: ["es2022"],
  outdir: "dist", minify: true, legalComments: "eof", sourcemap: true,
  define: { "process.env.NODE_ENV": '"production"' },
  // The engine's React/ProseMirror copies must be the only ones in the bundle.
  nodePaths: [join(engineRoot, "node_modules")],
});
await copyFile(join(engineRoot, "web/index.html"), "dist/index.html");
console.log("Built CivicQuill browser application.");
