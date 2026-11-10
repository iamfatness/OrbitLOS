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
          <li>Upload a lead CSV, see who gets the next call, and carry the borrower’s details into the first and repeat 1003s. See how the next shared lead moves up after an unanswered lead reaches its retry limit.</li>
          <li>Attach a New Lead sequence to a CSV campaign. Work due calls and preview mock email or text from Today. A reply, conversion, or opt-out stops the remaining steps.</li>
          <li>Attach Cold Lead Reactivation or Past Client Outreach to a campaign. Select individual borrowers from a saved CRM segment preview or import a prepared list, then work the next steps in Today.</li>
          <li>Open the borrower portal and change call, email, or text preferences. See what changed and when in Contact History, then check that Today shows the next allowed sequence step.</li>
          <li>Set weekday and weekend contact hours in the borrower portal. Check that an out-of-hours sequence step waits for the next opening in the borrower’s time zone.</li>
          <li>Use Next call to work assigned leads one at a time. See the last call note, the scheduled callback, and any earlier promise deadline before logging the next outcome.</li>
          <li>Start a shared conversation from the lead and open its call history in Communications, even if another tab already converted it to a loan. Record simulated follow-up with brokerage opt-outs enforced.</li>
          <li>Request sample documents before the 1003, adjust deadlines from Calendar, and review uploads from My Tasks. Managers can reassign leads with open requests, and the checklist follows the lead into the loan.</li>
          <li>Preview and publish a brokerage quote form. Send eligible requests to a call campaign and keep their website source.</li>
          <li>Compare fixed-rate scenarios against a borrower’s budget and timeline. Save a recommendation and reopen its exact sample pricing option.</li>
          <li>Reuse sample brokerage fee templates by loan purpose and ZIP. Saved quotes keep their itemized amounts, and staff can trace the source and effective date.</li>
          <li>Assemble a sample disclosure package and track each mock response. Open a task from Today to follow up on a decline or compare changes and record the review with the revised package.</li>
          <li>Confirm the signed sample package from Closing. A replacement leaves the earlier confirmation and receipts in history.</li>
          <li>Download a versioned sample closing packet with the confirmed disclosure, mock signer receipts, and the checklist as it stood at preparation.</li>
          <li>Rehearse a missing mock UWM response. Recover the original submission receipt from Today and open its conditions.</li>
          <li>Issue a fictional preapproval PDF from the reviewed purchase 1003. Share the current version separately with the borrower and their realtor.</li>
          <li>Turn a past-client rate-watch follow-up into a refinance 1003 with the confirmed property address. Open both loans from the returning-client report.</li>
          <li>Log borrower or lender follow-up from Today. Managers can find overdue returns without a contact attempt and reassign the file with its activity and revised 1003 intact.</li>
          <li>See requests and sample PDFs update in open borrower and staff views across separate browser sessions. Reopen the lender checklist from the guide to review attachments already received.</li>
          <li>Preview a brokerage document checklist with borrower instructions and due dates. Add missing requests and find outstanding items in staff queues.</li>
          <li>Give two borrowers separate links to save and submit their own portions. Review the combined fictional 1003 on one loan.</li>
          <li>Assign document requests to each borrower on a joint loan. Each private checklist shows that person’s evidence and mock upload status.</li>
          <li>Run mock DU and LPA together on the same 1003 and sample credit report. Review separate findings and retry either service independently.</li>
          <li>Review a fictional income worksheet against the submitted 1003 and accepted documents. Carry the approved monthly amount into mock pricing with its source version.</li>
          <li>Give a fictional lender an expiring link for the reviewed MISMO export and selected sample PDFs. From the Demo Guide, record a lender return, replace the blocked link after review, and confirm receipt on the same lender file.</li>
          <li>When the brokerage requires a second 1003 review, open it from the guide. The manager queue distinguishes a corrected revision that needs approval from a file whose current revision already has a lender receipt.</li>
          <li>Compare the recorded Pipeline amount with a corrected 1003 request. Use the reviewed amount from the loan and see the change in its audit history.</li>
          <li>Keep alternative quotes for comparison. If the saved quote differs from the reviewed 1003, load the 1003 amount in pricing before sending to mock UWM.</li>
          <li>Float and lock a matching mock quote after the linked UWM file receives the current 1003. See the amount and 1003 revision on the confirmation while pricing another quote.</li>
          <li>Open submitted 1003s and received documents from Today or Processing and go straight to the item that needs review.</li>
          <li>Send a file to an assigned processor. See acceptance and the private return note in the open handoff, or pick the file back up from Today after mock lender clearance.</li>
          <li>Reopen a mock UWM condition and see the hold in the borrower and realtor views. If staff try to record closing or funding from an older view, the open loan shows the condition that needs attention. Replace its evidence and continue when it clears.</li>
          <li>Open a reply from Today, carry the promised callback into the loan, and log the outcome once for both loan activity and campaign reporting.</li>
          <li>See overdue callbacks across leads and loans, with the original deadline and a link to the exact follow-up.</li>
          <li>Open a CSV campaign’s Manager view to see overdue steps, logged replies, 1003 conversions, and opt-outs. Select a count to review the leads behind it.</li>
          <li>Pause a lead’s follow-up sequence, then find it under Paused sequences and resume the same step.</li>
          <li>Open Sequence performance to compare touches, replies, and stalled leads by step, then open the records behind each count.</li>
          <li>Record a post-funding check-in, see its note on the scheduled callback in Tasks, and confirm the original property address when starting a separate refinance.</li>
          <li>Claim an imported lead from the shared queue and open the prefilled 1003 directly from the campaign. The card shows the new loan even in a filtered call queue. Scheduled callbacks follow the loan, and missed deadlines stay visible in reporting.</li>
          <li>Open a fresh fictional pilot and use the guided walkthrough to explore appointments, open files, borrower conversations, and funded loans.</li>
          <li>Compare staff time and handoffs with your current process using the same fictional case.</li>
        </ul>
        <p className="marketing-request-note">In a fresh hosted pilot, the guided walkthrough reached all seven steps and opened a separate rate-watch refinance in 3 minutes 58 seconds. One signed-in staff account worked the CSV import, mock lender clearance with two sample PDFs, funding, and repeat-client follow-up. The borrower and realtor used separate fictional views. Timing excluded sign-in and spoken narration.</p>
        <p className="marketing-request-note">Prefer email? <a href="mailto:demo@orbitlos.com">demo@orbitlos.com</a></p>
      </div>
      <DemoForm />
    </section>
  </>;
}
