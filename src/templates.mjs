// Legislative document templates built on the engine's semantic schema. All
// generated language is an editable starting point for a community draft.
import { validateLegalDocument, LEGAL_SCHEMA_VERSION } from "@distributed-governance/engine/legal-structure";
import { jurisdiction, fill } from "./jurisdictions.mjs";

export const TEMPLATE_PARTS = Object.freeze(["shortTitle", "findings", "definitions", "operative", "severability", "effectiveDate", "fiscalNote", "exhibit"]);
const LIMIT = 4000;

const clean = (value, max = LIMIT) => {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))
    throw new Error("Invalid template text");
  return value.trim();
};
const paragraph = (id, text) => ({ kind: "paragraph", id, inlines: [{ kind: "text", text }] });

/**
 * @param input.parts subset of TEMPLATE_PARTS (order is fixed by convention)
 * @param input.values purpose, shortTitle, state, body, locality, findings[],
 *   definitions[{term, meaning}], operative[], effectiveDate, fiscalNote, exhibitTitle
 */
export function buildBill({ id, tenantId, jurisdictionId, title, parts = ["shortTitle", "operative", "effectiveDate"], values = {}, locale = "en-US" }) {
  const profile = jurisdiction(jurisdictionId);
  const unknown = parts.filter((p) => !TEMPLATE_PARTS.includes(p));
  if (unknown.length || new Set(parts).size !== parts.length) throw new Error("Unknown or repeated template part");
  if (!parts.includes("operative")) throw new Error("A bill needs at least one operative section");
  let counter = 0;
  const nid = (kind) => `${id}:${kind}${++counter}`;
  const section = (heading, children) => ({ kind: "section", id: nid("s"), title: heading, children });
  const content = [];
  content.push(paragraph(nid("p"), profile.instrumentLabel));
  content.push(paragraph(nid("p"), fill(profile.titleFormat, { purpose: clean(values.purpose, 1000) })));
  const clauseValues = { state: clean(values.state, 200) || undefined, body: clean(values.body, 200) || undefined, locality: clean(values.locality, 200) || undefined };
  content.push(paragraph(nid("p"), fill(profile.enactingClause, clauseValues)));

  for (const part of TEMPLATE_PARTS.filter((p) => parts.includes(p))) {
    if (part === "shortTitle")
      content.push(section("Short title", [paragraph(nid("p"), fill(profile.shortTitleText, { shortTitle: clean(values.shortTitle, 300) }))]));
    if (part === "findings") {
      const findings = (values.findings ?? []).map((f) => clean(f)).filter(Boolean);
      content.push(section("Findings", findings.length
        ? [paragraph(nid("p"), "The legislative body finds the following:"), ...findings.map((f) => section("", [paragraph(nid("p"), f)]))]
        : [paragraph(nid("p"), "[Describe the findings that support this legislation.]")]));
    }
    if (part === "definitions") {
      const definitions = (values.definitions ?? []).filter((d) => d && clean(d.term, 200));
      content.push(section("Definitions", [
        paragraph(nid("p"), "In this " + profile.instrument + ":"),
        ...(definitions.length
          ? definitions.map((d) => ({ kind: "definition", id: nid("d"), term: clean(d.term, 200), inlines: [{ kind: "text", text: clean(d.meaning) }] }))
          : [{ kind: "definition", id: nid("d"), term: "[Term]", inlines: [{ kind: "text", text: "[Meaning]" }] }]),
      ]));
    }
    if (part === "operative") {
      const provisions = (values.operative ?? []).map((o) => clean(o)).filter(Boolean);
      content.push(section("Requirements", provisions.length
        ? provisions.map((text) => paragraph(nid("p"), text))
        : [paragraph(nid("p"), "[State what this " + profile.instrument + " requires, permits or prohibits.]")]));
    }
    if (part === "severability")
      content.push(section("Severability", [paragraph(nid("p"),
        "If any provision of this " + profile.instrument + ", or its application to any person or circumstance, is held invalid, the remainder of this " + profile.instrument + " and the application of the provision to other persons or circumstances shall not be affected.")]));
    if (part === "effectiveDate")
      content.push(section("Effective date", [paragraph(nid("p"),
        clean(values.effectiveDate, 300) || "This " + profile.instrument + " shall take effect on the date of its enactment.")]));
    if (part === "fiscalNote")
      content.push(section("Fiscal note", [paragraph(nid("p"),
        clean(values.fiscalNote) || "[Estimated costs, revenue effects and sources. A community fiscal note is not an official fiscal estimate.]")]));
    if (part === "exhibit")
      content.push({ kind: "exhibit", id: nid("x"), title: clean(values.exhibitTitle, 300) || "Exhibit A", children: [paragraph(nid("p"), "[Attach supporting material.]")] });
  }
  return validateLegalDocument({
    schemaVersion: LEGAL_SCHEMA_VERSION, id, tenantId, mode: "collaboration", lifecycle: "draft", revision: 0,
    metadata: { title: clean(title, 1000) || "Untitled community draft", locale, numberingProfile: profile.numberingProfile },
    content,
  });
}
