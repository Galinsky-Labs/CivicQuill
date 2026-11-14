// CivicQuill production entry: the shared engine runtime plus the civic extension.
import { runPlatform } from "@distributed-governance/engine/runtime";
import { civicExtension } from "./civic-extension.mjs";

await runPlatform({
  extensions: [civicExtension],
  env: { ...process.env, QUILL_PRODUCT: "civic" },
  assetDirectory: new URL("../dist/", import.meta.url),
});
