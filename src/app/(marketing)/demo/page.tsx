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
          <li>Preview and publish a brokerage quote form. Send eligible requests to a call campaign and keep their website source.</li>
          <li>Compare fixed-rate scenarios against a borrower’s budget and timeline. Save a recommendation and reopen its exact sample pricing option.</li>
          <li>Reuse sample brokerage fee templates by loan purpose and ZIP. Saved quotes keep their itemized amounts, and staff can trace the source and effective date.</li>
          <li>Issue a fictional preapproval PDF from the reviewed purchase 1003. Share the current version separately with the borrower and their realtor.</li>
          <li>Turn a past-client rate-watch follow-up into a refinance 1003 with the confirmed property address. Open both loans from the returning-client report.</li>
          <li>Log borrower or lender follow-up from Today. Managers can find overdue returns without a contact attempt and reassign the file with its activity and revised 1003 intact.</li>
          <li>See requests and sample PDFs reach open borrower and staff views. Reopen the lender checklist from the guide to review attachments already received.</li>
          <li>Preview a brokerage document checklist with borrower instructions and due dates. Add missing requests and find outstanding items in staff queues.</li>
          <li>Give two borrowers separate links to save and submit their own portions. Review the combined fictional 1003 on one loan.</li>
          <li>Assign document requests to each borrower on a joint loan. Each private checklist shows that person’s evidence and mock upload status.</li>
          <li>Run mock DU and LPA together on the same 1003 and sample credit report. Review separate findings and retry either service independently.</li>
          <li>Review a fictional income worksheet against the submitted 1003 and accepted documents. Carry the approved monthly amount into mock pricing with its source version.</li>
          <li>Give a fictional lender an expiring link and separate code for the reviewed MISMO export and selected sample PDFs. See downloads on the loan and revoke the link.</li>
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
