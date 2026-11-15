import React, { useEffect, useState } from "react";
import { createAccountAPI } from "@distributed-governance/engine/web/account-api.mjs";

const api = createAccountAPI();
const uuid = () => crypto.randomUUID();
const explain = (error) => ({
  AUTHENTICATION_REQUIRED: "Sign in to continue.",
  ACCESS_DENIED: "Your account does not have permission for this action.",
  REQUEST_ALREADY_PENDING: "You already have a verification request awaiting review.",
  INVALID_OFFICIAL_REQUEST: "Check the office details, term dates and https evidence link.",
  CONSULTATION_REQUIRES_FROZEN_SOURCE: "Freeze the document as a public-input edition before opening a consultation.",
  SIGN_IN_AGAIN: "Sign in again to continue.",
}[error?.code] ?? "The service could not complete the request. Nothing was assumed to succeed.");

function useWorkspaces() {
  const [workspaces, setWorkspaces] = useState([]);
  const [tenantId, setTenantId] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => {
    api("/api/workspaces?limit=100").then((r) => { setWorkspaces(r.items); setTenantId(r.items[0]?.tenantId ?? ""); })
      .catch((e) => setStatus(explain(e)));
  }, []);
  const picker = (
    <label>Workspace
      <select value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
        {!workspaces.length && <option value="">No workspaces — create one under Workspaces</option>}
        {workspaces.map((w) => <option key={w.tenantId} value={w.tenantId}>Workspace {w.tenantId.slice(0, 8)} · {w.role}</option>)}
      </select>
    </label>
  );
  return { tenantId, picker, status, workspaces };
}
const Status = ({ children }) => <p role="status" aria-live="polite" className="console-status">{children}</p>;

export function NewBillPage() {
  const { tenantId, picker, status: wsStatus } = useWorkspaces();
  const [catalog, setCatalog] = useState(null);
  const [form, setForm] = useState({ jurisdictionId: "us-federal", title: "", purpose: "", shortTitle: "", state: "", body: "", locality: "", findings: "", operative: "", effectiveDate: "", sponsorDisplay: "" });
  const [parts, setParts] = useState(["shortTitle", "findings", "definitions", "operative", "severability", "effectiveDate"]);
  const [status, setStatus] = useState("");
  const [created, setCreated] = useState(null);
  useEffect(() => { api("/api/public/civic/catalog").then(setCatalog).catch(() => setStatus("Templates are unavailable.")); }, []);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const lines = (text) => text.split("\n").map((s) => s.trim()).filter(Boolean);
  const level = catalog?.jurisdictions.find((j) => j.id === form.jurisdictionId)?.level;
  async function submit(event) {
    event.preventDefault();
    setStatus("Creating the draft…");
    try {
      const result = await api("/api/workspaces/" + tenantId + "/civic/bills", { method: "POST", body: {
        jurisdictionId: form.jurisdictionId, title: form.title, parts, commandId: uuid(), sponsorDisplay: form.sponsorDisplay || undefined,
        values: { purpose: form.purpose, shortTitle: form.shortTitle || form.title, state: form.state, body: form.body, locality: form.locality,
          findings: lines(form.findings), operative: lines(form.operative), effectiveDate: form.effectiveDate },
      } });
      setCreated(result); setStatus(result.notice);
    } catch (e) { setStatus(explain(e)); }
  }
  return (
    <form className="console-card" onSubmit={submit}>
      <h2>Draft from a jurisdiction template</h2>
      <p className="console-notice">Every generated sentence is an editable starting point. Creating a draft here does not introduce or file legislation.</p>
      <div className="console-form">
        {picker}
        <label>Jurisdiction
          <select value={form.jurisdictionId} onChange={set("jurisdictionId")}>
            {catalog?.jurisdictions.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
          </select>
        </label>
        <label>Working title<input required maxLength={1000} value={form.title} onChange={set("title")} /></label>
        <label>Purpose (completes “To …”)<input required maxLength={1000} value={form.purpose} onChange={set("purpose")} placeholder="improve access to public transit" /></label>
        <label>Short title<input maxLength={300} value={form.shortTitle} onChange={set("shortTitle")} /></label>
        {level === "state" && <label>State<input required value={form.state} onChange={set("state")} /></label>}
        {level === "local" && <><label>Legislative body<input required value={form.body} onChange={set("body")} placeholder="City Council" /></label>
          <label>Locality<input required value={form.locality} onChange={set("locality")} /></label></>}
        <label>Sponsor display name (optional)<input maxLength={200} value={form.sponsorDisplay} onChange={set("sponsorDisplay")} /></label>
      </div>
      <fieldset className="console-fieldset">
        <legend>Sections to include</legend>
        {catalog?.templateParts.map((p) => (
          <label key={p} className="console-check"><input type="checkbox" checked={parts.includes(p)} disabled={p === "operative"}
            onChange={(e) => setParts(e.target.checked ? [...parts, p] : parts.filter((x) => x !== p))} /> {p.replace(/([A-Z])/g, " $1").toLowerCase()}</label>
        ))}
      </fieldset>
      <div className="console-form">
        <label>Findings (one per line)<textarea rows={4} value={form.findings} onChange={set("findings")} /></label>
        <label>Requirements (one per line)<textarea rows={4} value={form.operative} onChange={set("operative")} /></label>
        <label>Effective date clause (optional)<input value={form.effectiveDate} onChange={set("effectiveDate")} /></label>
      </div>
      <button disabled={!tenantId}>Create community draft</button>
      <Status>{wsStatus || status}</Status>
      {created && <p><a href={"/?document=" + created.document.id}>Open the draft in the editor</a> · <a href={"/verify?document=" + created.document.id}>Verification</a></p>}
    </form>
  );
}

export function OfficialsPage() {
  const [mine, setMine] = useState([]);
  const [badges, setBadges] = useState([]);
  const [status, setStatus] = useState("");
  const [form, setForm] = useState({ level: "state", role: "elected-official", jurisdiction: "", office: "", district: "", principalName: "", termStart: "", termEnd: "", evidenceUrl: "", publicBadge: true });
  const load = () => {
    api("/api/civic/officials").then((r) => setMine(r.items)).catch(() => {});
    api("/api/public/civic/officials").then((r) => setBadges(r.items)).catch(() => {});
  };
  useEffect(load, []);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  async function submit(event) {
    event.preventDefault();
    try {
      const body = { ...form };
      if (!body.district) delete body.district;
      if (body.role !== "authorized-staff") delete body.principalName;
      await api("/api/civic/officials", { method: "POST", body });
      setStatus("Request submitted for review. Your evidence link is visible only to reviewers."); load();
    } catch (e) { setStatus(explain(e)); }
  }
  return (
    <>
      <form className="console-card" onSubmit={submit}>
        <h2>Request elected-official verification</h2>
        <p>Verified federal, state and local officials and their authorized staff receive a legislative-purpose drafting grant for their term. Reviewers check the office against an official public source.</p>
        <div className="console-form">
          <label>Level<select value={form.level} onChange={set("level")}><option value="federal">Federal</option><option value="state">State</option><option value="local">Local</option></select></label>
          <label>Role<select value={form.role} onChange={set("role")}><option value="elected-official">Elected official</option><option value="authorized-staff">Authorized staff</option></select></label>
          <label>Jurisdiction<input required value={form.jurisdiction} onChange={set("jurisdiction")} /></label>
          <label>Office<input required value={form.office} onChange={set("office")} placeholder="State Representative" /></label>
          <label>District (optional)<input value={form.district} onChange={set("district")} /></label>
          {form.role === "authorized-staff" && <label>Official you work for<input required value={form.principalName} onChange={set("principalName")} /></label>}
          <label>Term start<input type="date" required value={form.termStart} onChange={set("termStart")} /></label>
          <label>Term end<input type="date" required value={form.termEnd} onChange={set("termEnd")} /></label>
          <label>Official evidence link (https)<input type="url" required pattern="https://.*" value={form.evidenceUrl} onChange={set("evidenceUrl")} /></label>
          <label className="console-check"><input type="checkbox" checked={form.publicBadge} onChange={set("publicBadge")} /> Show a public office badge</label>
        </div>
        <button>Submit for review</button>
        <Status>{status}</Status>
      </form>
      <section className="console-card"><h2>Your requests</h2>
        {mine.length ? <ul>{mine.map((r) => <li key={r.id}>{r.office}, {r.jurisdiction} — <span className="console-pill">{r.status}</span>{r.reviewNote ? " · " + r.reviewNote : ""}</li>)}</ul> : <p>No requests yet.</p>}
      </section>
      <section className="console-card"><h2>Verified offices</h2>
        {badges.length ? <table className="console-table"><thead><tr><th scope="col">Office</th><th scope="col">Jurisdiction</th><th scope="col">Level</th><th scope="col">Term ends</th></tr></thead>
          <tbody>{badges.map((b, i) => <tr key={i}><td>{b.office}{b.district ? ", " + b.district : ""}{b.role === "authorized-staff" ? " (staff)" : ""}</td><td>{b.jurisdiction}</td><td>{b.level}</td><td>{b.termEnd}</td></tr>)}</tbody></table>
          : <p>No public office badges yet.</p>}
      </section>
    </>
  );
}

export function ReviewPage() {
  const [queue, setQueue] = useState(null);
  const [status, setStatus] = useState("");
  const load = () => api("/api/civic/review/officials").then((r) => setQueue(r.items)).catch((e) => setStatus(explain(e)));
  useEffect(load, []);
  async function decide(id, decision) {
    const note = window.prompt(decision === "approve" ? "Note what you checked (shown to the applicant):" : "Reason for rejection (shown to the applicant):") ?? "";
    try { await api("/api/civic/officials/" + id + "/review", { method: "POST", body: { decision, note } }); setStatus("Recorded."); load(); }
    catch (e) { setStatus(explain(e)); }
  }
  return (
    <section className="console-card"><h2>Official verification queue</h2>
      <p>Platform administrators only. Verify each office against the official source before approving; you cannot review your own request.</p>
      <Status>{status}</Status>
      {queue && (queue.length ? <table className="console-table"><thead><tr><th scope="col">Office</th><th scope="col">Term</th><th scope="col">Evidence</th><th scope="col">Decision</th></tr></thead>
        <tbody>{queue.map((r) => <tr key={r.id}><td>{r.office}, {r.jurisdiction} ({r.level}, {r.role})</td><td>{r.termStart} – {r.termEnd}</td>
          <td><a href={r.evidenceUrl} rel="noopener noreferrer" target="_blank">Open source</a></td>
          <td><button onClick={() => decide(r.id, "approve")}>Approve</button> <button onClick={() => decide(r.id, "reject")}>Reject</button></td></tr>)}</tbody></table>
        : <p>No pending requests.</p>)}
    </section>
  );
}

function useDocumentPicker(tenantId) {
  const [documents, setDocuments] = useState([]);
  const [documentId, setDocumentId] = useState(new URLSearchParams(location.search).get("document") ?? "");
  useEffect(() => {
    if (!tenantId) return;
    api("/api/workspaces/" + tenantId + "/documents?limit=100").then((r) => { setDocuments(r.items); setDocumentId((d) => d || r.items[0]?.id || ""); }).catch(() => {});
  }, [tenantId]);
  const picker = (
    <label>Document
      <select value={documentId} onChange={(e) => setDocumentId(e.target.value)}>
        {documents.map((d) => <option key={d.id} value={d.id}>{d.title} · v{d.version} · {d.mode}</option>)}
      </select>
    </label>
  );
  return { documentId, picker, documents };
}

export function ConsultationsPage() {
  const { tenantId, picker } = useWorkspaces();
  const { documentId, picker: docPicker, documents } = useDocumentPicker(tenantId);
  const [report, setReport] = useState(null);
  const [status, setStatus] = useState("");
  const [drafts, setDrafts] = useState({});
  const doc = documents.find((d) => d.id === documentId);
  const load = () => documentId && api("/api/public/civic/documents/" + documentId + "/disposition").then(setReport).catch((e) => setStatus(explain(e)));
  useEffect(() => { setReport(null); load(); }, [documentId]);
  async function register() {
    try { const r = await api("/api/workspaces/" + tenantId + "/civic/consultations", { method: "POST", body: { documentId } }); setStatus("Consultation edition " + r.sequence + " recorded."); load(); }
    catch (e) { setStatus(explain(e)); }
  }
  async function respond(proposalId) {
    const draft = drafts[proposalId] ?? { kind: "noted", explanation: "" };
    try {
      await api("/api/workspaces/" + tenantId + "/civic/documents/" + documentId + "/proposals/" + proposalId + "/responses", { method: "POST", body: draft });
      setStatus("Response published."); load();
    } catch (e) { setStatus(explain(e)); }
  }
  return (
    <>
      <section className="console-card"><h2>Public-input consultation</h2>
        <p>In public-input mode the source edition never changes. Participants propose changes, argue and cast advisory votes; you publish a response to each proposal. To revise, create a new public-input document and record it as the next edition in the series.</p>
        <div className="console-form">{picker}{docPicker}</div>
        {doc && doc.mode === "public-input" && !report?.consultation && <button onClick={register}>Record as a consultation edition</button>}
        {doc && doc.mode !== "public-input" && <p className="console-notice">This document is a collaboration draft. Freeze it as a public-input edition from the editor to open a consultation.</p>}
        <Status>{status}</Status>
      </section>
      {report && (
        <section className="console-card"><h2>Disposition report</h2>
          <p>{report.totals.answered} of {report.totals.proposals} proposals answered · source version {report.sourceVersion}{report.consultation ? " · consultation edition " + report.consultation.sequence : ""}</p>
          <p>{report.statement}</p>
          {report.rows.map((row) => (
            <article key={row.proposalId} className="console-subcard">
              <p><del>{row.quote}</del> → <ins>{row.replacement || "(delete)"}</ins></p>
              <p>{row.rationale}</p>
              {row.advisoryVote && <p>Advisory vote: {row.advisoryVote.yes} yes · {row.advisoryVote.no} no · {row.advisoryVote.abstain} abstain</p>}
              <p><strong>Sponsor response:</strong> {row.response ? row.response.label + " — " + row.response.explanation : "Not yet answered"}</p>
              <div className="console-form">
                <label>Response<select value={drafts[row.proposalId]?.kind ?? "noted"} onChange={(e) => setDrafts({ ...drafts, [row.proposalId]: { ...(drafts[row.proposalId] ?? { explanation: "" }), kind: e.target.value } })}>
                  <option value="incorporated">Incorporated</option><option value="partially-incorporated">Partly incorporated</option><option value="declined">Declined</option><option value="noted">Noted</option><option value="deferred">Deferred</option>
                </select></label>
                <label>Explanation<input maxLength={2000} value={drafts[row.proposalId]?.explanation ?? ""} onChange={(e) => setDrafts({ ...drafts, [row.proposalId]: { ...(drafts[row.proposalId] ?? { kind: "noted" }), explanation: e.target.value } })} /></label>
                <button onClick={() => respond(row.proposalId)} disabled={!drafts[row.proposalId]?.explanation}>Publish response</button>
              </div>
            </article>
          ))}
        </section>
      )}
    </>
  );
}

export function ResearchPage() {
  const { tenantId, picker } = useWorkspaces();
  const { documentId, picker: docPicker } = useDocumentPicker(tenantId);
  const [groups, setGroups] = useState([]);
  const [groupId, setGroupId] = useState("");
  const [evidence, setEvidence] = useState(null);
  const [status, setStatus] = useState("");
  const [group, setGroup] = useState({ kind: "class", name: "", institution: "", affiliationDisclosure: "" });
  const [item, setItem] = useState({ kind: "study", title: "", url: "", authors: "", summary: "" });
  const loadGroups = () => tenantId && api("/api/workspaces/" + tenantId + "/civic/research-groups").then((r) => { setGroups(r.items); setGroupId((g) => g || r.items[0]?.id || ""); }).catch(() => {});
  useEffect(loadGroups, [tenantId]);
  const loadEvidence = () => documentId && api("/api/public/civic/documents/" + documentId + "/evidence").then(setEvidence).catch(() => setEvidence(null));
  useEffect(loadEvidence, [documentId]);
  async function addGroup(e) {
    e.preventDefault();
    try { await api("/api/workspaces/" + tenantId + "/civic/research-groups", { method: "POST", body: { ...group, institution: group.institution || undefined } }); setStatus("Group created."); loadGroups(); }
    catch (err) { setStatus(explain(err)); }
  }
  async function addItem(e) {
    e.preventDefault();
    try {
      const body = { ...item, documentId };
      for (const k of Object.keys(body)) if (body[k] === "") delete body[k];
      await api("/api/workspaces/" + tenantId + "/civic/research-groups/" + groupId + "/evidence", { method: "POST", body });
      setStatus("Evidence added with its citation."); loadEvidence();
    } catch (err) { setStatus(explain(err)); }
  }
  return (
    <>
      <form className="console-card" onSubmit={addGroup}><h2>Research group</h2>
        <p>Classes, theses and projects contribute evidence with disclosed affiliation. Affiliation helps readers weigh sources; it never adds vote weight.</p>
        <div className="console-form">{picker}
          <label>Kind<select value={group.kind} onChange={(e) => setGroup({ ...group, kind: e.target.value })}><option value="class">Class</option><option value="thesis">Thesis</option><option value="project">Project</option><option value="lab">Lab</option></select></label>
          <label>Name<input required value={group.name} onChange={(e) => setGroup({ ...group, name: e.target.value })} /></label>
          <label>Institution<input value={group.institution} onChange={(e) => setGroup({ ...group, institution: e.target.value })} /></label>
          <label>Affiliation disclosure<input required value={group.affiliationDisclosure} onChange={(e) => setGroup({ ...group, affiliationDisclosure: e.target.value })} /></label>
        </div><button disabled={!tenantId}>Create group</button>
      </form>
      <form className="console-card" onSubmit={addItem}><h2>Add evidence to a document</h2>
        <div className="console-form">{docPicker}
          <label>Group<select value={groupId} onChange={(e) => setGroupId(e.target.value)}>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
          <label>Type<select value={item.kind} onChange={(e) => setItem({ ...item, kind: e.target.value })}>{["statute", "case", "regulation", "study", "dataset", "report", "news", "thesis", "other"].map((k) => <option key={k}>{k}</option>)}</select></label>
          <label>Title<input required value={item.title} onChange={(e) => setItem({ ...item, title: e.target.value })} /></label>
          <label>Source link (https)<input type="url" required value={item.url} onChange={(e) => setItem({ ...item, url: e.target.value })} /></label>
          <label>Authors<input value={item.authors} onChange={(e) => setItem({ ...item, authors: e.target.value })} /></label>
          <label>Summary (concise)<textarea required maxLength={1000} value={item.summary} onChange={(e) => setItem({ ...item, summary: e.target.value })} /></label>
        </div><button disabled={!groupId || !documentId}>Add evidence</button>
        <Status>{status}</Status>
      </form>
      {evidence && <section className="console-card"><h2>Evidence on this document</h2><p>{evidence.notice}</p>
        <ul>{evidence.items.map((e) => <li key={e.id}><a href={e.url} rel="noopener noreferrer">{e.title}</a> — {e.summary} <small>({e.group.name}; {e.group.affiliationDisclosure})</small></li>)}</ul></section>}
    </>
  );
}

export function ParticipationPage() {
  const { tenantId, picker } = useWorkspaces();
  const { documentId, picker: docPicker } = useDocumentPicker(tenantId);
  const [data, setData] = useState(null);
  const [trust, setTrust] = useState(null);
  useEffect(() => { api("/api/civic/trust").then(setTrust).catch(() => {}); }, []);
  useEffect(() => { if (documentId) api("/api/public/civic/documents/" + documentId + "/analytics").then(setData).catch(() => setData(null)); }, [documentId]);
  return (
    <>
      {trust && <section className="console-card"><h2>Your participation tier</h2><p><span className="console-pill">{trust.label}</span> {trust.claim}</p></section>}
      <section className="console-card"><h2>Participation on a document</h2>
        <div className="console-form">{picker}{docPicker}</div>
        {data && <>
          <dl className="console-facts">
            <dt>Proposed changes</dt><dd>{data.proposals}</dd>
            <dt>Arguments</dt><dd>{data.points}</dd>
            <dt>Argument votes</dt><dd>{data.pointVotes}</dd>
            <dt>Contributing accounts</dt><dd>{data.contributors}</dd>
            <dt>Verification coverage</dt><dd>{data.verificationCoverage.verified} of {data.verificationCoverage.of} {data.verificationCoverage.denominator}</dd>
          </dl>
          {data.decisions.map((d) => <p key={d.proposalId}>Decision {d.proposalId.slice(0, 8)}: {d.status} · {d.turnout.participating} of {d.turnout.eligible} ({d.turnout.denominator})</p>)}
          <p className="console-notice">{data.caveat}</p>
        </>}
      </section>
    </>
  );
}

export function HandoffPage() {
  const { tenantId, picker } = useWorkspaces();
  const { documentId, picker: docPicker } = useDocumentPicker(tenantId);
  return (
    <section className="console-card"><h2>Sponsor handoff package</h2>
      <p>A downloadable package with the bill text, every public proposal and your response, participation figures with their denominators, and links for independent verification. Community processes on CivicQuill do not introduce, pass or enact legislation.</p>
      <div className="console-form">{picker}{docPicker}</div>
      {documentId && tenantId && <p>
        <a className="governance-action" href={"/api/workspaces/" + tenantId + "/civic/documents/" + documentId + "/handoff"}>Download handoff package (JSON)</a>{" "}
        <a href={"/api/public/documents/" + documentId + "/verification-package"}>Download verification package</a>
      </p>}
    </section>
  );
}

export const civicPages = [
  { path: "/civic/new-bill", title: "Draft a bill", nav: "Legislation", Component: NewBillPage, description: "Start from a federal, state or local template with explicit numbering and reference rules." },
  { path: "/civic/consultations", title: "Public-input consultations", nav: "Legislation", Component: ConsultationsPage, description: "Respond to every proposal while the source text stays fixed." },
  { path: "/civic/research", title: "Research and evidence", nav: "Legislation", Component: ResearchPage },
  { path: "/civic/participation", title: "Participation", nav: "Legislation", Component: ParticipationPage },
  { path: "/civic/handoff", title: "Sponsor handoff", nav: "Legislation", Component: HandoffPage },
  { path: "/civic/officials", title: "Elected officials", nav: "Accounts", Component: OfficialsPage },
  { path: "/civic/review", title: "Verification review", nav: "Administration", Component: ReviewPage },
];
