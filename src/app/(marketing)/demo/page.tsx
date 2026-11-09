import type { Metadata } from "next";
import { DemoForm } from "./request-form";

export const metadata: Metadata = {
  title: "Request a demo · OrbitLOS",
  description: "See how OrbitLOS brings your leads, loans, team, and business reporting into one workspace. Request a walkthrough for your brokerage.",
  alternates: { canonical: "https://orbitlos.com/demo" },
};

export default function DemoPage() {
  return <>
    <section className="marketing-interior marketing-demo-intro"><div className="marketing-wrap">
      <p className="marketing-kicker"><span /> Let’s talk about your brokerage</p>
      <h1>Your brokerage.<br /><em>In Orbit.</em></h1>
      <p>Tell us about your team. We’ll email you to arrange a walkthrough focused on your business.</p>
    </div></section>
    <section className="marketing-section marketing-wrap marketing-request-layout">
      <div><p className="marketing-kicker">Your walkthrough</p><h2>See the work come together.</h2>
        <ul className="marketing-detail-list">
          <li>See your pipeline, team workload, and funding in one view.</li>
          <li>Upload a lead CSV, see who gets the next call, and carry the borrower’s details into the first and repeat 1003s.</li>
          <li>Turn a past-client rate-watch follow-up into a refinance 1003 with the confirmed property address. Open both loans from the returning-client report.</li>
          <li>Download a reviewed MISMO 3.4 sample and record a fictional lender acknowledgment. When the lender asks for corrections, send the revised application back under the same reference with the condition history intact.</li>
          <li>See requests and sample PDFs reach open borrower and staff views. Reopen the lender checklist from the guide to review attachments already received.</li>
          <li>Open submitted 1003s and received documents from Today or Processing and go straight to the item that needs review.</li>
          <li>Send a file to an assigned processor. Watch it appear in the open Ready to accept queue, work through mock lender clearance, and pick it back up in Today with the processor’s internal note.</li>
          <li>Open a reply from Today, carry the promised callback into the loan, and log the outcome once for both loan activity and campaign reporting.</li>
          <li>See overdue callbacks across leads and loans, with the original deadline and a link to the exact follow-up.</li>
          <li>Open scheduled campaign calls from one queue. Reschedule from the loan and keep missed deadlines visible in reporting.</li>
          <li>Explore a fictional brokerage’s appointments, open files, borrower conversations, and funded loans without entering customer data.</li>
          <li>Compare staff time and handoffs with your current process using the same fictional case.</li>
        </ul>
        <p className="marketing-request-note">A live browser rehearsal took 3 minutes 27 seconds from opening the CSV importer to the rate-watch follow-up, including two sample PDFs, mock lender clearance, funding, and a separate prefilled refinance 1003. The timed workflow followed setup and used one staff account, fictional records, and no spoken narration.</p>
        <p className="marketing-request-note">Prefer email? <a href="mailto:demo@orbitlos.com">demo@orbitlos.com</a></p>
      </div>
      <DemoForm />
    </section>
  </>;
}
