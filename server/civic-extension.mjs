// CivicQuill engine extension: legislative templates, official verification,
// participation trust tiers, public-input sponsor responses, consultation
// series, research collections, civic analytics and sponsor handoff
// packages. Tally, adoption, ledger and cryptography stay in the engine.
import { readFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { boundedJson, HttpError } from "@distributed-governance/engine/account-http";
import { JURISDICTIONS } from "../src/jurisdictions.mjs";
import { buildBill, TEMPLATE_PARTS } from "../src/templates.mjs";
import { validateOfficialRequest, officialGrant, officialStatus } from "../src/officials.mjs";
import { TRUST_TIERS, RESPONSE_KINDS, dispositionReport, participationSummary } from "../src/participation.mjs";
import { validateGroup, validateEvidence, formatCitation } from "../src/research.mjs";
import { CIVIC_SETTINGS_DEFAULTS, CIVIC_CATALOG } from "../src/catalog.mjs";

const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const HEX = /^[a-f0-9]{64}$/;
const migration = (name) => ({ name, sql: readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8") });
export const CIVIC_PAGES = Object.freeze(["/civic/new-bill", "/civic/officials", "/civic/consultations", "/civic/research", "/civic/participation", "/civic/handoff", "/civic/review"]);

class CivicError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
const need = (condition, code, status) => { if (!condition) throw new CivicError(code, status); };
const parse = (fn, code) => { try { return fn(); } catch { throw new CivicError(code); } };
const iso = (v) => (v ? new Date(v).toISOString() : null);
const day = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

export function createCivicService({ identity, transaction, documents, proposals, clock = Date.now, isPlatformAdmin = async () => false, grantOfficial = null }) {
  const now = () => new Date(clock());
  const asAccount = async (credentials, fn) => {
    const { accountId } = await identity.account(credentials.sessionToken);
    return transaction(async (db) => {
      await db.query("SELECT set_config('dge.account_id',$1,true)", [accountId]);
      return fn(db, accountId);
    });
  };
  const asReviewer = async (credentials, fn) => {
    const { accountId } = await identity.account(credentials.sessionToken);
    need(await isPlatformAdmin(credentials), "ACCESS_DENIED", 403);
    return transaction(async (db) => {
      await db.query("SELECT set_config('dge.worker','civic-review',true)");
      return fn(db, accountId);
    });
  };
  const publicDocument = (documentId, fn) => {
    need(UUID.test(documentId), "INVALID_DOCUMENT_ID");
    return transaction(async (db) => {
      await db.query("SELECT set_config('dge.public_document_id',$1,true)", [documentId]);
      need((await db.query("SELECT 1 FROM dge_documents.documents WHERE id=$1", [documentId])).rows.length, "DOCUMENT_NOT_FOUND", 404);
      return fn(db);
    });
  };
  const inWorkspace = (credentials, tenantId, roles, fn, write = true) => {
    need(UUID.test(tenantId), "INVALID_WORKSPACE");
    return identity.withTenant(credentials, tenantId, { write, roles }, fn);
  };
  const officialView = (r) => ({
    id: r.id, level: r.level, role: r.role, jurisdiction: r.jurisdiction, office: r.office, district: r.district,
    principalName: r.principal_name, termStart: day(r.term_start), termEnd: day(r.term_end), publicBadge: r.public_badge,
    status: officialStatus({ status: r.status, termEnd: day(r.term_end) }, clock()), reviewNote: r.review_note,
    createdAt: iso(r.created_at), reviewedAt: iso(r.reviewed_at),
  });

  async function allProposals(documentId) {
    const items = [];
    let after = null;
    do {
      const page = await proposals.list(documentId, { after, limit: 100 });
      items.push(...page.items);
      after = page.nextCursor;
    } while (after && items.length < 5000);
    return items;
  }

  return {
    async createBill(credentials, tenantId, body) {
      need(UUID.test(body.commandId ?? ""), "INVALID_COMMAND");
      need(JURISDICTIONS[body.jurisdictionId], "UNKNOWN_JURISDICTION");
      const documentId = randomUUID();
      const document = parse(() => buildBill({
        id: documentId, tenantId, jurisdictionId: body.jurisdictionId, title: body.title,
        parts: body.parts, values: body.values ?? {}, locale: body.locale ?? "en-US",
      }), "INVALID_TEMPLATE_INPUT");
      const saved = await documents.create(credentials, tenantId, { document, commandId: body.commandId, disclosure: "publish-all-revisions-v1" });
      const sponsor = body.sponsorDisplay ? String(body.sponsorDisplay).slice(0, 200) : null;
      await inWorkspace(credentials, tenantId, ["owner", "admin", "editor"], (db, actor) => db.query(
        `INSERT INTO app_civic.bill_profiles(tenant_id,document_id,jurisdiction_id,template_parts,sponsor_display,created_by,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [tenantId, saved.document.id, body.jurisdictionId, body.parts ?? [], sponsor, actor.accountId, now()]));
      return { ...saved, status: "community-draft", notice: "A community draft. It has not been introduced or filed with any legislature." };
    },
    billProfile: (documentId) => publicDocument(documentId, async (db) => {
      const row = (await db.query("SELECT jurisdiction_id,template_parts,sponsor_display,created_at FROM app_civic.bill_profiles WHERE document_id=$1", [documentId])).rows[0];
      need(row, "BILL_PROFILE_NOT_FOUND", 404);
      return { documentId, jurisdiction: JURISDICTIONS[row.jurisdiction_id], parts: row.template_parts, sponsorDisplay: row.sponsor_display, createdAt: iso(row.created_at), status: "community-draft" };
    }),

    requestOfficial: (credentials, body) => asAccount(credentials, async (db, accountId) => {
      const request = parse(() => validateOfficialRequest(body), "INVALID_OFFICIAL_REQUEST");
      const id = randomUUID();
      try {
        await db.query(
          `INSERT INTO app_civic.official_requests(id,account_id,level,role,jurisdiction,office,district,principal_name,term_start,term_end,evidence_url,public_badge,created_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [id, accountId, request.level, request.role, request.jurisdiction, request.office, request.district, request.principalName,
            request.termStart, request.termEnd, request.evidenceUrl, request.publicBadge, now()]);
      } catch (error) {
        if (error?.code === "23505") throw new CivicError("REQUEST_ALREADY_PENDING", 409);
        throw error;
      }
      return { id, status: "pending" };
    }),
    myOfficialRequests: (credentials) => asAccount(credentials, async (db, accountId) =>
      ({ items: (await db.query("SELECT * FROM app_civic.official_requests WHERE account_id=$1 ORDER BY created_at DESC LIMIT 20", [accountId])).rows.map(officialView) })),
    withdrawOfficial: (credentials, id) => asAccount(credentials, async (db, accountId) => {
      need(UUID.test(id), "INVALID_REQUEST");
      need((await db.query("UPDATE app_civic.official_requests SET status='withdrawn' WHERE id=$1 AND account_id=$2 AND status='pending' RETURNING id", [id, accountId])).rows.length, "REQUEST_NOT_PENDING", 409);
      return { withdrawn: true };
    }),
    reviewQueue: (credentials) => asReviewer(credentials, async (db) =>
      ({ items: (await db.query("SELECT * FROM app_civic.official_requests WHERE status='pending' ORDER BY created_at LIMIT 100")).rows.map((r) => ({ ...officialView(r), accountId: r.account_id, evidenceUrl: r.evidence_url })) })),
    async review(credentials, id, body) {
      const decided = await asReviewer(credentials, async (db, reviewerId) => {
        need(UUID.test(id) && ["approve", "reject"].includes(body.decision), "INVALID_REVIEW");
        const note = typeof body.note === "string" ? body.note.slice(0, 1000) : null;
        const row = (await db.query(
          "UPDATE app_civic.official_requests SET status=$2,review_note=$3,reviewed_by=$4,reviewed_at=$5 WHERE id=$1 AND status='pending' RETURNING *",
          [id, body.decision === "approve" ? "approved" : "rejected", note, reviewerId, now()])).rows[0];
        need(row, "REQUEST_NOT_PENDING", 409);
        need(row.account_id !== reviewerId, "SELF_REVIEW_FORBIDDEN", 403);
        return { row, view: officialView(row) };
      });
      let grant = null, entitlementApplied = false;
      if (body.decision === "approve") {
        grant = officialGrant({ office: decided.view.office, jurisdiction: decided.view.jurisdiction, termStart: decided.view.termStart, termEnd: decided.view.termEnd });
        // Issued through the engine's entitlement store in its own audited,
        // administrator-checked transaction; idempotent per request.
        if (grantOfficial) { await grantOfficial(credentials, { accountId: decided.row.account_id, grant, sourceId: decided.row.id }); entitlementApplied = true; }
      }
      return { request: decided.view, grant, entitlementApplied };
    },
    publicOfficials: () => transaction(async (db) => {
      await db.query("SELECT set_config('dge.public_directory','officials',true)");
      const rows = (await db.query("SELECT * FROM app_civic.official_requests WHERE public_badge AND status='approved' AND term_end>=CURRENT_DATE ORDER BY level,jurisdiction LIMIT 500")).rows;
      return { items: rows.map((r) => ({ accountId: r.account_id, level: r.level, role: r.role, jurisdiction: r.jurisdiction, office: r.office, district: r.district, termEnd: day(r.term_end) })) };
    }),

    attestTrust: (credentials, body) => asReviewer(credentials, async (db, reviewerId) => {
      need(UUID.test(body.accountId ?? "") && TRUST_TIERS[body.tier] && body.tier !== "account" && HEX.test(body.evidenceDigest ?? "") &&
        typeof body.method === "string" && body.method.length >= 1 && body.method.length <= 120 && !Number.isNaN(Date.parse(body.expiresAt)), "INVALID_ATTESTATION");
      need(body.tier !== "constituent" || (typeof body.jurisdiction === "string" && body.jurisdiction.length <= 200 && body.jurisdiction.trim()), "JURISDICTION_REQUIRED");
      need(Date.parse(body.expiresAt) > clock(), "INVALID_ATTESTATION");
      const id = randomUUID();
      await db.query(
        "INSERT INTO app_civic.trust_attestations(id,account_id,tier,jurisdiction,method,evidence_digest,issued_by,issued_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [id, body.accountId, body.tier, body.jurisdiction ?? null, body.method, body.evidenceDigest, reviewerId, now(), new Date(body.expiresAt)]);
      return { id };
    }),
    myTrust: (credentials) => asAccount(credentials, async (db, accountId) => {
      const rows = (await db.query("SELECT tier,jurisdiction,method,issued_at,expires_at FROM app_civic.trust_attestations WHERE account_id=$1 AND revoked_at IS NULL AND expires_at>$2 ORDER BY issued_at DESC", [accountId, now()])).rows;
      const best = rows.reduce((top, r) => (TRUST_TIERS[r.tier].rank > TRUST_TIERS[top].rank ? r.tier : top), "account");
      return { tier: best, label: TRUST_TIERS[best].label, claim: TRUST_TIERS[best].claim, attestations: rows.map((r) => ({ tier: r.tier, jurisdiction: r.jurisdiction, method: r.method, issuedAt: iso(r.issued_at), expiresAt: iso(r.expires_at) })) };
    }),

    respond: (credentials, tenantId, documentId, proposalId, body) => inWorkspace(credentials, tenantId, ["owner", "admin", "editor"], async (db, actor) => {
      need(UUID.test(documentId) && UUID.test(proposalId) && RESPONSE_KINDS[body.kind] && typeof body.explanation === "string" && body.explanation.trim() && body.explanation.length <= 2000, "INVALID_RESPONSE");
      need((await db.query("SELECT 1 FROM dge_proposals.proposals WHERE tenant_id=$1 AND document_id=$2 AND id=$3", [tenantId, documentId, proposalId])).rows.length, "PROPOSAL_NOT_FOUND", 404);
      // Serialize concurrent responders so response versions never collide.
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [proposalId]);
      const version = Number((await db.query("SELECT COALESCE(max(version),0) AS v FROM app_civic.sponsor_responses WHERE tenant_id=$1 AND document_id=$2 AND proposal_id=$3", [tenantId, documentId, proposalId])).rows[0].v) + 1;
      need(version <= 100, "RESPONSE_LIMIT_REACHED", 429);
      await db.query("INSERT INTO app_civic.sponsor_responses(tenant_id,document_id,proposal_id,version,kind,explanation,responder,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [tenantId, documentId, proposalId, version, body.kind, body.explanation.trim(), actor.accountId, now()]);
      return { proposalId, version, kind: body.kind };
    }),
    async disposition(documentId) {
      const source = await documents.publicRead(documentId);
      const items = await allProposals(documentId);
      return publicDocument(documentId, async (db) => {
        const responses = (await db.query("SELECT proposal_id,version,kind,explanation,created_at FROM app_civic.sponsor_responses WHERE document_id=$1", [documentId])).rows
          .map((r) => ({ proposalId: r.proposal_id, version: r.version, kind: r.kind, explanation: r.explanation, createdAt: iso(r.created_at) }));
        const decisions = (await db.query("SELECT proposal_id,certificate FROM dge_decisions.decisions WHERE document_id=$1 AND state='closed'", [documentId])).rows
          .map((r) => ({ proposalId: r.proposal_id, status: r.certificate.outcome.status, ...r.certificate.outcome.weights }));
        const series = (await db.query("SELECT series_id,sequence,summary_of_changes FROM app_civic.consultation_editions WHERE document_id=$1", [documentId])).rows[0] ?? null;
        return {
          ...dispositionReport({
            document: { id: documentId, title: source.document.metadata.title, version: source.version, digest: source.digest },
            proposals: items.map((p) => ({ id: p.proposal.id, quote: p.proposal.selection.quote, replacement: p.proposal.replacement, rationale: p.proposal.rationale })),
            responses, decisions,
          }),
          mode: source.document.mode,
          consultation: series ? { seriesId: series.series_id, sequence: series.sequence, summaryOfChanges: series.summary_of_changes } : null,
        };
      });
    },
    registerConsultation: (credentials, tenantId, body) => inWorkspace(credentials, tenantId, ["owner", "admin", "editor"], async (db, actor) => {
      need(UUID.test(body.documentId ?? "") && (body.seriesId === undefined || UUID.test(body.seriesId)), "INVALID_CONSULTATION");
      const doc = (await db.query("SELECT current FROM dge_documents.documents WHERE tenant_id=$1 AND id=$2", [tenantId, body.documentId])).rows[0];
      need(doc, "DOCUMENT_NOT_FOUND", 404);
      need(doc.current.mode === "public-input", "CONSULTATION_REQUIRES_FROZEN_SOURCE", 409);
      const seriesId = body.seriesId ?? randomUUID();
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [seriesId]);
      const sequence = Number((await db.query("SELECT COALESCE(max(sequence),0) AS s FROM app_civic.consultation_editions WHERE series_id=$1", [seriesId])).rows[0].s) + 1;
      need(body.seriesId === undefined || sequence > 1, "SERIES_NOT_FOUND", 404);
      const summary = typeof body.summaryOfChanges === "string" ? body.summaryOfChanges.slice(0, 4000) : null;
      try {
        await db.query("INSERT INTO app_civic.consultation_editions(series_id,sequence,tenant_id,document_id,summary_of_changes,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [seriesId, sequence, tenantId, body.documentId, summary, actor.accountId, now()]);
      } catch (error) {
        if (error?.code === "23505") throw new CivicError("ALREADY_IN_SERIES", 409);
        throw error;
      }
      return { seriesId, sequence, documentId: body.documentId };
    }),
    consultationSeries: (credentials, tenantId, seriesId) => inWorkspace(credentials, tenantId, ["owner", "admin", "editor", "participant", "viewer"], async (db) => {
      need(UUID.test(seriesId), "INVALID_CONSULTATION");
      const rows = (await db.query("SELECT sequence,document_id,summary_of_changes,created_at FROM app_civic.consultation_editions WHERE series_id=$1 ORDER BY sequence", [seriesId])).rows;
      return { seriesId, editions: rows.map((r) => ({ sequence: r.sequence, documentId: r.document_id, summaryOfChanges: r.summary_of_changes, createdAt: iso(r.created_at) })) };
    }, false),

    createGroup: (credentials, tenantId, body) => inWorkspace(credentials, tenantId, ["owner", "admin", "editor", "participant"], async (db, actor) => {
      const group = parse(() => validateGroup(body), "INVALID_GROUP");
      const id = randomUUID();
      await db.query("INSERT INTO app_civic.research_groups(id,tenant_id,kind,name,institution,affiliation_disclosure,funding_disclosure,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [id, tenantId, group.kind, group.name, group.institution, group.affiliationDisclosure, group.fundingDisclosure, actor.accountId, now()]);
      return { id, ...group };
    }),
    groups: (credentials, tenantId) => inWorkspace(credentials, tenantId, ["owner", "admin", "editor", "participant", "viewer"], async (db) =>
      ({ items: (await db.query("SELECT id,kind,name,institution,affiliation_disclosure,funding_disclosure,created_at FROM app_civic.research_groups WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 200", [tenantId])).rows
        .map((r) => ({ id: r.id, kind: r.kind, name: r.name, institution: r.institution, affiliationDisclosure: r.affiliation_disclosure, fundingDisclosure: r.funding_disclosure, createdAt: iso(r.created_at) })) }), false),
    addEvidence: (credentials, tenantId, groupId, body) => inWorkspace(credentials, tenantId, ["owner", "admin", "editor", "participant"], async (db, actor) => {
      need(UUID.test(groupId) && (body.documentId === undefined || UUID.test(body.documentId)), "INVALID_EVIDENCE");
      need((await db.query("SELECT 1 FROM app_civic.research_groups WHERE tenant_id=$1 AND id=$2", [tenantId, groupId])).rows.length, "GROUP_NOT_FOUND", 404);
      if (body.documentId) need((await db.query("SELECT 1 FROM dge_documents.documents WHERE tenant_id=$1 AND id=$2", [tenantId, body.documentId])).rows.length, "DOCUMENT_NOT_FOUND", 404);
      const { documentId, ...rest } = body;
      const evidence = parse(() => validateEvidence(rest), "INVALID_EVIDENCE");
      const id = randomUUID();
      await db.query(
        `INSERT INTO app_civic.evidence_items(id,tenant_id,group_id,document_id,kind,title,url,authors,publisher,published_on,pinpoint,summary,quote,added_by,added_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [id, tenantId, groupId, documentId ?? null, evidence.kind, evidence.title, evidence.url, evidence.authors, evidence.publisher, evidence.publishedOn, evidence.pinpoint, evidence.summary, evidence.quote, actor.accountId, now()]);
      return { id, citation: formatCitation(evidence), ...evidence };
    }),
    publicEvidence: (documentId) => publicDocument(documentId, async (db) => {
      const rows = (await db.query(
        `SELECT e.*, g.name AS group_name, g.kind AS group_kind, g.institution, g.affiliation_disclosure, g.funding_disclosure
         FROM app_civic.evidence_items e JOIN app_civic.research_groups g ON g.id=e.group_id WHERE e.document_id=$1 ORDER BY e.added_at LIMIT 500`, [documentId])).rows;
      return {
        items: rows.map((r) => ({
          id: r.id, kind: r.kind, title: r.title, url: r.url, summary: r.summary, quote: r.quote,
          citation: formatCitation({ authors: r.authors, title: r.title, publisher: r.publisher, publishedOn: r.published_on, pinpoint: r.pinpoint, url: r.url }),
          group: { name: r.group_name, kind: r.group_kind, institution: r.institution, affiliationDisclosure: r.affiliation_disclosure, fundingDisclosure: r.funding_disclosure },
        })),
        notice: "Academic affiliation is disclosed for context. It never changes vote weight or argument ranking.",
      };
    }),

    analytics: (documentId) => publicDocument(documentId, async (db) => {
      const proposalCount = Number((await db.query("SELECT count(*) AS n FROM dge_proposals.proposals WHERE document_id=$1", [documentId])).rows[0].n);
      const points = Number((await db.query("SELECT count(*) AS n FROM dge_discussion.points WHERE document_id=$1", [documentId])).rows[0].n);
      const pointVotes = Number((await db.query("SELECT COALESCE(sum(up_count+down_count),0) AS n FROM dge_discussion.scores WHERE document_id=$1", [documentId])).rows[0].n);
      const contributors = (await db.query(
        "SELECT DISTINCT actor_id FROM (SELECT actor_id FROM dge_proposals.proposals WHERE document_id=$1 UNION SELECT actor_id FROM dge_discussion.points WHERE document_id=$1) c", [documentId])).rows.map((r) => r.actor_id);
      const decisions = (await db.query("SELECT proposal_id,certificate FROM dge_decisions.decisions WHERE document_id=$1 AND state='closed'", [documentId])).rows
        .map((r) => ({ proposalId: r.proposal_id, status: r.certificate.outcome.status, participating: r.certificate.outcome.counts.participating, eligible: r.certificate.outcome.counts.eligible }));
      // Only an aggregate count of verified contributors leaves this query.
      await db.query("SELECT set_config('dge.worker','civic-review',true)");
      const verified = contributors.length ? Number((await db.query(
        "SELECT count(DISTINCT account_id) AS n FROM app_civic.trust_attestations WHERE account_id=ANY($1::uuid[]) AND tier IN ('verified-person','constituent') AND revoked_at IS NULL AND expires_at>$2",
        [contributors, now()])).rows[0].n) : 0;
      return participationSummary({ proposals: proposalCount, points, pointVotes, decisions, contributors: contributors.length, verifiedContributors: verified });
    }),

    async handoff(credentials, tenantId, documentId) {
      await inWorkspace(credentials, tenantId, ["owner", "admin", "editor"], async (db) =>
        need((await db.query("SELECT 1 FROM dge_documents.documents WHERE tenant_id=$1 AND id=$2", [tenantId, documentId])).rows.length, "DOCUMENT_NOT_FOUND", 404), false);
      const current = await documents.publicRead(documentId);
      const [disposition, analytics] = await Promise.all([this.disposition(documentId), this.analytics(documentId)]);
      let profile = null;
      try { profile = await this.billProfile(documentId); } catch (error) { if (error.code !== "BILL_PROFILE_NOT_FOUND") throw error; }
      const body = {
        schema: "civicquill-sponsor-handoff-v1",
        generatedAt: now().toISOString(),
        bill: { documentId, title: current.document.metadata.title, version: current.version, digest: current.digest, mode: current.document.mode, jurisdiction: profile?.jurisdiction?.name ?? null },
        document: current.document,
        publicInput: disposition, participation: analytics,
        verification: { package: "/api/public/documents/" + documentId + "/verification-package?version=" + current.version, verifyPage: "/verify?document=" + documentId },
        statement: "Prepared from a CivicQuill community process. Community support, advisory votes and adoption on this platform do not introduce, pass or enact legislation.",
      };
      const digest = createHash("sha256").update(JSON.stringify(body)).digest("hex");
      return new Response(JSON.stringify({ ...body, packageSha256: digest }), {
        headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="civicquill-handoff-${documentId}-v${current.version}.json"` },
      });
    },
  };
}

const query = (url, allowed) => {
  for (const key of url.searchParams.keys()) if (!allowed.includes(key)) throw new HttpError(400, "INVALID_QUERY");
};

export function createCivicRoutes(service) {
  return async ({ request, url, credentials, write, method }) => {
    const path = url.pathname;
    if (!path.startsWith("/api/civic") && !path.startsWith("/api/public/civic") && !/^\/api\/workspaces\/[a-f0-9-]{36}\/civic\//.test(path)) return null;
    try {
      query(url, []);
      if (path === "/api/public/civic/catalog") { method(["GET"]); return { jurisdictions: Object.values(JURISDICTIONS), templateParts: TEMPLATE_PARTS, plans: CIVIC_CATALOG, defaults: CIVIC_SETTINGS_DEFAULTS, trustTiers: TRUST_TIERS, responseKinds: RESPONSE_KINDS }; }
      if (path === "/api/public/civic/officials") { method(["GET"]); return await service.publicOfficials(); }
      let m;
      if ((m = path.match(/^\/api\/public\/civic\/documents\/([a-f0-9-]{36})\/(profile|disposition|evidence|analytics)$/))) {
        method(["GET"]);
        return await { profile: service.billProfile, disposition: service.disposition.bind(service), evidence: service.publicEvidence, analytics: service.analytics }[m[2]](m[1]);
      }
      if (path === "/api/civic/officials") {
        method(["GET", "POST"]);
        if (request.method === "GET") return await service.myOfficialRequests(credentials);
        write();
        return await service.requestOfficial(credentials, await boundedJson(request, ["level", "role", "jurisdiction", "office", "district", "principalName", "termStart", "termEnd", "evidenceUrl", "publicBadge"], ["level", "role", "jurisdiction", "office", "termStart", "termEnd", "evidenceUrl"]));
      }
      if ((m = path.match(/^\/api\/civic\/officials\/([a-f0-9-]{36})\/(withdraw|review)$/))) {
        method(["POST"]); write();
        if (m[2] === "withdraw") { await boundedJson(request, []); return await service.withdrawOfficial(credentials, m[1]); }
        return await service.review(credentials, m[1], await boundedJson(request, ["decision", "note"], ["decision"]));
      }
      if (path === "/api/civic/review/officials") { method(["GET"]); return await service.reviewQueue(credentials); }
      if (path === "/api/civic/trust") { method(["GET"]); return await service.myTrust(credentials); }
      if (path === "/api/civic/trust-attestations") {
        method(["POST"]); write();
        return await service.attestTrust(credentials, await boundedJson(request, ["accountId", "tier", "jurisdiction", "method", "evidenceDigest", "expiresAt"], ["accountId", "tier", "method", "evidenceDigest", "expiresAt"]));
      }
      if ((m = path.match(/^\/api\/workspaces\/([a-f0-9-]{36})\/civic\/(.+)$/))) {
        const [, tenantId, rest] = m;
        if (rest === "bills") {
          method(["POST"]); write();
          return await service.createBill(credentials, tenantId, await boundedJson(request, ["jurisdictionId", "title", "parts", "values", "locale", "sponsorDisplay", "commandId"], ["jurisdictionId", "title", "commandId"], 65536));
        }
        let r;
        if ((r = rest.match(/^documents\/([a-f0-9-]{36})\/proposals\/([a-f0-9-]{36})\/responses$/))) {
          method(["POST"]); write();
          return await service.respond(credentials, tenantId, r[1], r[2], await boundedJson(request, ["kind", "explanation"]));
        }
        if ((r = rest.match(/^documents\/([a-f0-9-]{36})\/handoff$/))) { method(["GET"]); return await service.handoff(credentials, tenantId, r[1]); }
        if (rest === "consultations") { method(["POST"]); write(); return await service.registerConsultation(credentials, tenantId, await boundedJson(request, ["documentId", "seriesId", "summaryOfChanges"], ["documentId"])); }
        if ((r = rest.match(/^consultations\/([a-f0-9-]{36})$/))) { method(["GET"]); return await service.consultationSeries(credentials, tenantId, r[1]); }
        if (rest === "research-groups") {
          method(["GET", "POST"]);
          if (request.method === "GET") return await service.groups(credentials, tenantId);
          write();
          return await service.createGroup(credentials, tenantId, await boundedJson(request, ["kind", "name", "institution", "affiliationDisclosure", "fundingDisclosure"], ["kind", "name", "affiliationDisclosure"]));
        }
        if ((r = rest.match(/^research-groups\/([a-f0-9-]{36})\/evidence$/))) {
          method(["POST"]); write();
          return await service.addEvidence(credentials, tenantId, r[1], await boundedJson(request, ["documentId", "kind", "title", "url", "authors", "publisher", "publishedOn", "pinpoint", "summary", "quote"], ["kind", "title", "url", "summary"], 16384));
        }
      }
      throw new HttpError(404, "NOT_FOUND");
    } catch (cause) {
      // Engine store errors carry a stable code and HTTP status; map them unchanged.
      if (cause instanceof CivicError || (cause?.constructor?.name === "DocumentError" && Number.isInteger(cause.status))) throw new HttpError(cause.status, cause.code);
      throw cause;
    }
  };
}

/** The CivicQuill extension consumed by the engine composition root. */
export const civicExtension = Object.freeze({
  id: "civic",
  migrations: [migration("001-civic.sql")],
  pagePaths: CIVIC_PAGES,
  createRoutes(services) {
    const service = createCivicService({
      ...services,
      isPlatformAdmin: async (credentials) => Boolean(await services.isPlatformAdmin?.(credentials)),
      grantOfficial: services.entitlements
        ? (credentials, { accountId, grant, sourceId }) => services.entitlements.createGrant(credentials, {
            subject: { kind: "account", id: accountId }, resource: "document-create", quantity: grant.monthlyCap, period: "month",
            expiresAt: grant.expiresAt, provenance: "verified-official", reason: grant.purpose.slice(0, 200), idempotencyKey: "civic-official:" + sourceId,
          })
        : null,
    });
    return [{ routes: createCivicRoutes(service), bodyLimit: (path) => (path.includes("/civic/bills") ? 65536 : 16384) }];
  },
});
