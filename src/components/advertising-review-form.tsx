"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { advertisingChannels, advertisingFacts, advertisingStateNames, advertisingZones,
  type AdvertisingFacts, type AdvertisingState } from "@/lib/advertising-review-model";
import { californiaAdvertisingRoutes, coloradoAdContentChecks, coloradoAdIdentification, coloradoAdIdentityChecks, texasAdvertisingAuthorities } from "@/lib/advertising-state-review";
import { Button } from "./ui/button";

const choices = ["Unresolved", "Yes", "No"] as const;
const stateResults = ["Supported", "Concern"] as const;
const federalResults = [...stateResults, "Outside scope"] as const;
export const advertisingTimeZoneLabels: Record<AdvertisingFacts["zone"], string> = {
  "America/Detroit": "Eastern", "America/Menominee": "Central", "America/New_York": "Eastern",
  "America/Indiana/Indianapolis": "Eastern", "America/Chicago": "Central", "America/Denver": "Mountain", "America/Los_Angeles": "Pacific",
};
const emptyOriginator: AdvertisingFacts["originators"][number] = { name: "", visibility: "Unresolved" };
type StateEvidence = NonNullable<AdvertisingFacts["stateEvidence"]>;

function Select<T extends string>({ label, value, choices, change, labels }: {
  label: string; value: T; choices: readonly T[]; change: (value: T) => void; labels?: Partial<Record<string, string>>;
}) {
  return <label className="field">{label}
    <select value={value} onChange={event => change(event.target.value as T)}>
      {choices.map(option => <option value={option} key={option}>{labels?.[option] ?? option}</option>)}
    </select>
  </label>;
}

function Text({ label, value, change, max = 300, rows, readOnly, required, digits }: {
  label: string; value: string; change: (value: string) => void; max?: number; rows?: number;
  readOnly?: boolean; required?: boolean; digits?: boolean;
}) {
  const props = { value, maxLength: max, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    change(event.target.value), readOnly, required };
  return <label className="field">{label}
    {rows ? <textarea {...props} rows={rows} /> : <input {...props} inputMode={digits ? "numeric" : undefined} />}
  </label>;
}

function DateInput({ label, value, change, required }: {
  label: string; value: string; change: (value: string) => void; required?: boolean;
}) {
  return <label className="field">{label}<input type="date" min="1900-01-01" max="9990-12-31" value={value} required={required}
    onChange={event => change(event.target.value)} /></label>;
}

function Assessment<T extends string>({ label, value, choices, change }: {
  label: string; value?: { result: T; reference: string }; choices: readonly T[];
  change: (value: { result: T; reference: string } | undefined) => void;
}) {
  return <>
    <Select label={label} value={value?.result ?? ""} choices={["", ...choices]} labels={{ "": "Awaiting review" }}
      change={result => change(result ? { result, reference: value?.reference ?? "" } : undefined)} />
    {value && <Text label={`${label} reference`} value={value.reference} rows={2} required change={reference => change({ ...value, reference })} />}
  </>;
}

function EvidenceSection({ title, children }: { title: string; children: ReactNode }) {
  return <details className="min-w-0 border-t border-[var(--line)] py-2">
    <summary className="font-semibold">{title}</summary>
    <div className="record-form pt-2">{children}</div>
  </details>;
}

function StateAdvertisingFields({ evidence, channel, change }: {
  evidence: StateEvidence; channel: AdvertisingFacts["channel"]; change: (value: StateEvidence) => void;
}) {
  const scope = <>
    <Select label="State advertising scope" value={evidence.coverage} choices={["Unresolved", "In scope", "Outside scope"]}
      change={coverage => change({ ...evidence, coverage })} />
    <Text label="State scope reference" value={evidence.scopeReference ?? ""} rows={2}
      change={scopeReference => change({ ...evidence, scopeReference: scopeReference || undefined })} />
  </>;
  if (evidence.coverage !== "In scope") return scope;
  switch (evidence.jurisdiction) {
    case "OH": {
      const website = evidence.website ?? { status: "Unresolved" as const };
      return <>{scope}
        <Assessment label="Registered company name" value={evidence.companyName} choices={stateResults}
          change={companyName => change({ ...evidence, companyName })} />
        <Assessment label="Registered office address" value={evidence.officeAddress} choices={stateResults}
          change={officeAddress => change({ ...evidence, officeAddress })} />
        <Assessment label="Company identifier visibility" value={evidence.companyIdentifier} choices={stateResults}
          change={companyIdentifier => change({ ...evidence, companyIdentifier })} />
        <Assessment label="Ohio archive and examination retrieval" value={evidence.archive} choices={stateResults}
          change={archive => change({ ...evidence, archive })} />
        {channel === "Website" && <>
          <Select label="Website information status" value={website.status} choices={["Unresolved", "Current", "Update required"]}
            labels={{ "Update required": "Outdated information recorded" }} change={status => change({ ...evidence,
              website: status === "Update required" ? { ...website, status } : { status, reference: website.reference } })} />
          <Text label="Website evidence reference" value={website.reference ?? ""} rows={2}
            change={reference => change({ ...evidence, website: { ...website, reference: reference || undefined } })} />
          {website.status === "Update required" && <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <DateInput label="Date information became outdated" value={website.outdatedOn ?? ""}
              change={outdatedOn => change({ ...evidence, website: { ...website, outdatedOn: outdatedOn || undefined } })} />
            <DateInput label="Website update date" value={website.updatedOn ?? ""}
              change={updatedOn => change({ ...evidence, website: { ...website, updatedOn: updatedOn || undefined } })} />
          </div>}
        </>}
      </>;
    }
    case "IN": return <>{scope}
      <Select label="Used to solicit borrowers" value={evidence.solicitation} choices={choices}
        change={solicitation => change({ ...evidence, solicitation })} />
      {evidence.solicitation === "Yes" && <>
        <Assessment label="Indiana solicitation archive" value={evidence.archive} choices={stateResults}
          change={archive => change({ ...evidence, archive })} />
        <Select label="Includes an internet communication" value={evidence.internetCommunication} choices={choices}
          change={internetCommunication => change({ ...evidence, internetCommunication })} />
        {evidence.internetCommunication === "Yes" && <>
          <label className="field">Internet recipient count
            <input type="number" min={0} step={1} value={evidence.recipientCount ?? ""}
              onChange={event => change({ ...evidence, recipientCount: event.target.value ? event.target.valueAsNumber : undefined })} />
          </label>
          <Text label="Internet distribution reference" value={evidence.distributionReference ?? ""} rows={2}
            change={distributionReference => change({ ...evidence, distributionReference: distributionReference || undefined })} />
        </>}
      </>}
    </>;
    case "IL": return <>{scope}
      <Assessment label="Company identifier visibility" value={evidence.companyIdentifier} choices={stateResults}
        change={companyIdentifier => change({ ...evidence, companyIdentifier })} />
      <Select label="Placement format" value={evidence.placement} choices={["Unresolved", "Electronic", "Print"]}
        change={placement => change({ ...evidence, placement })} />
      <Assessment label="Consumer Access review" value={evidence.consumerAccess} choices={[...stateResults, "Exempt"]}
        change={consumerAccess => change({ ...evidence, consumerAccess })} />
      <Select label="Includes other lines of business" value={evidence.mixedActivity} choices={choices}
        change={mixedActivity => change({ ...evidence, mixedActivity })} />
      {evidence.mixedActivity === "Yes" && <Assessment label="Prominence of mortgage services" value={evidence.prominence} choices={stateResults}
        change={prominence => change({ ...evidence, prominence })} />}
    </>;
    case "CA": {
      const { route } = evidence;
      return <>{scope}
        <Select label="California advertising authority" value={route.authority} choices={californiaAdvertisingRoutes}
          change={authority => {
            if (authority === route.authority) return;
            if (authority === "DRE endorsement") change({ ...evidence, route: { authority, purpose: "Unresolved" }, archive: undefined, productDisclosures: undefined });
            else if (authority === "California Financing Law") change({ ...evidence, route: { authority, placement: "Unresolved", broadcast: "Unresolved" }, archive: undefined, productDisclosures: undefined });
            else if (authority === "CRMLA") change({ ...evidence, route: { authority, identifiesOriginator: "Unresolved" }, archive: undefined, productDisclosures: undefined });
            else change({ ...evidence, route: { authority }, archive: undefined, productDisclosures: undefined });
          }} />
        {route.authority === "DRE endorsement" && <>
          <Select label="DRE solicitation purpose" value={route.purpose}
            choices={["Unresolved", "Borrower solicitation", "Investor solicitation", "First contact only"]}
            change={purpose => change({ ...evidence, route: { ...route, purpose, dreIdentifiers: undefined, nmlsIdentifiers: undefined,
              phrasing: undefined, presentation: undefined, submission: undefined } })} />
          {route.purpose !== "Unresolved" && <>
            <Assessment label="DRE license numbers" value={route.dreIdentifiers} choices={stateResults}
              change={dreIdentifiers => change({ ...evidence, route: { ...route, dreIdentifiers } })} />
            {route.purpose !== "Investor solicitation" && <Assessment label="Applicable NMLS identifiers" value={route.nmlsIdentifiers} choices={stateResults}
              change={nmlsIdentifiers => change({ ...evidence, route: { ...route, nmlsIdentifiers } })} />}
            <Assessment label="Broker or license designation" value={route.phrasing} choices={stateResults}
              change={phrasing => change({ ...evidence, route: { ...route, phrasing } })} />
            <Assessment label="Identifier size or oral presentation" value={route.presentation} choices={stateResults}
              change={presentation => change({ ...evidence, route: { ...route, presentation } })} />
          </>}
          <Assessment label="DRE submission and solicitation review" value={route.submission} choices={stateResults}
            change={submission => change({ ...evidence, route: { ...route, submission } })} />
        </>}
        {route.authority === "California Financing Law" && <>
          <Select label="CFL disclosure placement" value={route.placement} choices={["Unresolved", "In the ad", "Character-limited platform"]}
            change={placement => change({ ...evidence, route: { ...route, placement, identifier: undefined, phrasing: undefined,
              characterLimit: undefined, linkedDisclosure: undefined } })} />
          {route.placement === "Character-limited platform" && <>
            <label className="field">Platform character limit
              <input type="number" min={1} max={300} step={1} value={route.characterLimit ?? ""}
                onChange={event => change({ ...evidence, route: { ...route,
                  characterLimit: event.currentTarget.value ? event.currentTarget.valueAsNumber : undefined } })} />
            </label>
            <Assessment label="Link and destination disclosures" value={route.linkedDisclosure} choices={stateResults}
              change={linkedDisclosure => change({ ...evidence, route: { ...route, linkedDisclosure } })} />
          </>}
          {route.placement === "In the ad" && <>
            <Assessment label="Applicable NMLS identifier" value={route.identifier} choices={stateResults}
              change={identifier => change({ ...evidence, route: { ...route, identifier } })} />
            <Assessment label="CFL license wording review" value={route.phrasing} choices={stateResults}
              change={phrasing => change({ ...evidence, route: { ...route, phrasing } })} />
          </>}
          <Assessment label="Identifiable advertiser" value={route.advertiserIdentity} choices={stateResults}
            change={advertiserIdentity => change({ ...evidence, route: { ...route, advertiserIdentity } })} />
          <Select label="Broadcast on radio or television" value={route.broadcast} choices={choices}
            change={broadcast => change({ ...evidence, route: { ...route, broadcast } })} />
          {route.broadcast === "Yes" && <Assessment label="Broadcast transcript or station copy" value={route.broadcastArchive} choices={stateResults}
            change={broadcastArchive => change({ ...evidence, route: { ...route, broadcastArchive } })} />}
        </>}
        {route.authority === "CRMLA" && <>
          <Select label="Identifies a mortgage loan originator" value={route.identifiesOriginator} choices={choices}
            change={identifiesOriginator => change({ ...evidence, route: { ...route, identifiesOriginator } })} />
          {route.identifiesOriginator === "Yes" && <Assessment label="Originator NMLS identifier" value={route.identifier} choices={stateResults}
            change={identifier => change({ ...evidence, route: { ...route, identifier } })} />}
          <Assessment label="CRMLA license wording review" value={route.phrasing} choices={stateResults}
            change={phrasing => change({ ...evidence, route: { ...route, phrasing } })} />
          <Assessment label="Identifiable advertiser" value={route.advertiserIdentity} choices={stateResults}
            change={advertiserIdentity => change({ ...evidence, route: { ...route, advertiserIdentity } })} />
          <Assessment label="Claims of state oversight or bonding" value={route.regulatorClaims} choices={stateResults}
            change={regulatorClaims => change({ ...evidence, route: { ...route, regulatorClaims } })} />
        </>}
        {route.authority !== "Unresolved" && <>
          <Assessment label="Product, rate and payment disclosures" value={evidence.productDisclosures} choices={stateResults}
            change={productDisclosures => change({ ...evidence, productDisclosures })} />
          <Assessment label="Advertising archive and examination retrieval" value={evidence.archive} choices={stateResults}
            change={archive => change({ ...evidence, archive })} />
        </>}
      </>;
    }
    case "CO": return <>{scope}
      <Select label="Colorado identification requirements" value={evidence.identification} choices={coloradoAdIdentification}
        change={identification => change({ ...evidence, identification })} />
      {evidence.identification === "Required" && coloradoAdIdentityChecks.map(([key, label]) =>
        <Assessment key={key} label={label} value={evidence[key]} choices={stateResults}
          change={value => change({ ...evidence, [key]: value })} />)}
      {(evidence.identification === "Promotional item exception" || evidence.identification === "Commercial rate sheet exception") &&
        <Text label="Identification exception evidence" value={evidence.exceptionReference ?? ""} rows={2}
          change={exceptionReference => change({ ...evidence, exceptionReference: exceptionReference || undefined })} />}
      {coloradoAdContentChecks.map(([key, label]) =>
        <Assessment key={key} label={label} value={evidence[key]} choices={stateResults}
          change={value => change({ ...evidence, [key]: value })} />)}
      <Assessment label="Advertising archive and Board retrieval" value={evidence.archive} choices={stateResults}
        change={archive => change({ ...evidence, archive })} />
    </>;
    case "NY": return <>{scope}
      <Select label="New York authority" value={evidence.authority} choices={["Unresolved", "Registered broker", "Licensed banker", "Exempt organization"]}
        change={authority => change({ ...evidence, authority })} />
      <Select label="New York advertising placement" value={evidence.placement} choices={["Unresolved", "Print or electronic", "Other media"]}
        change={placement => change({ ...evidence, placement })} />
      {(evidence.authority === "Licensed banker" || (evidence.authority === "Registered broker" && evidence.placement === "Print or electronic")) &&
        <Assessment label="Registration or licensing legend" value={evidence.legend} choices={stateResults}
          change={legend => change({ ...evidence, legend })} />}
      {evidence.placement === "Print or electronic" && <Assessment label="Entity name and office address or exception" value={evidence.officeDisclosure}
        choices={stateResults} change={officeDisclosure => change({ ...evidence, officeDisclosure })} />}
      {evidence.authority === "Registered broker" && <>
        <Assessment label="Third-party loan arrangement statement" value={evidence.thirdPartyStatement} choices={stateResults}
          change={thirdPartyStatement => change({ ...evidence, thirdPartyStatement })} />
        <Assessment label="Broker funding impression" value={evidence.fundingImpression} choices={stateResults}
          change={fundingImpression => change({ ...evidence, fundingImpression })} />
      </>}
      <Select label="Advertises a mortgage product" value={evidence.advertisesProduct} choices={choices}
        change={advertisesProduct => change({ ...evidence, advertisesProduct })} />
      {evidence.advertisesProduct === "Yes" && <Assessment label="Product availability or disclosed allocation" value={evidence.productAvailability}
        choices={stateResults} change={productAvailability => change({ ...evidence, productAvailability })} />}
      <Assessment label="Credit access claims and material limitations" value={evidence.creditLimitations} choices={stateResults}
        change={creditLimitations => change({ ...evidence, creditLimitations })} />
      <Assessment label="Prevailing rate and availability notice review" value={evidence.rateNotice} choices={stateResults}
        change={rateNotice => change({ ...evidence, rateNotice })} />
      <Assessment label="Prepayment penalty disclosure review" value={evidence.prepaymentPenalty} choices={stateResults}
        change={prepaymentPenalty => change({ ...evidence, prepaymentPenalty })} />
      <Assessment label="Published sample and applicable scripts" value={evidence.archive} choices={stateResults}
        change={archive => change({ ...evidence, archive })} />
    </>;
    case "FL": return <>{scope}
      <Select label="Suggests unqualified access to credit" value={evidence.unqualifiedCredit} choices={choices}
        change={unqualifiedCredit => change({ ...evidence, unqualifiedCredit })} />
      {evidence.unqualifiedCredit === "Yes" && <Assessment label="Material credit limitations disclosed" value={evidence.materialLimits}
        choices={stateResults} change={materialLimits => change({ ...evidence, materialLimits })} />}
      <Select label="States an interest rate" value={evidence.expressedRate} choices={choices}
        change={expressedRate => change({ ...evidence, expressedRate })} />
      {evidence.expressedRate === "Yes" && <Assessment label="Rate change or availability notice" value={evidence.rateNotice}
        choices={stateResults} change={rateNotice => change({ ...evidence, rateNotice })} />}
      <Assessment label="Federal agency names and representations" value={evidence.federalAgencyNames} choices={stateResults}
        change={federalAgencyNames => change({ ...evidence, federalAgencyNames })} />
      <Select label="Advertiser requires a Chapter 494 license" value={evidence.chapterLicense} choices={choices}
        change={chapterLicense => change({ ...evidence, chapterLicense })} />
      {evidence.chapterLicense === "Yes" && <>
        <Assessment label="Published ad sample and OFR retrieval" value={evidence.sampleArchive} choices={stateResults}
          change={sampleArchive => change({ ...evidence, sampleArchive })} />
        <Select label="Broadcast on radio or television" value={evidence.radioTelevision} choices={choices}
          change={radioTelevision => change({ ...evidence, radioTelevision })} />
        {evidence.radioTelevision === "Yes" && <Assessment label="Commercial script archive" value={evidence.broadcastScripts}
          choices={stateResults} change={broadcastScripts => change({ ...evidence, broadcastScripts })} />}
      </>}
    </>;
    case "TX": return <>{scope}
      <Select label="Texas authority" value={evidence.authority} choices={texasAdvertisingAuthorities}
        change={authority => change({ ...evidence, authority })} />
      <Assessment label="Company name" value={evidence.companyName} choices={stateResults}
        change={companyName => change({ ...evidence, companyName })} />
      <Assessment label="Company identifier visibility" value={evidence.companyIdentifier} choices={stateResults}
        change={companyIdentifier => change({ ...evidence, companyIdentifier })} />
      <Select label="Company has a website" value={evidence.companyWebsite} choices={choices}
        change={companyWebsite => change({ ...evidence, companyWebsite })} />
      {(channel === "Website" || evidence.companyWebsite === "Yes") &&
        <Assessment label="Displayed company website address" value={evidence.websiteAddress} choices={stateResults}
          change={websiteAddress => change({ ...evidence, websiteAddress })} />}
      {channel === "Website" && <Assessment label="Texas consumer complaint notice" value={evidence.complaintNotice} choices={stateResults}
        change={complaintNotice => change({ ...evidence, complaintNotice })} />}
      {channel === "Social media" && <>
        <Select label="Social media disclosure location" value={evidence.socialPlacement ?? "Unresolved"}
          choices={["Unresolved", "In the advertisement", "On the profile"]}
          change={socialPlacement => change({ ...evidence, socialPlacement })} />
        {evidence.socialPlacement === "On the profile" &&
          <Assessment label="Prominence on the social profile" value={evidence.profileProminence} choices={stateResults}
            change={profileProminence => change({ ...evidence, profileProminence })} />}
      </>}
      <Select label="Uses a team name or logo" value={evidence.teamBranding} choices={choices}
        change={teamBranding => change({ ...evidence, teamBranding })} />
      {evidence.teamBranding === "Yes" && <Assessment label="Team link to company and prominence" value={evidence.teamLinkage} choices={stateResults}
        change={teamLinkage => change({ ...evidence, teamLinkage })} />}
      <Assessment label="Published ad archive and retrieval" value={evidence.archive} choices={stateResults}
        change={archive => change({ ...evidence, archive })} />
    </>;
    case "WI": return <>{scope}
      <Assessment label="Brokerage, banker or sponsor name" value={evidence.companyName} choices={stateResults}
        change={companyName => change({ ...evidence, companyName })} />
      <Assessment label="Company identifier visibility" value={evidence.companyIdentifier} choices={stateResults}
        change={companyIdentifier => change({ ...evidence, companyIdentifier })} />
      <Assessment label="Government or organization affiliation" value={evidence.affiliation} choices={stateResults}
        change={affiliation => change({ ...evidence, affiliation })} />
    </>;
  }
}

function blankState(jurisdiction: AdvertisingState): StateEvidence | undefined {
  const coverage = "Unresolved" as const;
  switch (jurisdiction) {
    case "MI": return undefined;
    case "OH": return { jurisdiction, coverage };
    case "IN": return { jurisdiction, coverage, solicitation: "Unresolved", internetCommunication: "Unresolved" };
    case "IL": return { jurisdiction, coverage, placement: "Unresolved", mixedActivity: "Unresolved" };
    case "CA": return { jurisdiction, coverage, route: { authority: "Unresolved" } };
    case "CO": return { jurisdiction, coverage, identification: "Unresolved" };
    case "NY": return { jurisdiction, coverage, authority: "Unresolved", placement: "Unresolved", advertisesProduct: "Unresolved" };
    case "FL": return { jurisdiction, coverage, unqualifiedCredit: "Unresolved", expressedRate: "Unresolved",
      chapterLicense: "Unresolved", radioTelevision: "Unresolved" };
    case "TX": return { jurisdiction, coverage, authority: "Unresolved", companyWebsite: "Unresolved", teamBranding: "Unresolved" };
    case "WI": return { jurisdiction, coverage };
  }
}

function blank(jurisdiction: AdvertisingState): AdvertisingFacts {
  const zone = advertisingZones[jurisdiction][0];
  const reviewedOn = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return {
    title: "", channel: "Website", audience: "", creative: { kind: "Text", copy: "" },
    reviewedOn, zone, scopeReference: "", stateEvidence: blankState(jurisdiction),
    mortgageScope: "Unresolved", creditType: "Unresolved", specificTerms: "Unresolved",
    originatorAdvertising: "Unresolved", originators: [], archive: { applies: "Unresolved" },
  };
}

const issueLabels: Partial<Record<keyof AdvertisingFacts, string>> = {
  title: "Advertisement name", scopeReference: "Campaign scope reference", creative: "Creative copy or archive reference and SHA-256",
  reviewedOn: "Review date", originators: "Originator name, identifier and evidence", stateClaims: "State claims review reference",
  stateTerms: "State terms review reference", regulationZ: "Regulation Z review reference", regulationN: "Regulation N review reference",
  stateEvidence: "State advertising checks and references",
  archive: "Archive references", distribution: "Distribution dates, order and reference", sponsoringCompanyDisplayed: "Displayed company NMLS ID",
};

export function AdvertisingReviewForm({ initial, entityName, jurisdiction, busy, error, onSave, onCancel, onReload }: {
  initial?: AdvertisingFacts; entityName: string; jurisdiction: AdvertisingState; busy: boolean; error: string;
  onSave: (facts: AdvertisingFacts, correction?: string) => void; onCancel: () => void; onReload?: () => void;
}) {
  const [facts, setFacts] = useState(() => initial ?
    { ...initial, stateEvidence: initial.stateEvidence ?? blankState(jurisdiction) } : blank(jurisdiction));
  const [correction, setCorrection] = useState("");
  const [issues, setIssues] = useState<string[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);
  const feedback = useRef<HTMLDivElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => { if (issues.length || error) feedback.current?.focus(); }, [issues, error]);
  function set<K extends keyof AdvertisingFacts>(key: K, value: AdvertisingFacts[K]) {
    setFacts(current => ({ ...current, [key]: value }));
  }
  const setArchive = (key: Exclude<keyof AdvertisingFacts["archive"], "applies">, value: string) => {
    setFacts(current => ({ ...current, archive: { ...current.archive, [key]: value || undefined } }));
  };
  function changeOriginator(index: number, next: AdvertisingFacts["originators"][number]) {
    set("originators", facts.originators.map((originator, position) => position === index ? next : originator));
  }
  const { creative, distribution } = facts;
  const stateName = advertisingStateNames[jurisdiction];
  const stateTermsReview = jurisdiction === "MI" || jurisdiction === "OH" || jurisdiction === "WI" || jurisdiction === "TX" || jurisdiction === "FL";
  const showStateChecks = jurisdiction === "MI" || facts.stateEvidence?.coverage === "In scope";

  return <form className="record-form w-full max-w-2xl" noValidate onChange={() => { if (issues.length) setIssues([]); }} onSubmit={event => {
    event.preventDefault();
    if (busy) return;
    const parsed = advertisingFacts.safeParse(facts);
    const missingCorrection = !!initial && correction.trim().length < 4;
    if (!parsed.success || missingCorrection) {
      const fields = parsed.success ? [] : parsed.error.issues.map(issue => {
        const key = issue.path[0] as keyof AdvertisingFacts;
        return issue.code === "custom" && key !== "creative" && key !== "reviewedOn" ?
          issue.message : issueLabels[key] ?? "Audience";
      });
      setIssues([...new Set([...fields, ...(missingCorrection ? ["Correction reason"] : [])])]);
      return;
    }
    setIssues([]);
    onSave(parsed.data, initial ? correction.trim() : undefined);
  }}>
    <h2 ref={heading} tabIndex={-1}>{initial ? "Correct advertising evidence" : "Record an advertisement"}</h2>
    <p className="muted [overflow-wrap:anywhere]">{entityName} · {stateName}</p>
    {(issues.length > 0 || error) && <div ref={feedback} role="alert" tabIndex={-1} className="record-form">
      {error && <p>{error}</p>}
      {!!issues.length && <><p>Check these fields and try again.</p><ul className="list-disc pl-5">
        {issues.map(issue => <li key={issue}>{issue}</li>)}</ul></>}
      {error.includes("record changed") && onReload && <div>
        <Button type="button" variant="outline" onClick={onReload}>Reload and discard draft</Button>
      </div>}
    </div>}
    <fieldset className="record-form min-w-0" disabled={busy}>
      <legend className="mb-2 font-semibold">Advertisement and scope</legend>
      <Text label="Advertisement name" value={facts.title} max={140} required change={value => set("title", value)} />
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <Select label="Channel" value={facts.channel} choices={advertisingChannels} change={value => set("channel", value)} />
        <Select label="Mortgage scope" value={facts.mortgageScope} choices={["Unresolved", "First mortgage", "Secondary mortgage", "First and secondary"]}
          change={value => set("mortgageScope", value)} />
        <DateInput label="Review date" value={facts.reviewedOn} required change={value => {
          setFacts(current => ({ ...current, reviewedOn: value, distribution: current.distribution ?
            { ...current.distribution, sameDayOrder: current.distribution.firstOn === value ? current.distribution.sameDayOrder : undefined } : undefined }));
        }} />
        <Select label="Review time zone" value={facts.zone} choices={advertisingZones[jurisdiction]} labels={advertisingTimeZoneLabels}
          change={value => set("zone", value)} />
      </div>
      <Text label="Audience" value={facts.audience} rows={2} required change={value => set("audience", value)} />
      <Text label="Campaign scope reference" value={facts.scopeReference} rows={2} required change={value => set("scopeReference", value)} />
      {!initial && <Select label="Creative format" value={creative.kind} choices={["Text", "Archived artifact"]}
        change={kind => set("creative", kind === "Text" ? { kind, copy: "" } : { kind, reference: "", sha256: "" })} />}
      {creative.kind === "Text" ? <Text label="Exact advertising copy" value={creative.copy} rows={4} max={16000} required readOnly={!!initial}
        change={copy => set("creative", { ...creative, copy })} /> : <>
        <Text label="Archived creative reference" value={creative.reference} rows={2} required
          change={reference => set("creative", { ...creative, reference })} />
        <Text label="Archived creative SHA-256" value={creative.sha256} max={64} required readOnly={!!initial}
          change={sha256 => set("creative", { ...creative, sha256 })} />
      </>}
      <EvidenceSection title={jurisdiction === "MI" ? "Michigan claims and terms" : `${stateName} advertising checks`}>
        {facts.stateEvidence && <StateAdvertisingFields evidence={facts.stateEvidence} channel={facts.channel}
          change={value => set("stateEvidence", value)} />}
        {showStateChecks && jurisdiction !== "IN" && <>
          {jurisdiction !== "MI" && jurisdiction !== "FL" && jurisdiction !== "NY" && jurisdiction !== "CO" && jurisdiction !== "CA" && <Text label="Displayed company NMLS ID" value={facts.sponsoringCompanyDisplayed ?? ""} max={15} digits
            change={value => set("sponsoringCompanyDisplayed", value || undefined)} />}
          <Assessment label={`${stateName} claims review`} value={facts.stateClaims} choices={stateResults} change={value => set("stateClaims", value)} />
          {stateTermsReview && <>
            <Select label="Advertises specific lending terms" value={facts.specificTerms} choices={choices} change={value => set("specificTerms", value)} />
            {(facts.specificTerms === "Yes" || (facts.stateEvidence?.jurisdiction === "FL" && facts.stateEvidence.expressedRate === "Yes")) && <Assessment label={`${stateName} terms review`} value={facts.stateTerms} choices={stateResults}
              change={value => set("stateTerms", value)} />}
          </>}
        </>}
      </EvidenceSection>
      {showStateChecks && jurisdiction !== "IN" && jurisdiction !== "FL" && jurisdiction !== "NY" && jurisdiction !== "CO" && jurisdiction !== "CA" && <EvidenceSection title="Originator identifiers">
        <Select label={jurisdiction === "TX" ? "Made or distributed by a sponsored originator" : "Individual originator advertising"} value={facts.originatorAdvertising} choices={choices}
          change={value => set("originatorAdvertising", value)} />
        {(facts.originatorAdvertising === "Yes" || facts.originators.length > 0) && <>
          {facts.originators.map((originator, index) => <fieldset key={index} className="record-form min-w-0 border-t border-[var(--line)] pt-2">
            <legend className="font-medium">Originator {index + 1}</legend>
            <Text label="Originator name" value={originator.name} max={100} required change={name => changeOriginator(index, { ...originator, name })} />
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <Text label="Verified NMLS ID" value={originator.expected ?? ""} max={15} digits
                change={expected => changeOriginator(index, { ...originator, expected: expected || undefined })} />
              <Text label="Displayed NMLS ID" value={originator.displayed ?? ""} max={15} digits
                change={displayed => changeOriginator(index, { ...originator, displayed: displayed || undefined })} />
            </div>
            <Select label="Identifier visibility" value={originator.visibility} choices={["Unresolved", "Clear", "Unclear"]}
              change={visibility => changeOriginator(index, { ...originator, visibility })} />
            <Text label="Originator evidence reference" value={originator.reference ?? ""} rows={2}
              change={reference => changeOriginator(index, { ...originator, reference: reference || undefined })} />
            {(jurisdiction === "OH" || jurisdiction === "TX") && <Assessment label="Originator name matches NMLS" value={originator.nameReview} choices={stateResults}
              change={nameReview => changeOriginator(index, { ...originator, nameReview })} />}
            <div><Button variant="outline" type="button" aria-label={`Remove originator ${index + 1}`}
              onClick={() => set("originators", facts.originators.filter((_, position) => position !== index))}>Remove originator</Button></div>
          </fieldset>)}
          <div><Button type="button" variant="outline" disabled={facts.originators.length >= 20}
            onClick={() => set("originators", [...facts.originators, emptyOriginator])}>Add originator</Button></div>
          {jurisdiction === "MI" && <Text label="Displayed company NMLS ID" value={facts.sponsoringCompanyDisplayed ?? ""} max={15} digits
            change={value => set("sponsoringCompanyDisplayed", value || undefined)} />}
        </>}
      </EvidenceSection>}
      <EvidenceSection title="Federal review and archive">
        <Select label="Credit type" value={facts.creditType} choices={["Unresolved", "Closed-end", "Open-end"]} change={value => set("creditType", value)} />
        <Assessment label="Regulation Z review" value={facts.regulationZ} choices={federalResults} change={value => set("regulationZ", value)} />
        <Assessment label="Regulation N review" value={facts.regulationN} choices={federalResults} change={value => set("regulationN", value)} />
        <Select label="Federal archive rule applies" value={facts.archive.applies} choices={choices}
          change={applies => set("archive", { ...facts.archive, applies })} />
        <Text label="Archive scope reference" value={facts.archive.scopeReference ?? ""} rows={2} change={value => setArchive("scopeReference", value)} />
        {facts.archive.applies === "Yes" && <>
          <Text label="Communications and materials reference" value={facts.archive.materials ?? ""} rows={2} change={value => setArchive("materials", value)} />
          <Text label="Available mortgage products reference" value={facts.archive.availableProducts ?? ""} rows={2} change={value => setArchive("availableProducts", value)} />
          <Text label="Additional products or services reference" value={facts.archive.additionalProducts ?? ""} rows={2} change={value => setArchive("additionalProducts", value)} />
        </>}
      </EvidenceSection>
      <EvidenceSection title="Distribution">
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" className="size-4" checked={!!distribution}
            onChange={event => set("distribution", event.target.checked ? { firstOn: "", reference: "" } : undefined)} />
          Record distribution dates
        </label>
        {distribution && <>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <DateInput label="First use date" value={distribution.firstOn} required change={firstOn => set("distribution", {
              ...distribution, firstOn, sameDayOrder: firstOn === facts.reviewedOn ? distribution.sameDayOrder : undefined,
            })} />
            <DateInput label="Final use date, if ended" value={distribution.finalOn ?? ""}
              change={finalOn => set("distribution", { ...distribution, finalOn: finalOn || undefined })} />
          </div>
          {distribution.firstOn === facts.reviewedOn && <Select label="Same-day order" value={distribution.sameDayOrder ?? ""}
            choices={["", "Before review", "After review"]} labels={{ "": "Unresolved" }}
            change={sameDayOrder => set("distribution", { ...distribution, sameDayOrder: sameDayOrder || undefined })} />}
          <Text label="Distribution evidence reference" value={distribution.reference} rows={2} required
            change={reference => set("distribution", { ...distribution, reference })} />
        </>}
      </EvidenceSection>
      {initial && <Text label="Correction reason" value={correction} rows={2} required change={setCorrection} />}
    </fieldset>
    <div className="loan-application-actions">
      <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save advertising evidence"}</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button>
    </div>
  </form>;
}
