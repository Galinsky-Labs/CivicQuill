// CivicQuill commercial defaults, expressed as data for the engine's settings
// registry and entitlement engine. Prices are configurable, never hard-coded
// into authorization; readers, discussants and voters never pay.
export const CIVIC_SETTINGS_DEFAULTS = Object.freeze({
  "quota.weeklyFreeDocuments": 1,
  "quota.timezone": "America/New_York",
  "officials.grant": "unlimited",
  "officials.monthlyCap": null,
  "documents.defaultMode": "collaboration",
  "anchoring.enabled": true,
  "votes.defaultWeighting": "equal",
  "participation.requiresSubscription": false,
});

export const CIVIC_CATALOG = Object.freeze([
  { id: "civic-creator-monthly", kind: "subscription", interval: "month", resource: "document-create", quantity: null, label: "Creator — unlimited drafts" },
  { id: "civic-single-document", kind: "single-document", resource: "document-create", quantity: 1, label: "One additional draft" },
  { id: "civic-credits-10", kind: "credit-pack", resource: "document-create", quantity: 10, label: "Ten draft credits" },
]);
