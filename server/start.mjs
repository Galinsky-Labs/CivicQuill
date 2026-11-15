// CivicQuill production entry: the shared engine runtime plus the civic
// extension. With MIGRATION_DATABASE_URL set, the release step migrates and
// provisions the least-privileged runtime login before serving.
import { releaseAndRun } from "@distributed-governance/engine/release";
import { civicExtension } from "./civic-extension.mjs";

await releaseAndRun({
  extensions: [civicExtension],
  env: { ...process.env, QUILL_PRODUCT: "civic" },
  assetDirectory: new URL("../dist/", import.meta.url),
});
