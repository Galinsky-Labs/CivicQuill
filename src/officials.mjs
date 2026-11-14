// Verified elected-official accounts and legislative-purpose grants.
// Verification is a reviewed claim about an office and term; it is never a
// public disclosure of the private evidence used to verify it.
export const OFFICE_LEVELS = Object.freeze(["federal", "state", "local"]);
export const OFFICE_ROLES = Object.freeze(["elected-official", "authorized-staff"]);

const text = (value, max, name) => {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("Invalid " + name);
  return value.trim();
};
const day = (value, name) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value + "T00:00:00Z"))) throw new Error("Invalid " + name);
  return value;
};

export function validateOfficialRequest(input) {
  const level = OFFICE_LEVELS.includes(input.level) ? input.level : (() => { throw new Error("Invalid office level"); })();
  const role = OFFICE_ROLES.includes(input.role) ? input.role : (() => { throw new Error("Invalid office role"); })();
  const termStart = day(input.termStart, "term start"), termEnd = day(input.termEnd, "term end");
  if (termEnd <= termStart) throw new Error("Term must end after it starts");
  const evidenceUrl = text(input.evidenceUrl, 500, "evidence link");
  const url = new URL(evidenceUrl);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Evidence link must be an https URL");
  return {
    level, role,
    jurisdiction: text(input.jurisdiction, 200, "jurisdiction"),
    office: text(input.office, 200, "office"),
    district: input.district ? text(input.district, 120, "district") : null,
    principalName: role === "authorized-staff" ? text(input.principalName, 200, "principal official") : null,
    termStart, termEnd, evidenceUrl: url.href,
    publicBadge: input.publicBadge === true,
  };
}

/**
 * Grant derived from an approved verification. Unlimited by default; a cap
 * only produces an explicit paid offer when exceeded — never a charge.
 */
export function officialGrant(request, { unlimited = true, monthlyCap = null } = {}) {
  if (!unlimited && !(Number.isSafeInteger(monthlyCap) && monthlyCap > 0)) throw new Error("A capped official grant needs a positive monthly cap");
  return {
    resource: "document-create",
    unlimited,
    monthlyCap: unlimited ? null : monthlyCap,
    purpose: "legislative work for " + request.office + ", " + request.jurisdiction,
    effectiveFrom: request.termStart,
    expiresAt: request.termEnd + "T23:59:59Z",
    overCapBehaviour: "explicit-paid-offer",
  };
}

export const officialStatus = (row, now = Date.now()) =>
  row.status === "approved" && Date.parse(row.termEnd + "T23:59:59Z") < now ? "expired" : row.status;
