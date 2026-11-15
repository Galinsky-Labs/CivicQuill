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

/**
 * LEG-010: CivicQuill defaults expressed as the engine's settings keys, for a
 * platform administrator to apply at the `product: civic` scope. The keys
 * above are the public catalog's descriptive names; these are authoritative.
 */
export const CIVIC_ENGINE_SETTINGS = Object.freeze({
  "quotas.weeklyFreeDocuments": CIVIC_SETTINGS_DEFAULTS["quota.weeklyFreeDocuments"],
  "quotas.weekTimeZone": CIVIC_SETTINGS_DEFAULTS["quota.timezone"],
  "officials.grantPolicy": Object.freeze({ mode: "unlimited" }),
});

const CURRENCY = /^[A-Z]{3}$/;
/**
 * Builds engine `billing.catalog` items from the civic plans and an explicit
 * price table. Prices are owner decisions and are never defaulted here: a
 * plan without a positive price is left out, so purchases stay off until the
 * owner sets one.
 */
export function civicBillingCatalog(prices = {}) {
  const items = [];
  for (const plan of CIVIC_CATALOG) {
    const price = prices[plan.id];
    if (price === undefined) continue;
    if (!price || !CURRENCY.test(price.currency ?? "") || !Number.isSafeInteger(price.amountMinor) || price.amountMinor < 1) throw new Error("Invalid price for " + plan.id);
    const item = { id: plan.id, kind: plan.kind, label: plan.label.slice(0, 80), price: { currency: price.currency, amountMinor: price.amountMinor } };
    if (plan.kind === "subscription") Object.assign(item, { interval: plan.interval, unlimited: true });
    if (plan.kind === "credit-pack") item.quantity = plan.quantity;
    items.push(item);
  }
  return items;
}

/** Settings changes an administrator applies at `{scope:"product",product:"civic"}`. */
export const civicProductSettings = (prices) => ({ ...CIVIC_ENGINE_SETTINGS, "billing.catalog": civicBillingCatalog(prices) });
