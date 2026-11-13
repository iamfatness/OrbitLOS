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
  title: "Fictional Colorado mortgage advertising", channel: "Website", audience: "Fictional Colorado audience",
  creative: { kind: "Text", copy: "Fictional mortgage advertising." }, reviewedOn: "2026-01-01",
  zone: "America/Denver", scopeReference: "Fictional campaign scope", mortgageScope: "First mortgage",
  creditType: "Closed-end", specificTerms: "No", originatorAdvertising: "Unresolved", originators: [],
  stateClaims: supported, regulationZ: supported, regulationN: supported,
  archive: { applies: "No", scopeReference: "Fictional federal archive review" },
  distribution: { firstOn: "2026-01-02", finalOn: "2026-02-02", reference: "Fictional publication history" },
  stateEvidence: { jurisdiction: "CO", coverage: "In scope", scopeReference: "Fictional Colorado scope",
    identification: "Required", responsibleParty: supported, companyName: supported,
    productTerms: supported, affiliation: supported, nontraditional: supported, archive: supported },
};

function review(input) {
  return evaluateAdvertising("CO", advertisingFacts.parse(input), "", "2026-11-12");
}

test("Colorado reviews the business phone independently of the responsible party and company name", () => {
  const result = review(facts);
  assert.deepEqual(result.findings.map(item => item.code), ["co-phone"]);
  assert.equal(result.stateArchiveReviewDate, "2030-02-02");
});

test("Colorado identification exceptions leave claim and archive evidence in scope", () => {
  const exempt = { ...facts, stateEvidence: { ...facts.stateEvidence, identification: "Commercial rate sheet exception",
    productTerms: undefined, archive: undefined } };
  assert.deepEqual(review(exempt).findings.map(item => item.code), ["co-identification-exception", "co-product-terms", "state-archive"]);
  exempt.stateEvidence.exceptionReference = "Fictional restricted distribution list";
  assert.deepEqual(review(exempt).findings.map(item => item.code), ["co-product-terms", "state-archive"]);
});
