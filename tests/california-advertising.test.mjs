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
const supported = { result: "Supported", reference: "Fictional California advertising workpaper" };
const facts = {
  title: "Fictional California mortgage advertising", channel: "Social media", audience: "Fictional California audience",
  creative: { kind: "Text", copy: "Fictional mortgage advertising." }, reviewedOn: "2026-01-01",
  zone: "America/Los_Angeles", scopeReference: "Fictional campaign scope", mortgageScope: "First mortgage",
  creditType: "Closed-end", specificTerms: "No", originatorAdvertising: "Unresolved", originators: [],
  stateClaims: supported, regulationZ: supported, regulationN: supported,
  archive: { applies: "No", scopeReference: "Fictional federal archive review" },
  distribution: { firstOn: "2026-01-02", finalOn: "2026-02-02", reference: "Fictional publication history" },
};

function review(route, channel = facts.channel) {
  const stateEvidence = { jurisdiction: "CA", coverage: "In scope", scopeReference: "Fictional California authority",
    productDisclosures: supported, archive: supported, route };
  return evaluateAdvertising("CA", advertisingFacts.parse({ ...facts, stateEvidence, channel }), "", "2026-11-12");
}

test("California DRE review separates investor solicitations from borrower identifier checks", () => {
  const route = { authority: "DRE endorsement", purpose: "Borrower solicitation", dreIdentifiers: supported,
    phrasing: supported, presentation: supported, submission: supported };
  assert.deepEqual(review(route).findings.map(item => item.code), ["ca-nmls"]);
  assert.deepEqual(review({ ...route, purpose: "Investor solicitation" }).findings, []);
});

test("California CFL linked disclosures require a qualifying platform and retain the archive date", () => {
  const route = { authority: "California Financing Law", placement: "Character-limited platform",
    characterLimit: 300, advertiserIdentity: supported, broadcast: "No" };
  assert.deepEqual(review(route).findings.map(item => item.code), ["ca-cfl-link"]);
  const complete = { ...route, linkedDisclosure: supported };
  assert.deepEqual(review(complete).findings, []);
  assert.equal(review(complete).stateArchiveReviewDate, "2028-02-02");
  assert.deepEqual(review(complete, "Print").findings.map(item => item.code), ["ca-cfl-limit"]);
  assert.throws(() => review({ ...complete, characterLimit: 301 }));
});

test("California CRMLA keeps regulator and originator checks separate from the CFL archive date", () => {
  const result = review({ authority: "CRMLA", identifiesOriginator: "Yes", phrasing: supported,
    advertiserIdentity: supported, regulatorClaims: { ...supported, result: "Concern" } });
  assert.deepEqual(result.findings.map(item => item.code), ["ca-nmls", "ca-crmla-regulator"]);
  assert.equal(result.stateArchiveReviewDate, undefined);
});
