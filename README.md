# Legislation Collaboration

Thin application over the shared Document Collaboration Engine; do not duplicate editor, adoption, crypto or tally internals.

**Status: deployed at https://civicquill.onrender.com and verified with a live multi-user journey (16/16 checks, November 15, 2026). Owner review, independent security review and production acceptance are still pending.** Sign in with a passkey. Drafting uses a free weekly allowance; reading, discussing and voting are free. Email delivery, payments and federation are not configured in this deployment.

- [Architecture, product differences and editor features](docs/ARCHITECTURE.md)
- [Development plan](docs/DEVELOPMENT_PLAN.md) and [canonical PR registry](registry/prs.json)
- [Security and truthful claim boundaries](docs/SECURITY.md)
- [Operations and credential requirements](docs/OPERATIONS.md)
- [Repository agent instructions](AGENTS.md)

Requires Node 24.19.0 (tested). The engine is installed from an integrity-pinned commit tarball:

```sh
npm ci --ignore-scripts
npm run check
npm run build
```

Run with `npm start`. Configuration is documented in the engine's `.env.example` and `docs/PRODUCTION_RUNBOOK.md`. Set `MIGRATION_DATABASE_URL`, `RUNTIME_DATABASE_PASSWORD` and the keys there, and the release step migrates the database and serves as an unprivileged runtime login.

The consumer validator verifies and loads the bundled, read-only core release artifact. contracts/engine-provenance.json pins its exact source commit and SHA-256. No engine logic is forked. DGE_ENGINE_PATH can explicitly override the entry point for source development.

Actual PR mappings are recorded in registry/prs.json; bootstrap commits alone do not establish product acceptance. Follow the dependency-ready PR specifications to implement the full product. Human review is the final deployed handoff; actual failed technical gates remain blockers.
