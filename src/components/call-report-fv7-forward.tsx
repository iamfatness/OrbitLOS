"use client";

import type { Fv7Workpaper } from "@/lib/call-report-readiness-model";
import { money } from "@/lib/utils";
import { Button } from "./ui/button";

export const forwardLineLabels = {
  AC100: "Conventional", AC110: "FHA insured", AC120: "VA guaranteed", AC130: "FSA or RHS guaranteed", AC190: "Total by type",
  AC300: "Purchase", AC310: "Improvement", AC320: "Refinancing", AC390: "Total by purpose",
  AC500: "First lien", AC510: "Subordinate lien", AC520: "No real-property lien", AC590: "Total by lien",
};
type ForwardLine = keyof typeof forwardLineLabels;
type ForwardBreakdown = NonNullable<NonNullable<Fv7Workpaper["fundedReview"]>["forwardBreakdown"]>;
type ForwardChannel = ForwardBreakdown["states"][number]["channels"][number];
export type ForwardEvidenceFilter = { state: string; channel: ForwardChannel["channel"]; line: ForwardLine };
const totalLines = ["AC190", "AC390", "AC590"] as const;

export function Fv7ForwardBreakdown({ forward, stateFilter, select, openLoan }: {
  forward: ForwardBreakdown; stateFilter: string; select: (filter: ForwardEvidenceFilter, trigger: HTMLButtonElement) => void;
  openLoan: (id: string) => void;
}) {
  return <details className="document-form">
    <summary>Forward loan breakdown</summary>
    <div className="record-form">{forward.states.filter(({ state }) => !stateFilter || state === stateFilter).map(({ state, channels, unclassified }) =>
      <section className="work-queue record-form" key={state} aria-label={`${state} forward loans`}>
        <h4>{state} forward loans</h4>
        {!!unclassified.length && <div className="record-form">
          <p>{unclassified.length} {unclassified.length === 1 ? "loan needs" : "loans need"} reviewed type, purpose and lien evidence.</p>
          <ul className="document-list">{unclassified.map(({ loanId, amount, fundingReference }) => <li className="document-item" key={loanId}>
            <p><strong>{money(amount)}</strong> · <span className="break-words">{fundingReference}</span></p>
            <div><Button size="sm" variant="outline" onClick={() => openLoan(loanId)}>Open loan facts</Button></div>
          </li>)}</ul>
        </div>}
        {channels.map(({ channel, lines, ...totals }) => {
          const entries = (Object.keys(forwardLineLabels) as ForwardLine[]).flatMap(line => {
            const total = totalLines.find(code => code === line);
            const value = total ? totals[total] : lines[line as keyof typeof lines];
            return total || value.count ? [{ line, value }] : [];
          });
          return <section className="record-form" key={channel} aria-label={`${state} ${channel} forward loans`}>
            <h5 className="capitalize">{channel}</h5>
            {!totals.AC190.count ? <p className="muted">No classified loans in this channel.</p> : <table className="fv7-forward-table">
              <thead><tr><th scope="col">Line</th><th scope="col">Loans</th><th scope="col">Amount</th></tr></thead>
              <tbody>{entries.map(({ line, value }) => <tr key={line}>
                <th scope="row"><button type="button" className="name-link"
                  aria-label={`Review ${line} ${forwardLineLabels[line].toLowerCase()} in ${state} ${channel}`}
                  onClick={event => select({ state, channel, line }, event.currentTarget)}>
                  {line} · {forwardLineLabels[line]}
                </button></th>
                <td>{value.count}</td><td>{money(value.amount)}</td>
              </tr>)}</tbody>
            </table>}
          </section>;
        })}
      </section>)}</div>
  </details>;
}
