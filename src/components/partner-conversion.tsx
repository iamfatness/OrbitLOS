import { useState } from "react";
import { pastClientLoan } from "@/lib/client-retention";
import type { Contact, Workspace } from "@/lib/model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

const metrics = [
  { key: "referrals", label: "Referrals" },
  { key: "submitted", label: "Submitted 1003s" },
  { key: "funded", label: "Funded / closed" },
] as const;
type Metric = (typeof metrics)[number]["key"];

export function PartnerConversion({ partners, state, openLoan }: {
  partners: Contact[]; state: Workspace; openLoan: (id: string) => void;
}) {
  const [selection, setSelection] = useState<{ partnerId: string; metric: Metric }>();
  const names = new Map(state.contacts.map((contact) => [contact.id, contact.name]));
  const applications = new Map(state.applications.map((application) => [application.loanId, application.submittedAt]));
  const report = partners.map((partner) => {
    const referrals = state.loans.filter((loan) => loan.partnerId === partner.id);
    return { partner, referrals, submitted: referrals.filter((loan) => applications.get(loan.id)),
      funded: referrals.filter(pastClientLoan), unlinked: state.unlinkedReferrals.filter((lead) => lead.realtorId === partner.id) };
  });
  const selected = report.find((item) => item.partner.id === selection?.partnerId);
  const metric = metrics.find((item) => item.key === selection?.metric);
  const selectedLoans = selected && metric ? selected[metric.key] : [];
  const selectedLeads = selected && metric?.key === "referrals" ? selected.unlinked : [];

  return <section className="pipeline" aria-label="Partner conversion">
    <div className="pipeline-heading"><div><h2>Partner conversion</h2>
      <p>All dates, grouped by the current realtor assignment. Select a count to see its records.</p></div></div>
    <div className="table-scroll"><table className="data-table">
      <thead><tr><th scope="col">Realtor</th>{metrics.map((item) => <th scope="col" key={item.key}>{item.label}</th>)}</tr></thead>
      <tbody>{report.map((row) => <tr key={row.partner.id}>
        <th scope="row">{row.partner.name}</th>
        {metrics.map((item) => {
          const count = row[item.key].length + (item.key === "referrals" ? row.unlinked.length : 0);
          const active = selection?.partnerId === row.partner.id && selection.metric === item.key;
          return <td key={item.key}><Button size="sm" variant={active ? "default" : "outline"} aria-pressed={active}
            aria-label={`${row.partner.name} · ${item.label} · ${count}`}
            onClick={() => setSelection({ partnerId: row.partner.id, metric: item.key })}>{count}</Button></td>;
        })}
      </tr>)}</tbody>
    </table></div>
    {selected && metric && <section aria-labelledby="partner-conversion-details">
      <div className="pipeline-heading"><div><h3 id="partner-conversion-details">{selected.partner.name} · {metric.label}</h3>
        <p>{selectedLoans.length + selectedLeads.length} records</p></div></div>
      {selectedLoans.length || selectedLeads.length ? <div className="table-scroll"><table className="data-table">
        <thead><tr><th scope="col">Borrower or prospect</th><th scope="col">Status</th><th scope="col">Submitted 1003</th></tr></thead>
        <tbody>
          {selectedLoans.map((loan) => {
            const submittedAt = applications.get(loan.id);
            return <tr key={loan.id}><td><button className="name-link" onClick={() => openLoan(loan.id)}>{names.get(loan.contactId) ?? "Borrower"}</button></td>
              <td>{loan.stage}</td><td>{submittedAt ? `${dateTime(submittedAt)} ET` : "—"}</td></tr>;
          })}
          {selectedLeads.map((lead) => <tr key={lead.id}><td>{lead.name}<small>Referred {dateTime(lead.createdAt)} ET</small></td>
            <td>{lead.resolvedAt ? "Closed without a linked loan" : "Awaiting conversion"}</td><td>—</td></tr>)}
        </tbody>
      </table></div> : <p className="empty-inline no-matches">No matching records for this realtor.</p>}
    </section>}
  </section>;
}
