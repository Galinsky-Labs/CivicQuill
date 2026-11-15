// Research contributions: evidence collections with citation provenance and
// disclosed academic affiliations. Affiliation aids discovery only.
export const GROUP_KINDS = Object.freeze(["class", "thesis", "project", "lab"]);
export const EVIDENCE_KINDS = Object.freeze(["statute", "case", "regulation", "study", "dataset", "report", "news", "thesis", "other"]);

const text = (value, max, name, optional = false) => {
  if (optional && (value === undefined || value === null || value === "")) return null;
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("Invalid " + name);
  return value.trim();
};

export function validateGroup(input) {
  if (!GROUP_KINDS.includes(input.kind)) throw new Error("Invalid group kind");
  return {
    kind: input.kind,
    name: text(input.name, 200, "group name"),
    institution: text(input.institution, 200, "institution", true),
    affiliationDisclosure: text(input.affiliationDisclosure, 1000, "affiliation disclosure"),
    fundingDisclosure: text(input.fundingDisclosure, 1000, "funding disclosure", true),
  };
}

export function validateEvidence(input) {
  if (!EVIDENCE_KINDS.includes(input.kind)) throw new Error("Invalid evidence kind");
  const url = new URL(text(input.url, 2000, "source link"));
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Source must be an https link");
  const published = input.publishedOn ? text(input.publishedOn, 10, "publication date") : null;
  if (published && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(published)) throw new Error("Invalid publication date");
  return {
    kind: input.kind,
    title: text(input.title, 500, "title"),
    url: url.href,
    authors: text(input.authors, 500, "authors", true),
    publisher: text(input.publisher, 300, "publisher", true),
    publishedOn: published,
    pinpoint: text(input.pinpoint, 200, "pinpoint", true),
    summary: text(input.summary, 1000, "summary"),
    quote: text(input.quote, 2000, "quoted passage", true),
  };
}

/** Citation string in a neutral, consistent format. */
export function formatCitation(e) {
  return [e.authors, e.title, e.publisher, e.publishedOn, e.pinpoint].filter(Boolean).join(", ") + ". " + e.url;
}
