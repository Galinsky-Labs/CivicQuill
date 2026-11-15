// Applies engine migrations, then CivicQuill's, with the separate migration
// credential. Runtime role grants remain an administrator action.
import { databasePool } from "@distributed-governance/engine/runtime";
import { applyIdentityMigrations, pgTransactions } from "@distributed-governance/engine/identity";
import { applyExtensionMigrations } from "@distributed-governance/engine/platform";
import { civicExtension } from "../server/civic-extension.mjs";

let pool;
try {
  if (!process.env.MIGRATION_DATABASE_URL) throw Error("Migration credential required");
  pool = databasePool(process.env.MIGRATION_DATABASE_URL, { max: 1 });
  await applyIdentityMigrations(pgTransactions(pool));
  const { applied } = await applyExtensionMigrations(pgTransactions(pool), civicExtension);
  console.log("Engine and CivicQuill migrations verified/applied (" + applied + " new civic migrations).");
} catch {
  console.error("Migration failed; the transaction was rolled back. No credential details were logged.");
  process.exitCode = 1;
} finally {
  await pool?.end();
}
