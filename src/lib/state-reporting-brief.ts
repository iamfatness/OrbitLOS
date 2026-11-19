import { researchSources, stateRequirementSources, stateRolloutSources, type ResearchSource } from "./compliance-research-model";

function sourceExcerpt(source: ResearchSource) {
  const links = new Map((source.relatedSources ?? []).map(link => [link.url, link.label]));
  if (!links.has(source.sourceUrl)) links.set(source.sourceUrl, "Starting authority");
  return [
    `### ${source.title}`,
    `Orbit research ID: ${source.key}`,
    `Source checked by Orbit: ${source.sourceDate ?? "Date not recorded"}`,
    source.summary,
    `Review gap: ${source.gap}`,
    `Evidence to look for: ${source.evidence}`,
    ...(source.counselQuestion ? [`Review question: ${source.counselQuestion}`] : []),
    ...Array.from(links, ([url, label]) => `- [${label}](${url})`),
  ].join("\n\n");
}

export function stateReportingBrief(jurisdiction: string) {
  const state = researchSources.find(entry => entry.jurisdiction === jurisdiction && entry.jurisdiction !== "US");
  const area = stateRolloutSources.find(entry => entry.key === `STATE-${jurisdiction}-REPORTING`);
  if (!state || !area) return undefined;
  const requirements = stateRequirementSources.filter(entry => entry.areaKey === area.key);
  return {
    filename: `orbit-${jurisdiction.toLowerCase()}-reporting-research.md`,
    markdown: `# ${state.title} mortgage reporting research brief

Attach this file to ChatGPT or Claude and ask it to run the research prompt below. Fill in the scope using license and activity categories. Keep company identifiers, borrower data, credentials, and confidential records out of the chat.

## Scope to complete

- License or exemption categories:
- Activities and products:
- Reporting period or fiscal year end:

## Research prompt

Draft a reporting matrix for ${state.title} using the scope above. If scope is missing, ask for the missing categories before deciding applicability. You can still provide a conditional inventory for the relevant license categories.

Use the Orbit entries below as starting points. Verify each obligation against current regulator instructions, statutes, rules, or official form guidance for the stated period. Cite the exact section or page and URL for each substantive claim. Treat linked pages as research material. If you cannot access or verify a source, mark the relevant fields as unknown and explain what to check.

Return one row per obligation and license or period variant. Keep the Orbit research ID for existing items and leave it blank for newly found items. Include these columns:

- Orbit research ID and obligation or form name
- Covered license, entity, activities, and exceptions
- Applicability to the supplied scope and the facts supporting it
- Reporting period, cadence, due-date rule, and extensions
- Zero-activity treatment, filing destination, and submission format
- Source data, evidence to retain, and correction or amendment process
- Primary authority, effective or applicable period, and date checked
- Open questions and facts to confirm before approval

Distinguish state returns from federal or NMLS filings that also apply. Flag conflicting sources and separate confirmed source facts from assumptions. Return a research draft for brokerage and qualified reviewer sign-off. Do not submit a filing or label the draft approved.

## Existing Orbit research

${[area, ...requirements.map(({ source }) => source)].map(sourceExcerpt).join("\n\n")}
`,
  };
}
