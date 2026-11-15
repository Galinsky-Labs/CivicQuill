// Participation trust tiers, tally labels, sponsor responses and civic
// analytics. These describe who took part; none of it changes vote weight.
export const TRUST_TIERS = Object.freeze({
  account: { rank: 0, label: "Signed-in account", claim: "An authenticated account. Not proof of a unique person." },
  "email-verified": { rank: 1, label: "Verified email", claim: "Controls a verified email address. Not proof of a unique person." },
  "verified-person": { rank: 2, label: "Verified person", claim: "Passed an identity check by the configured verifier; duplicate person checks apply." },
  constituent: { rank: 3, label: "Verified constituent", claim: "Verified person with evidence of residence in the stated jurisdiction at the record date." },
});
export const tierRank = (tier) => {
  const entry = TRUST_TIERS[tier];
  if (!entry) throw new Error("Unknown trust tier");
  return entry.rank;
};

/**
 * Every published tally carries this label. Exploratory polls are never
 * described as representative or official elections.
 */
export function tallyLabel({ electorate, minimumTier = "account", eligible, participating, verified }) {
  for (const n of [eligible, participating, verified]) if (!Number.isSafeInteger(n) || n < 0) throw new Error("Invalid tally counts");
  if (participating > eligible || verified > participating) throw new Error("Inconsistent tally counts");
  const kind = { workspace: "Workspace members", roster: "Frozen roster", cohort: "Verified cohort", public: "Open public participants" }[electorate];
  if (!kind) throw new Error("Unknown electorate kind");
  return {
    electorate: kind,
    minimumTier: TRUST_TIERS[minimumTier]?.label ?? (() => { throw new Error("Unknown trust tier"); })(),
    turnout: `${participating} of ${eligible} eligible`,
    verificationCoverage: participating ? `${verified} of ${participating} participants at or above “${TRUST_TIERS["verified-person"].label}”` : "No participants",
    representativeness: "Not a scientific sample and not an official election. Results describe only the participants shown.",
    officialStatus: "Community governance result; it does not introduce, pass or enact legislation.",
  };
}

export const RESPONSE_KINDS = Object.freeze({
  incorporated: "Incorporated into a revised consultation edition",
  "partially-incorporated": "Partly incorporated",
  declined: "Declined",
  noted: "Noted for later consideration",
  deferred: "Deferred pending more information",
});

/** Disposition report: what the sponsor did with every public-input proposal. */
export function dispositionReport({ document, proposals, responses, decisions = [] }) {
  const latest = new Map();
  for (const r of responses) {
    if (!RESPONSE_KINDS[r.kind]) throw new Error("Unknown sponsor response");
    const prior = latest.get(r.proposalId);
    if (!prior || r.version > prior.version) latest.set(r.proposalId, r);
  }
  const outcomes = new Map(decisions.map((d) => [d.proposalId, d]));
  const rows = proposals.map((p) => {
    const response = latest.get(p.id);
    const decision = outcomes.get(p.id);
    return {
      proposalId: p.id, quote: p.quote, replacement: p.replacement, rationale: p.rationale,
      advisoryVote: decision ? { yes: decision.yes, no: decision.no, abstain: decision.abstain, status: decision.status } : null,
      response: response ? { kind: response.kind, label: RESPONSE_KINDS[response.kind], explanation: response.explanation, respondedAt: response.createdAt } : null,
    };
  });
  const counts = Object.fromEntries(Object.keys(RESPONSE_KINDS).map((k) => [k, rows.filter((r) => r.response?.kind === k).length]));
  return {
    schema: "civicquill-disposition-report-v1",
    documentId: document.id, title: document.title, sourceVersion: document.version, sourceDigest: document.digest,
    totals: { proposals: rows.length, answered: rows.filter((r) => r.response).length, unanswered: rows.filter((r) => !r.response).length, ...counts },
    rows,
    statement: "The source edition of this consultation never changed. Responses are the sponsor's account of how public input was handled.",
  };
}

/** Participation analytics with every denominator named. */
export function participationSummary({ proposals, points, pointVotes, decisions, contributors, verifiedContributors }) {
  for (const n of [proposals, points, pointVotes, contributors, verifiedContributors]) if (!Number.isSafeInteger(n) || n < 0) throw new Error("Invalid analytics count");
  return {
    proposals, points, pointVotes, contributors,
    verificationCoverage: { verified: verifiedContributors, of: contributors, denominator: "distinct contributing accounts" },
    decisions: decisions.map((d) => ({
      proposalId: d.proposalId, status: d.status,
      turnout: { participating: d.participating, eligible: d.eligible, denominator: "frozen electorate at opening" },
    })),
    caveat: "Counts of accounts and activity, not a measure of public opinion.",
  };
}
