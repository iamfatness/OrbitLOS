import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (error.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith("./")) throw error;
      return next(specifier + ".ts", context);
    }
  },
});

const { advertisingFacts, evaluateAdvertising } = await import("../src/lib/advertising-review-model.ts");
const supported = { result: "Supported", reference: "Fictional advertising workpaper" };
const facts = {
  title: "Fictional New York mortgage advertising", channel: "Website", audience: "Fictional New York audience",
  creative: { kind: "Text", copy: "Fictional mortgage advertising." }, reviewedOn: "2026-01-01",
  zone: "America/New_York", scopeReference: "Fictional campaign scope", mortgageScope: "First mortgage",
  creditType: "Closed-end", specificTerms: "No", originatorAdvertising: "Unresolved", originators: [],
  stateClaims: supported, regulationZ: supported, regulationN: supported,
  archive: { applies: "No", scopeReference: "Fictional federal archive review" },
  stateEvidence: { jurisdiction: "NY", coverage: "In scope", scopeReference: "Fictional New York authority",
    authority: "Registered broker", placement: "Print or electronic", legend: supported, officeDisclosure: supported,
    advertisesProduct: "Yes", creditLimitations: supported, rateNotice: supported, prepaymentPenalty: supported,
    fundingImpression: { result: "Concern", reference: "Fictional impression of direct funding" } },
};

function review(input) {
  return evaluateAdvertising("NY", advertisingFacts.parse(input), "", "2026-11-12");
}

test("New York review checks broker role and product availability independently of specific terms", () => {
  const result = review(facts);
  assert.deepEqual(result.findings.map(item => item.code), ["ny-third-party", "ny-funding", "state-terms"]);
});

test("New York applies the banker legend and keeps archive evidence separate from office and broker checks", () => {
  const result = review({ ...facts, channel: "Audio or video",
    distribution: { firstOn: "2026-01-02", finalOn: "2026-02-02", reference: "Fictional distribution" },
    stateEvidence: { ...facts.stateEvidence, authority: "Licensed banker", placement: "Other media",
      legend: undefined, officeDisclosure: undefined, advertisesProduct: "No" } });
  assert.deepEqual(result.findings.map(item => item.code), ["ny-legend", "state-archive"]);
  assert.equal(result.stateArchiveReviewDate, "2028-02-02");
});
