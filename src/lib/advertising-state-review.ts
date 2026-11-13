import { z } from "zod";
import type { AdvertisingFacts, AdvertisingFinding } from "./advertising-review-model";
import { shiftReportDate } from "./report-date-range";

const reference = z.string().trim().min(4).max(300);
const date = z.iso.date().refine(value => value >= "1900-01-01" && value <= "9990-12-31");
const choice = z.enum(["Yes", "No", "Unresolved"]);
const assessment = z.strictObject({ result: z.enum(["Supported", "Concern"]), reference });
const scope = {
  coverage: z.enum(["In scope", "Outside scope", "Unresolved"]),
  scopeReference: reference.optional(),
};

export const texasAdvertisingAuthorities = ["Unresolved", "Mortgage company", "Mortgage banker"] as const;

export const coloradoAdIdentification = ["Unresolved", "Required", "Promotional item exception", "Commercial rate sheet exception"] as const;
export const coloradoAdIdentityChecks = [
  ["responsibleParty", "Responsible party and NMLS ID"],
  ["companyName", "Mortgage company name"],
  ["businessPhone", "Responsible party business phone"],
] as const;
export const coloradoAdContentChecks = [
  ["productTerms", "Available products, terms and limitations"],
  ["affiliation", "Government, lender or servicer affiliation"],
  ["nontraditional", "Nontraditional mortgage product risk review"],
] as const;

export const californiaAdvertisingRoutes = ["Unresolved", "DRE endorsement", "California Financing Law", "CRMLA"] as const;
const californiaAdvertisingRoute = z.discriminatedUnion("authority", [
  z.strictObject({ authority: z.literal("Unresolved") }),
  z.strictObject({ authority: z.literal("DRE endorsement"),
    purpose: z.enum(["Unresolved", "Borrower solicitation", "Investor solicitation", "First contact only"]),
    dreIdentifiers: assessment.optional(), nmlsIdentifiers: assessment.optional(), phrasing: assessment.optional(),
    presentation: assessment.optional(), submission: assessment.optional() }),
  z.strictObject({ authority: z.literal("California Financing Law"),
    placement: z.enum(["Unresolved", "In the ad", "Character-limited platform"]),
    characterLimit: z.int().min(1).max(300).optional(), linkedDisclosure: assessment.optional(),
    identifier: assessment.optional(), phrasing: assessment.optional(), advertiserIdentity: assessment.optional(),
    broadcast: choice, broadcastArchive: assessment.optional() }),
  z.strictObject({ authority: z.literal("CRMLA"), identifiesOriginator: choice, identifier: assessment.optional(),
    phrasing: assessment.optional(), advertiserIdentity: assessment.optional(), regulatorClaims: assessment.optional() }),
]);
export type CaliforniaAdvertisingRoute = z.infer<typeof californiaAdvertisingRoute>;

export const stateAdvertisingEvidence = z.discriminatedUnion("jurisdiction", [
  z.strictObject({ jurisdiction: z.literal("CA"), ...scope, route: californiaAdvertisingRoute,
    productDisclosures: assessment.optional(), archive: assessment.optional() }),
  z.strictObject({ jurisdiction: z.literal("CO"), ...scope,
    identification: z.enum(coloradoAdIdentification), exceptionReference: reference.optional(),
    responsibleParty: assessment.optional(), companyName: assessment.optional(), businessPhone: assessment.optional(),
    productTerms: assessment.optional(), affiliation: assessment.optional(), nontraditional: assessment.optional(),
    archive: assessment.optional(),
  }),
  z.strictObject({ jurisdiction: z.literal("NY"), ...scope,
    authority: z.enum(["Unresolved", "Registered broker", "Licensed banker", "Exempt organization"]),
    placement: z.enum(["Unresolved", "Print or electronic", "Other media"]),
    legend: assessment.optional(), officeDisclosure: assessment.optional(),
    thirdPartyStatement: assessment.optional(), fundingImpression: assessment.optional(),
    advertisesProduct: choice, productAvailability: assessment.optional(),
    creditLimitations: assessment.optional(), rateNotice: assessment.optional(),
    prepaymentPenalty: assessment.optional(), archive: assessment.optional(),
  }),
  z.strictObject({ jurisdiction: z.literal("FL"), ...scope,
    unqualifiedCredit: choice, materialLimits: assessment.optional(),
    expressedRate: choice, rateNotice: assessment.optional(),
    federalAgencyNames: assessment.optional(),
    chapterLicense: choice, sampleArchive: assessment.optional(),
    radioTelevision: choice, broadcastScripts: assessment.optional(),
  }),
  z.strictObject({ jurisdiction: z.literal("TX"), ...scope,
    authority: z.enum(texasAdvertisingAuthorities),
    companyName: assessment.optional(), companyIdentifier: assessment.optional(),
    companyWebsite: choice, websiteAddress: assessment.optional(), complaintNotice: assessment.optional(),
    socialPlacement: z.enum(["In the advertisement", "On the profile", "Unresolved"]).optional(),
    profileProminence: assessment.optional(), teamBranding: choice, teamLinkage: assessment.optional(),
    archive: assessment.optional(),
  }),
  z.strictObject({ jurisdiction: z.literal("OH"), ...scope,
    companyName: assessment.optional(), officeAddress: assessment.optional(), companyIdentifier: assessment.optional(),
    archive: assessment.optional(),
    website: z.strictObject({ status: z.enum(["Current", "Update required", "Unresolved"]),
      outdatedOn: date.optional(), updatedOn: date.optional(), reference: reference.optional() }).optional(),
  }),
  z.strictObject({ jurisdiction: z.literal("IN"), ...scope,
    solicitation: choice,
    internetCommunication: choice,
    recipientCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    distributionReference: reference.optional(),
    archive: assessment.optional(),
  }),
  z.strictObject({ jurisdiction: z.literal("IL"), ...scope,
    companyIdentifier: assessment.optional(),
    placement: z.enum(["Electronic", "Print", "Unresolved"]),
    consumerAccess: assessment.extend({ result: z.enum(["Supported", "Concern", "Exempt"]) }).optional(),
    mixedActivity: choice,
    prominence: assessment.optional(),
  }),
  z.strictObject({ jurisdiction: z.literal("WI"), ...scope,
    companyName: assessment.optional(), companyIdentifier: assessment.optional(), affiliation: assessment.optional(),
  }),
]);

type StateEvidence = z.infer<typeof stateAdvertisingEvidence>;
type State = StateEvidence["jurisdiction"];
type Source = AdvertisingFinding["sources"][number];
const texasRules = {
  company: { label: "7 TAC §§56.200(c), 56.203–204", url: "https://www.sml.texas.gov/mortgage-origination/laws/" },
  banker: { label: "7 TAC §§57.200(c), 57.203–204", url: "https://www.sml.texas.gov/mortgage-origination/laws/" },
  adopted: { label: "Texas adoption and effective date", url: "https://www.sos.state.tx.us/texreg/pdf/backview/1115/1115adop.pdf" },
  exam: { label: "Texas SML common examination findings", url: "https://www.sml.texas.gov/wp-content/uploads/2025/09/rmlo_common_mortgage_exam_violations_v4.pdf" },
  forms: { label: "Texas SML website complaint notices", url: "https://www.sml.texas.gov/mortgage-origination/" },
};

const sourcesByState = {
  TX: texasRules,
  CA: {
    dre: { label: "California DRE mortgage advertising disclosure chart", url: "https://www.dre.ca.gov/files/pdf/forms/re858.pdf" },
    dreLaw: { label: "California DRE Real Estate Law", url: "https://www.dre.ca.gov/files/pdf/relaw/2026/relaw.pdf" },
    cfl: { label: "California Financing Law advertising rules", url: "https://dfpi.ca.gov/wp-content/uploads/sites/337/2021/08/PRO-02-17-Final-Text-of-Rules.pdf" },
    crmla: { label: "DFPI CRMLA approved regulations", url: "https://dfpi.ca.gov/rules-enforcement/laws-and-regulations/california-financing-law-regulations-opinions-releases/approved-regulations-california-residential-mortgage-lending-act/" },
  },
  CO: {
    rule: { label: "Colorado Board Rules 5.1 and 5.2", url: "https://www.sos.state.co.us/CCR/GenerateRulePdf.do?fileName=4+CCR+725-3&ruleVersionId=9222" },
    guidance: { label: "Colorado Division of Real Estate originator handbook", url: "https://dre.colorado.gov/sites/dre/files/documents/New%20MLO%20Handbook%202025.pdf" },
  },
  NY: {
    rule: { label: "3 NYCRR §38.2", url: "https://govt.westlaw.com/nycrr/Document/I4e4d65fdcd1711dda432a117e6e0f345" },
    broker: { label: "DFS mortgage broker advertising guidance", url: "https://www.dfs.ny.gov/industry_guidance/industry_letters/il19980827_mb_advertising" },
  },
  FL: {
    statute: { label: "Fla. Stat. §494.00165", url: "https://www.flsenate.gov/Laws/Statutes/2026/494.00165" },
    exam: { label: "Florida OFR disciplinary guidelines", url: "https://flrules.org/gateway/readRefFile.asp?refId=16453" },
  },
  OH: {
    statute: { label: "Ohio Rev. Code §1322.46", url: "https://codes.ohio.gov/ohio-revised-code/section-1322.46" },
    rule: { label: "Ohio Admin. Code 1301:8-7-07", url: "https://codes.ohio.gov/ohio-administrative-code/rule-1301:8-7-07" },
    archive: { label: "Ohio Admin. Code 1301:8-7-06", url: "https://codes.ohio.gov/ohio-administrative-code/rule-1301:8-7-06" },
  },
  IN: {
    statute: { label: "Ind. Code §23-2.5-8-5(4)", url: "https://iga.in.gov/ic/2026/Title_23.html#23-2.5-8-5" },
    exam: { label: "Indiana Securities Division examination request", url: "https://securities.sos.in.gov/documents-and-records" },
  },
  IL: {
    statute: { label: "205 ILCS 635/3-3", url: "https://www.ilga.gov/documents/legislation/ilcs/documents/020506350K3-3.htm" },
    rule: { label: "38 Ill. Adm. Code §§1050.940 and 1050.950", url: "https://witnessslips.ilga.gov/agencies/JCAR/EntirePart?titlepart=03801050" },
    originator: { label: "205 ILCS 635/7-14", url: "https://www.ilga.gov/documents/legislation/ilcs/documents/020506350K7-14.htm" },
  },
  WI: {
    statute: { label: "Wis. Stat. §224.77(1)", url: "https://docs.legis.wisconsin.gov/statutes/statutes/224/iii/77" },
  },
};

const originatorSources: Partial<Record<State, Source[]>> = {
  OH: [sourcesByState.OH.statute, sourcesByState.OH.rule],
  IL: [sourcesByState.IL.rule, sourcesByState.IL.originator],
  WI: [sourcesByState.WI.statute],
};

export function reviewStateAdvertising(jurisdiction: State, facts: AdvertisingFacts, companyNmls: string, today: string) {
  const evidence = facts.stateEvidence;
  const texas = evidence?.jurisdiction === "TX" ? evidence : undefined;
  const texasAuthority = texas?.authority === "Mortgage company" ? texasRules.company :
    texas?.authority === "Mortgage banker" ? texasRules.banker : undefined;
  const sources = jurisdiction === "TX" && texasAuthority
    ? [texasAuthority, texasRules.adopted, texasRules.exam, texasRules.forms] : Object.values(sourcesByState[jurisdiction]);
  const findings: AdvertisingFinding[] = [];
  const dates: { stateArchiveReviewDate?: string; websiteUpdateDue?: string } = {};
  const gap = (code: string, message: string, ...references: Source[]) => findings.push({ code, status: "Evidence gap", message, sources: references });
  const concern = (code: string, message: string, ...references: Source[]) => findings.push({ code, status: "Review concern", message, sources: references });
  function assess(code: string, subject: string, value: { result: string } | undefined, ...references: Source[]) {
    if (!value) gap(code, `Record the review and supporting evidence for ${subject}.`, ...references);
    else if (value.result === "Concern") concern(code, `A concern was recorded for ${subject}.`, ...references);
  }
  if (!evidence || evidence.jurisdiction !== jurisdiction || evidence.coverage === "Unresolved" || !evidence.scopeReference) {
    gap("state-scope", "Confirm the state advertising scope and record its evidence.", ...sources);
    if (!evidence || evidence.jurisdiction !== jurisdiction || evidence.coverage !== "In scope") return { sources, findings, ...dates };
  }
  if (evidence.coverage === "Outside scope") return { sources, findings, ...dates };

  if (evidence.jurisdiction === "TX" && (facts.distribution?.firstOn ?? facts.reviewedOn) < "2024-11-23") {
    gap("texas-prior-rule", "Confirm the Texas advertising rules in effect at first use and any later change in rule period.", texasRules.adopted);
    return { sources, findings, ...dates };
  }
  const identifiers = evidence.jurisdiction === "TX" ? sources : originatorSources[jurisdiction];
  if (identifiers) {
    if (facts.originatorAdvertising === "Unresolved") gap("originator-scope", evidence.jurisdiction === "TX" ? "Confirm whether a sponsored originator made or distributed the advertisement." : "Confirm whether the advertisement names or promotes an originator.", ...identifiers);
    if (facts.originatorAdvertising === "No" && facts.originators.length)
      gap("originator-conflict", "Reconcile the originator scope with the recorded originators.", ...identifiers);
    if (facts.originatorAdvertising === "Yes") {
      if (!facts.originators.length) gap("originator-list", "Record the applicable originators and their identifiers.", ...identifiers);
      for (const [index, item] of facts.originators.entries()) {
        if (!item.expected || !item.reference || item.visibility === "Unresolved")
          gap(`originator-proof-${index}`, `${item.name} needs identifier or visibility evidence.`, ...identifiers);
        if (!item.displayed || (item.expected && item.expected !== item.displayed) || item.visibility === "Unclear")
          concern(`originator-display-${index}`, `${item.name} has a missing, mismatched or unclear displayed identifier.`, ...identifiers);
        if (jurisdiction === "OH") assess(`originator-name-${index}`, `${item.name}’s displayed name against NMLS`,
          item.nameReview, sourcesByState.OH.rule);
        if (evidence.jurisdiction === "TX") assess(`originator-name-${index}`, `the displayed name for ${item.name}`, item.nameReview, ...identifiers);
      }
    }
  }

  if (evidence.jurisdiction !== "IN" && evidence.jurisdiction !== "FL" && evidence.jurisdiction !== "NY" && evidence.jurisdiction !== "CO" && evidence.jurisdiction !== "CA") {
    const companySources = evidence.jurisdiction === "OH" ? [sourcesByState.OH.statute, sourcesByState.OH.rule] :
      evidence.jurisdiction === "IL" ? [sourcesByState.IL.statute, sourcesByState.IL.rule] :
        evidence.jurisdiction === "TX" ? sources : [sourcesByState.WI.statute];
    const claimsSources = evidence.jurisdiction === "OH" ? [sourcesByState.OH.rule] : companySources;
    if (!companyNmls) gap("company-id-profile", "Record the legal entity’s verified NMLS identifier.", ...companySources);
    if (!facts.sponsoringCompanyDisplayed || (companyNmls && facts.sponsoringCompanyDisplayed !== companyNmls))
      concern("company-id-display", "The displayed company identifier is missing or does not match the legal entity.", ...companySources);
    assess("company-id-visibility", "company identifier visibility", evidence.companyIdentifier, ...companySources);
    assess("state-claims", "the claims and overall impression of the advertisement", facts.stateClaims, ...claimsSources);
  }
  if (evidence.jurisdiction === "OH") {
    const { statute, rule, archive } = sourcesByState.OH;
    assess("company-name", "the registered or approved company name", evidence.companyName, statute, rule);
    assess("office-address", "the office address on the registration certificate", evidence.officeAddress, rule);
    if (facts.specificTerms === "Unresolved") gap("state-terms-scope", "Confirm whether the advertisement offers specific rates or terms.", rule);
    if (facts.specificTerms === "Yes") assess("state-terms", "special terms and any limitations on their availability", facts.stateTerms, rule);
    if (facts.distribution) assess("state-archive", "advertising archive custody and examination retrieval", evidence.archive, archive);
    const final = facts.distribution?.finalOn;
    if (final && final < "2025-09-19") {
      gap("state-archive-history", "Confirm the Ohio recordkeeping rule in effect when this advertisement was distributed.", archive);
    } else if (final) {
      const year = String(Number(final.slice(0, 4)) + 4).padStart(4, "0");
      const archiveDate = year + final.slice(4);
      if (z.iso.date().safeParse(archiveDate).success) dates.stateArchiveReviewDate = archiveDate;
      else gap("state-archive-anniversary", "Confirm the state archive date with counsel for this leap-day record.", archive);
    }
    if (facts.channel === "Website") {
      const website = evidence.website;
      if (!website || website.status === "Unresolved" || !website.reference)
        gap("website-status", "Record whether the website is current and reference the supporting evidence.", rule);
      if (website?.status === "Update required") {
        if (!website.outdatedOn) gap("website-trigger", "Record when the website information became outdated or expired.", rule);
        else if (website.outdatedOn < "2024-09-01")
          gap("website-rule-history", "Confirm the Ohio website rule in effect when the information became outdated.", rule);
        else {
          dates.websiteUpdateDue = shiftReportDate(website.outdatedOn, 30);
          if ((website.updatedOn ?? today) > dates.websiteUpdateDue)
            concern("website-late", website.updatedOn ? "The recorded website update missed its 30-calendar-day date." :
              "No website update is recorded by the 30-calendar-day date.", rule);
          else if (!website.updatedOn)
            gap("website-update", "Record the website update when it occurs.", rule);
        }
      }
    }
  } else if (evidence.jurisdiction === "IN") {
    const { statute, exam } = sourcesByState.IN;
    if (evidence.solicitation === "Unresolved") gap("solicitation-scope", "Confirm whether the material was used to solicit borrowers.", statute, exam);
    if (evidence.solicitation === "Yes") {
      assess("state-archive", "the solicitation sample and its availability for examination", evidence.archive, statute, exam);
      if (evidence.internetCommunication === "Unresolved")
        gap("internet-scope", "Confirm whether the solicitation included an internet communication.", statute);
      if (evidence.internetCommunication === "Yes" && (evidence.recipientCount === undefined || !evidence.distributionReference))
        gap("internet-distribution", "Record the internet distribution count and its evidence for the solicitation archive review.", statute, exam);
    }
  } else if (evidence.jurisdiction === "IL") {
    const { statute, rule } = sourcesByState.IL;
    if (evidence.placement === "Unresolved") gap("placement", "Confirm the placement format for the Consumer Access review.", rule);
    assess("consumer-access", evidence.placement === "Electronic" ? "the electronic Consumer Access wording and prominence or documented exemption" :
      "the Consumer Access reference and prominence or documented exemption", evidence.consumerAccess, statute, rule);
    if (evidence.mixedActivity === "Unresolved") gap("mixed-activity", "Confirm whether the advertisement includes other lines of business.", rule);
    if (evidence.mixedActivity === "Yes") assess("mixed-prominence", "equal or greater prominence of the residential mortgage services", evidence.prominence, rule);
  } else if (evidence.jurisdiction === "CA") {
    const { dre, dreLaw, cfl, crmla } = sourcesByState.CA;
    const route = evidence.route;
    if (route.authority === "Unresolved") {
      gap("ca-authority", "Confirm which California authority covers this advertisement.", dreLaw, cfl, crmla);
      return { sources, findings, ...dates };
    }
    const authority = route.authority === "DRE endorsement" ? dreLaw : route.authority === "California Financing Law" ? cfl : crmla;
    assess("state-claims", "the ad claims and overall impression under the recorded California authority", facts.stateClaims, authority);
    assess("ca-product", "applicable product, rate, payment and risk disclosures", evidence.productDisclosures, authority);
    if (route.authority === "DRE endorsement") {
      if (route.purpose === "Unresolved") gap("ca-dre-purpose", "Confirm the DRE solicitation purpose and placement.", dre);
      else {
        const firstContact = route.purpose === "First contact only";
        assess("ca-dre-identifier", firstContact ? "the applicable licensee DRE numbers" : "the applicable licensee and broker DRE numbers", route.dreIdentifiers, dre, dreLaw);
        if (route.purpose !== "Investor solicitation")
          assess("ca-nmls", "the applicable NMLS identifiers for this solicitation", route.nmlsIdentifiers, dre, dreLaw);
        assess("ca-dre-phrasing", "the applicable broker or license designation", route.phrasing, dre);
        assess("ca-dre-presentation", "identifier font size or oral presentation for the placement", route.presentation, dre);
      }
      assess("ca-dre-submission", "whether DRE submission, approval or a solicitation-specific restriction applies", route.submission, dreLaw);
    } else if (route.authority === "California Financing Law") {
      if (route.placement === "Unresolved") gap("ca-cfl-placement", "Confirm where the CFL license and identifier information appears.", cfl);
      if (route.placement === "Character-limited platform") {
        if (!route.characterLimit || !["Website", "Social media", "Email", "Text message", "Other"].includes(facts.channel))
          gap("ca-cfl-limit", "Document a qualifying written electronic platform limit of no more than 300 characters.", cfl);
        assess("ca-cfl-link", "the working link and required disclosures at its destination", route.linkedDisclosure, cfl);
      } else if (route.placement === "In the ad") {
        assess("ca-nmls", "the applicable licensee or originator NMLS identifier in the ad", route.identifier, cfl);
        assess("ca-cfl-phrasing", "the permitted California Financing Law wording where licensure is referenced", route.phrasing, cfl);
      }
      assess("ca-identity", "whether the ad identifies the licensee without relying on blind contact details", route.advertiserIdentity, cfl);
      if (facts.distribution) {
        if (route.broadcast === "Unresolved") gap("ca-cfl-broadcast", "Confirm whether the ad was broadcast on radio or television.", cfl);
        if (route.broadcast === "Yes")
          assess("ca-cfl-broadcast-copy", "the voice transcription or accessible broadcaster copy", route.broadcastArchive, cfl);
        const final = facts.distribution.finalOn;
        if (final) {
          const anniversary = String(Number(final.slice(0, 4)) + 2).padStart(4, "0") + final.slice(4);
          if (z.iso.date().safeParse(anniversary).success) dates.stateArchiveReviewDate = anniversary;
          else gap("ca-cfl-anniversary", "Confirm the archive review date for a February 29 last use.", cfl);
        }
      }
    } else {
      if (route.identifiesOriginator === "Unresolved") gap("ca-crmla-originator", "Confirm whether the ad identifies a mortgage loan originator.", crmla);
      if (route.identifiesOriginator === "Yes")
        assess("ca-nmls", "the identified mortgage loan originator's displayed NMLS identifier", route.identifier, crmla);
      assess("ca-crmla-phrasing", "the permitted CRMLA wording where licensure is referenced", route.phrasing, crmla);
      assess("ca-identity", "whether the ad identifies the licensee without relying on blind contact details", route.advertiserIdentity, crmla);
      assess("ca-crmla-regulator", "claims of State of California supervision, bonding or similar oversight", route.regulatorClaims, crmla);
    }
    if (facts.distribution) {
      const subject = route.authority === "California Financing Law"
        ? "the home-office copy, media names, use dates and sponsor custody where applicable"
        : "the applicable advertising archive and examination retrieval";
      assess("state-archive", subject, evidence.archive, authority);
    }
  } else if (evidence.jurisdiction === "CO") {
    const { rule, guidance } = sourcesByState.CO;
    if (evidence.identification === "Unresolved")
      gap("co-identification-scope", "Confirm whether Colorado identification requirements apply.", rule);
    if (evidence.identification === "Required") {
      assess("co-party", "the responsible company or originator and its conspicuous NMLS ID", evidence.responsibleParty, rule);
      assess("co-company", "the conspicuous mortgage company name", evidence.companyName, rule);
      assess("co-phone", "the conspicuous business phone of the responsible party", evidence.businessPhone, rule);
    }
    if ((evidence.identification === "Promotional item exception" || evidence.identification === "Commercial rate sheet exception") && !evidence.exceptionReference)
      gap("co-identification-exception", "Record the placement, content and audience evidence supporting the Colorado identification exception.", rule);
    assess("state-claims", "the overall impression and material omissions", facts.stateClaims, rule);
    assess("co-product-terms", "product and term availability and material limitations at the time offered", evidence.productTerms, rule);
    assess("co-affiliation", "whether the ad appears to come from a government agency, current lender or servicer", evidence.affiliation, rule);
    assess("co-nontraditional", "the applicable nontraditional mortgage product risk disclosures", evidence.nontraditional, rule, guidance);
    if (facts.distribution) {
      assess("state-archive", "the retained advertising copy and its availability for Board inspection", evidence.archive, rule);
      const final = facts.distribution.finalOn;
      if (final) {
        const anniversary = String(Number(final.slice(0, 4)) + 4).padStart(4, "0") + final.slice(4);
        if (z.iso.date().safeParse(anniversary).success) dates.stateArchiveReviewDate = anniversary;
        else gap("co-archive-anniversary", "Confirm the Colorado archive review date for a February 29 last use.", rule);
      }
    }
  } else if (evidence.jurisdiction === "NY") {
    const { rule, broker } = sourcesByState.NY;
    if (evidence.authority === "Unresolved") gap("ny-authority", "Confirm the advertiser's New York authority.", rule);
    if (evidence.placement === "Unresolved") gap("ny-placement", "Identify the advertising placement to review the legend and address.", rule);
    if (evidence.authority === "Licensed banker" || (evidence.authority === "Registered broker" && evidence.placement === "Print or electronic"))
      assess("ny-legend", "the applicable New York registration or licensing legend", evidence.legend, rule);
    if (evidence.placement === "Print or electronic")
      assess("ny-office", "the entity name and office address or documented exception", evidence.officeDisclosure, rule);
    if (evidence.authority === "Registered broker") {
      assess("ny-third-party", "the statement that the broker arranges loans through third-party providers", evidence.thirdPartyStatement, rule, broker);
      assess("ny-funding", "whether the ad implies that the broker funds loans", evidence.fundingImpression, rule, broker);
    }
    assess("state-claims", "misleading claims about loan approval, points, timing or other conditions", facts.stateClaims, rule);
    assess("ny-credit-limits", "credit access claims and any material limitations", evidence.creditLimitations, rule);
    assess("ny-rate-notice", "any stated prevailing rate and its availability notice", evidence.rateNotice, rule);
    assess("ny-prepayment", "prepayment penalty disclosure when a product with a penalty is advertised with interest rate or points", evidence.prepaymentPenalty, rule);
    if (evidence.advertisesProduct === "Unresolved") gap("state-terms-scope", "Confirm whether the ad offers a mortgage product.", rule);
    if (evidence.advertisesProduct === "Yes")
      assess("state-terms", "product availability to qualified applicants on the publication date or next business day or the disclosed allocation limit", evidence.productAvailability, rule);
    if (facts.distribution) {
      assess("state-archive", "the published sample and applicable commercial scripts for DFS examination", evidence.archive, rule);
      const final = facts.distribution.finalOn;
      if (final) {
        const anniversary = String(Number(final.slice(0, 4)) + 2).padStart(4, "0") + final.slice(4);
        if (z.iso.date().safeParse(anniversary).success) dates.stateArchiveReviewDate = anniversary;
        else gap("ny-archive-anniversary", "Confirm the New York archive review date for a February 29 publication.", rule);
      }
    }
  } else if (evidence.jurisdiction === "FL") {
    const { statute, exam } = sourcesByState.FL;
    assess("state-claims", "unfair, deceptive or misleading claims", facts.stateClaims, statute);
    assess("fl-agency-names", "the use of names that suggest a federal agency", evidence.federalAgencyNames, statute);
    if (evidence.unqualifiedCredit === "Unresolved") gap("fl-credit-scope", "Confirm whether the ad suggests unqualified access to credit.", statute);
    if (evidence.unqualifiedCredit === "Yes")
      assess("fl-material-limits", "disclosure of material limits on access to credit", evidence.materialLimits, statute);
    if (evidence.expressedRate === "Unresolved" || (evidence.expressedRate === "Yes" && facts.specificTerms === "No"))
      gap("fl-rate-scope", "Confirm whether an interest rate is stated and reconcile the advertised terms review.", statute);
    if (evidence.expressedRate === "Yes")
      assess("fl-rate-notice", "the notice that the stated rate could change or be unavailable at commitment or closing", evidence.rateNotice, statute);
    if (facts.specificTerms === "Unresolved") gap("state-terms-scope", "Confirm whether rates or other material loan terms are advertised.", statute);
    if (facts.specificTerms === "Yes" || evidence.expressedRate === "Yes")
      assess("state-terms", "availability of the advertised loan to a reasonable number of qualified applicants", facts.stateTerms, statute);
    if (evidence.chapterLicense === "Unresolved")
      gap("fl-archive-scope", "Confirm whether Chapter 494 requires the advertiser to hold a license for the archive review.", statute);
    if (evidence.chapterLicense === "Yes" && facts.distribution) {
      assess("state-archive", "the published ad sample and its availability for OFR examination", evidence.sampleArchive, statute, exam);
      if (evidence.radioTelevision === "Unresolved")
        gap("fl-broadcast-scope", "Confirm whether this advertisement was broadcast on radio or television.", statute);
      if (evidence.radioTelevision === "Yes")
        assess("fl-broadcast-scripts", "the commercial scripts for the radio or television broadcasts", evidence.broadcastScripts, statute, exam);
      const final = facts.distribution.finalOn;
      if (final) {
        const year = String(Number(final.slice(0, 4)) + 2).padStart(4, "0");
        const anniversary = year + final.slice(4);
        if (z.iso.date().safeParse(anniversary).success) dates.stateArchiveReviewDate = anniversary;
        else gap("fl-archive-anniversary", "Confirm the Florida archive review date with counsel for a February 29 publication or broadcast.", statute);
      }
    }
  } else if (evidence.jurisdiction === "TX") {
    const rules = texasAuthority ? [texasAuthority] : [texasRules.company, texasRules.banker];
    if (!texasAuthority) gap("texas-authority", "Confirm the Texas mortgage company or banker authority for this creative.", ...rules);
    assess("company-name", "the company name used in the advertisement", evidence.companyName, ...rules);
    if (evidence.companyWebsite === "Unresolved" || (facts.channel === "Website" && evidence.companyWebsite === "No"))
      gap("texas-website-scope", "Confirm the company's website and reconcile it with the advertising channel.", ...rules);
    if (evidence.companyWebsite === "Yes" || facts.channel === "Website")
      assess("texas-website-address", "the company website address in the advertising placement", evidence.websiteAddress, ...rules);
    if (facts.channel === "Website")
      assess("texas-complaint-notice", "the website complaint notice for the applicable Texas authority", evidence.complaintNotice, texasRules.forms, ...rules);
    if (facts.channel === "Social media") {
      if (!evidence.socialPlacement || evidence.socialPlacement === "Unresolved")
        gap("texas-social-placement", "Record where the social advertisement's identifiers and website address appear.", ...rules);
      if (evidence.socialPlacement === "On the profile")
        assess("texas-profile-prominence", "prominent disclosures on the social profile or home page", evidence.profileProminence, ...rules);
    }
    if (evidence.teamBranding === "Unresolved")
      gap("texas-team-scope", "Confirm whether the advertisement uses a team name or logo.", ...rules);
    if (evidence.teamBranding === "Yes")
      assess("texas-team-linkage", "the team name or logo, its link to the company, and the company's prominence", evidence.teamLinkage, ...rules);
    if (facts.specificTerms === "Unresolved") gap("state-terms-scope", "Confirm whether the advertisement offers specific rates or terms.", ...rules);
    if (facts.specificTerms === "Yes")
      assess("state-terms", "product availability and any special conditions", facts.stateTerms, ...rules);
    if (facts.distribution)
      assess("state-archive", "the advertisement as distributed in its original medium and its examination retrieval", evidence.archive, ...rules);
  } else {
    const { statute } = sourcesByState.WI;
    assess("company-name", "the clearly identified broker, banker or registered sponsor", evidence.companyName, statute);
    assess("affiliation", "representations about government, other organizations or related programs", evidence.affiliation, statute);
    if (facts.specificTerms === "Unresolved") gap("state-terms-scope", "Confirm whether specific financing terms are advertised.", statute);
    if (facts.specificTerms === "Yes") assess("state-terms", "the availability of the advertised terms at the time of use", facts.stateTerms, statute);
  }
  return { sources, findings, ...dates };
}
