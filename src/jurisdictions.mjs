// Jurisdiction profiles: drafting conventions only. Selecting a profile never
// implies that a bill was introduced, filed or enacted anywhere.
const freeze = (value) => { Object.freeze(value); for (const v of Object.values(value)) if (v && typeof v === "object") freeze(v); return value; };

export const JURISDICTIONS = freeze({
  "us-federal": {
    id: "us-federal", level: "federal", name: "United States (federal)",
    numberingProfile: "us-federal-v1",
    instrument: "bill", instrumentLabel: "A BILL",
    titleFormat: "To {purpose}.",
    enactingClause: "Be it enacted by the Senate and House of Representatives of the United States of America in Congress assembled,",
    sectionLabel: "SEC.", shortTitleText: "This Act may be cited as the “{shortTitle}”.",
    references: "Cite sections as “section N of this Act”.",
  },
  "us-state": {
    id: "us-state", level: "state", name: "U.S. state legislature (generic)",
    numberingProfile: "us-federal-v1",
    instrument: "bill", instrumentLabel: "AN ACT",
    titleFormat: "An Act to {purpose}.",
    enactingClause: "Be it enacted by the Legislature of the State of {state}:",
    sectionLabel: "Section", shortTitleText: "This Act shall be known and may be cited as the “{shortTitle}”.",
    references: "State style manuals differ; confirm citation form with the legislative drafting office.",
  },
  "us-local": {
    id: "us-local", level: "local", name: "U.S. city or county (ordinance)",
    numberingProfile: "decimal-v1",
    instrument: "ordinance", instrumentLabel: "AN ORDINANCE",
    titleFormat: "An Ordinance to {purpose}.",
    enactingClause: "Be it ordained by the {body} of {locality}:",
    sectionLabel: "Section", shortTitleText: "This Ordinance may be cited as the “{shortTitle}”.",
    references: "Cite as “Section N of this Ordinance”.",
  },
});

export function jurisdiction(id) {
  const profile = JURISDICTIONS[id];
  if (!profile) throw new Error("Unknown jurisdiction profile");
  return profile;
}

/** Fills {placeholders}; unknown or missing values fail rather than leaking braces. */
export function fill(template, values) {
  return template.replace(/\{([a-zA-Z]+)\}/g, (_, key) => {
    const value = values[key];
    if (typeof value !== "string" || !value.trim()) throw new Error("Missing template value: " + key);
    return value.trim();
  });
}
