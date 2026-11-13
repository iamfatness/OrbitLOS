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
const supported = { result: "Supported", reference: "Fictional verified campaign workpaper" };
const facts = {
  title: "Fictional Texas advertising", channel: "Website", audience: "Fictional Texas audience",
  creative: { kind: "Text", copy: "Fictional website placement." }, reviewedOn: "2026-10-01",
  zone: "America/Denver", scopeReference: "Fictional review scope", mortgageScope: "First mortgage",
  creditType: "Closed-end", specificTerms: "No", originatorAdvertising: "No", originators: [],
  sponsoringCompanyDisplayed: "1234", stateClaims: supported, regulationZ: supported, regulationN: supported,
  archive: { applies: "Yes", scopeReference: "Fictional archive review", materials: "Fictional campaign copy",
    availableProducts: "Fictional mortgage catalog", additionalProducts: "Fictional product catalog" },
  stateEvidence: { jurisdiction: "TX", coverage: "In scope", scopeReference: "Fictional Texas authority",
    authority: "Mortgage company", companyName: supported, companyIdentifier: supported, companyWebsite: "Yes",
    websiteAddress: supported, teamBranding: "No" },
};

function review(input) {
  return evaluateAdvertising("TX", advertisingFacts.parse(input), "1234", "2026-11-12");
}

test("Texas company website review requires complaint notice and archived publication evidence", () => {
  const distributed = { ...facts, distribution: { firstOn: "2026-10-02", reference: "Fictional release history" } };
  assert.deepEqual(review(distributed).findings.map(item => item.code), ["texas-complaint-notice", "state-archive"]);
  const complete = { ...distributed, stateEvidence: { ...facts.stateEvidence, complaintNotice: supported, archive: supported } };
  assert.deepEqual(review(complete).findings, []);
});

test("Texas social profile and prior-rule reviews follow the recorded scope", () => {
  const social = { ...facts, channel: "Social media", originatorAdvertising: "Yes",
    stateEvidence: { ...facts.stateEvidence, authority: "Mortgage banker", socialPlacement: "On the profile",
      teamBranding: "Yes", teamLinkage: { result: "Concern", reference: "Fictional team branding screen" } } };
  const current = review(social);
  assert.deepEqual(current.findings.map(item => item.code), ["originator-list", "texas-profile-prominence", "texas-team-linkage"]);
  assert.match(current.sources[0].label, /57\.203/);
  const older = review({ ...social, distribution: { firstOn: "2024-11-22", reference: "Fictional initial placement" } });
  assert.deepEqual(older.findings.map(item => item.code), ["texas-prior-rule", "review-after-use"]);
  const outside = review({ ...social, stateEvidence: { ...social.stateEvidence, coverage: "Outside scope" } });
  assert.deepEqual(outside.findings, []);
});
