import { useState } from "react";
import { dateLabel } from "@/lib/client-retention";
import { leadSources, type Contact, type Workspace } from "@/lib/model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

const metrics = [
  { key: "referrals", label: "Referrals" },
  { key: "submitted", label: "Submitted 1003s" },
  { key: "funded", label: "Funded loans" },
] as const;
type Metric = (typeof metrics)[number]["key"];

export function PartnerConversion({ partners, state, openLoan }: {
  partners: Contact[]; state: Workspace; openLoan: (id: string) => void;
}) {
  const [selection, setSelection] = useState<{ partnerId: string; metric: Metric }>();
  const [from, setFrom] = useState("");
  const [through, setThrough] = useState("");
  const [officer, setOfficer] = useState("");
  const [source, setSource] = useState("");
  const names = new Map(state.contacts.map((contact) => [contact.id, contact.name]));
  const applications = new Map(state.applications.map((application) => [application.loanId, application.versions.at(-1)?.submittedAt ?? application.submittedAt]));
  const funding = new Map(state.closingProgress.map((progress) => [progress.loanId, progress.fundingDate]));
  const owner = (entry: { officer: string; officerEmail: string | null }) => entry.officerEmail || entry.officer;
  const officers = new Map([...state.loans, ...state.unlinkedReferrals].map((item) => [owner(item), item.officer]));
  const inDates = (date: string) => (!from || date.slice(0, 10) >= from) && (!through || date.slice(0, 10) <= through);
  const qualifies = state.loans.filter((loan) => (!officer || owner(loan) === officer) &&
    (!source || loan.leadSource === source) && inDates(loan.createdAt ?? loan.stageSince));
  const buckets = [...partners.map((partner) => ({ id: partner.id, name: partner.name })), { id: "", name: "No realtor linked" }];
  const report = buckets.map((partner) => {
    const referrals = qualifies.filter((loan) => (loan.referralSourcePartnerId ?? loan.partnerId ?? "") === partner.id);
    return { partner, referrals, submitted: referrals.filter((loan) => applications.get(loan.id)),
      funded: referrals.filter((loan) => funding.get(loan.id)), unlinked: state.unlinkedReferrals.filter((lead) =>
        (!source || source === "Realtor referral") && lead.realtorId === partner.id && (!officer || owner(lead) === officer) && inDates(lead.createdAt)) };
  });
  const selected = report.find((item) => item.partner.id === selection?.partnerId);
  const metric = metrics.find((item) => item.key === selection?.metric);
  const selectedLoans = selected && metric ? selected[metric.key] : [];
  const selectedLeads = selected && metric?.key === "referrals" ? selected.unlinked : [];

  return <section className="pipeline" aria-label="Partner conversion">
    <div className="pipeline-heading"><div><h2>Partner conversion</h2>
      <p>Filters use the date a lead entered Orbit and its current owner. Funded counts use recorded funding dates. Open a count to see its records.</p></div></div>
    <div className="filter-row">
      <label className="field">Leads from<input type="date" value={from} max={through || undefined} onChange={(event) => setFrom(event.target.value)} /></label>
      <label className="field">Leads through<input type="date" value={through} min={from || undefined} onChange={(event) => setThrough(event.target.value)} /></label>
      <label className="field">Officer<select value={officer} onChange={(event) => setOfficer(event.target.value)}><option value="">All officers</option>
        {[...officers].filter(([key]) => key).map(([key, name]) => <option key={key} value={key}>{name || key}</option>)}</select></label>
      <label className="field">Lead source<select value={source} onChange={(event) => setSource(event.target.value)}><option value="">All lead sources</option>
        {leadSources.map((value) => <option key={value}>{value}</option>)}</select></label>
    </div>
    <div className="table-scroll"><table className="data-table">
      <thead><tr><th scope="col">Realtor</th>{metrics.map((item) => <th scope="col" key={item.key}>{item.label}</th>)}<th scope="col">Funded conversion</th></tr></thead>
      <tbody>{report.map((row) => <tr key={row.partner.id}>
        <th scope="row">{row.partner.name}{!row.partner.id && <small>Direct and other unlinked leads</small>}</th>
        {metrics.map((item) => {
          const count = row[item.key].length + (item.key === "referrals" ? row.unlinked.length : 0);
          const active = selection?.partnerId === row.partner.id && selection.metric === item.key;
          return <td key={item.key}><Button size="sm" variant={active ? "default" : "outline"} aria-pressed={active}
            aria-label={`${row.partner.name} · ${item.label} · ${count}`}
            onClick={() => setSelection({ partnerId: row.partner.id, metric: item.key })}>{count}</Button></td>;
        })}
        <td>{row.referrals.length + row.unlinked.length ? `${Math.round(100 * row.funded.length / (row.referrals.length + row.unlinked.length))}%` : "—"}
          <small>{row.funded.length} funded / {row.referrals.length + row.unlinked.length} leads</small></td>
      </tr>)}</tbody>
    </table></div>
    {selected && metric && <section aria-labelledby="partner-conversion-details">
      <div className="pipeline-heading"><div><h3 id="partner-conversion-details">{selected.partner.name} · {metric.label}</h3>
        <p>{selectedLoans.length + selectedLeads.length} records</p></div></div>
      {selectedLoans.length || selectedLeads.length ? <div className="table-scroll"><table className="data-table">
        <thead><tr><th scope="col">Borrower or prospect</th><th scope="col">Status</th><th scope="col">Submitted 1003</th><th scope="col">Funded</th></tr></thead>
        <tbody>
          {selectedLoans.map((loan) => {
            const submittedAt = applications.get(loan.id);
            const fundedOn = funding.get(loan.id);
            return <tr key={loan.id}><td><button className="name-link" onClick={() => openLoan(loan.id)}>{names.get(loan.contactId) ?? "Borrower"}</button></td>
              <td>{loan.disposition && loan.disposition !== "Active" ? loan.disposition : loan.stage}<small>{loan.leadSource}</small></td>
              <td>{submittedAt ? `${dateTime(submittedAt)} ET` : "—"}</td><td>{fundedOn ? dateLabel(fundedOn) : "—"}</td></tr>;
          })}
          {selectedLeads.map((lead) => <tr key={lead.id}><td>{lead.name}<small>Referred {dateTime(lead.createdAt)} ET</small></td>
            <td>{lead.resolvedAt ? "Closed without a linked loan" : "Awaiting conversion"}</td><td>—</td><td>—</td></tr>)}
        </tbody>
      </table></div> : <p className="empty-inline no-matches">No matching records for this realtor.</p>}
    </section>}
  </section>;
}
