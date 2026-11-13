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
const supported = { result: "Supported", reference: "Fictional verified advertising workpaper" };
const facts = {
  title: "Fictional Florida radio advertisement", channel: "Audio or video", audience: "Fictional Florida audience",
  creative: { kind: "Text", copy: "Fictional commercial script." }, reviewedOn: "2024-01-01",
  zone: "America/Chicago", scopeReference: "Fictional review scope", mortgageScope: "First mortgage",
  creditType: "Closed-end", specificTerms: "Yes", originatorAdvertising: "Unresolved", originators: [],
  stateClaims: supported, stateTerms: supported, regulationZ: supported, regulationN: supported,
  archive: { applies: "Yes", scopeReference: "Fictional archive review", materials: "Fictional campaign copy",
    availableProducts: "Fictional mortgage catalog", additionalProducts: "Fictional product catalog" },
  stateEvidence: { jurisdiction: "FL", coverage: "In scope", scopeReference: "Fictional Florida license",
    unqualifiedCredit: "Yes", expressedRate: "Yes", federalAgencyNames: supported,
    chapterLicense: "Yes", sampleArchive: supported, radioTelevision: "Yes" },
};

function review(input) {
  return evaluateAdvertising("FL", advertisingFacts.parse(input), "", "2026-11-12");
}

test("Florida reviews material limitations, the stated rate notice and broadcast scripts independently", () => {
  const distributed = { ...facts, distribution: { firstOn: "2024-01-02", finalOn: "2024-02-20", reference: "Fictional air dates" } };
  const result = review(distributed);
  assert.deepEqual(result.findings.map(item => item.code), ["fl-material-limits", "fl-rate-notice", "fl-broadcast-scripts"]);
  assert.equal(result.stateArchiveReviewDate, "2026-02-20");
  const complete = { ...distributed, stateEvidence: { ...facts.stateEvidence,
    materialLimits: supported, rateNotice: supported, broadcastScripts: supported } };
  assert.deepEqual(review(complete).findings, []);
});

test("Florida leaves the archive anniversary open for a leap-day broadcast and flags conflicting rate scope", () => {
  const result = review({ ...facts, specificTerms: "No", stateTerms: undefined,
    distribution: { firstOn: "2024-01-02", finalOn: "2024-02-29", reference: "Fictional leap-day air date" },
    stateEvidence: { ...facts.stateEvidence, unqualifiedCredit: "No", rateNotice: supported, broadcastScripts: supported } });
  assert.deepEqual(result.findings.map(item => item.code), ["fl-rate-scope", "state-terms", "fl-archive-anniversary", "archive-anniversary"]);
  assert.equal(result.stateArchiveReviewDate, undefined);
});
