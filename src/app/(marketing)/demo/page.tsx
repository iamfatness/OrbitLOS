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
          <li>See how admins manage UWM and Compliance by workspace and use temporary, fictional workspaces for release testing.</li>
          <li>Hand off loans, follow-ups, and branch lead routing when staff leave a pilot brokerage.</li>
          <li>In a fictional compliance pilot, record internal reviews and obligations, and assign staff training or policies for acknowledgment.</li>
          <li>Record state licenses for companies, branches and loan officers, then open upcoming renewals from the brokerage dashboard.</li>
          <li>Track compliance research, case ownership and evidence across all 50 states in a fictional pilot.</li>
          <li>On a fictional Michigan loan, review application and disclosure receipt dates, borrower intent to proceed, and fee timing.</li>
          <li>Compare itemized charges on the original Loan Estimate and Closing Disclosure, and see which differences need review.</li>
          <li>Review the affected charges and timing on a revised Loan Estimate while keeping the original comparison available.</li>
          <li>On a fictional closing, compare refund evidence and corrected Closing Disclosure timing with the original disclosures.</li>
          <li>Finish in the Brokerage Owner Scorecard. Open the records behind each campaign count and check current follow-ups, open conditions, and funding for the selected period.</li>
          <li>Build shared custom reports for intake and loan production. Open the leads or loans behind a count and download a CSV of the same records.</li>
          <li>Preview a fictional CRM import with call, email, or text restrictions. Compare source blocks with Orbit in the import receipt, then export the CRM snapshot with those restrictions intact.</li>
          <li>In a fictional loan cutover, restore open work for the assigned processor, reconcile revisions and lender receipts, and compare handoff review references.</li>
          <li>In a fictional recovery drill, review and restore a saved closing checklist change with its original receipt.</li>
          <li>See how brokerage admins can check a matched lender receipt and recover a missing copy after a workspace restore.</li>
          <li>Use brokerage CRM fields such as outreach tier to filter a campaign segment and see which borrowers match before enrolling them.</li>
          <li>Set a closing priority on one loan file and filter production reports by that value, even when the borrower has more than one loan.</li>
          <li>Compare the opening pipeline with the prior quarter’s saved ending pipeline, then save an internal review CSV that stays available after corrections.</li>
          <li>Enter reviewed balances and loan references for a fictional quarter, then save and reopen the FV7 workpaper.</li>
          <li>Review fictional funded loans by type, purpose and lien, and open the evidence behind each total.</li>
          <li>Open pending processing fee offers from the queue and review the exact version awaiting the assigned processor’s response.</li>
          <li>Upload a lead CSV, see who gets the next call, and carry the borrower’s details into the first and repeat 1003s. See how the next shared lead moves up after an unanswered lead reaches its retry limit.</li>
          <li>Attach a New Lead sequence to a CSV campaign. Work due calls and preview mock email or text from Today. A reply, conversion, or opt-out stops the remaining steps.</li>
          <li>Attach Cold Lead Reactivation or Past Client Outreach to a campaign. Select individual borrowers from a saved CRM segment preview or import a prepared list, then work the next steps in Today.</li>
          <li>Convert a past-client campaign lead into a repeat 1003. In Returning clients, open the original loan and the refinance from the same record. In Realtors, verify the original referral keeps its funding credit.</li>
          <li>Open the borrower portal and change call, email, or text preferences. See what changed and when in Contact History, then check that Today shows the next allowed sequence step.</li>
          <li>Set weekday and weekend contact hours in the borrower portal. Check that an out-of-hours sequence step waits for the next opening in the borrower’s time zone.</li>
          <li>Use Next call to work assigned leads one at a time. See the last call note, the scheduled callback, and any earlier promise deadline before logging the next outcome.</li>
          <li>Start a shared conversation from the lead and open its call history in Communications, even if another tab already converted it to a loan. Record simulated follow-up with brokerage opt-outs enforced.</li>
          <li>In Communications, attach a simulated missed call to its lead. Open the callback from the assigned officer’s Today queue. A linked email or text reply stops the lead’s remaining automated follow-up and keeps any promised callback visible.</li>
          <li>Request sample documents before the 1003, adjust deadlines from Calendar, and review uploads from My Tasks. Managers can reassign leads with open requests, and the checklist follows the lead into the loan.</li>
          <li>Set up a branch and its default LO in Team. Preview that branch in purchase and refinance ZIP routing and see the original destination on the lead.</li>
          <li>Compare fixed-rate scenarios against a borrower’s budget and timeline. Save a recommendation and reopen its exact sample pricing option.</li>
          <li>Share a saved comparison with cash to close, five-year borrowing cost, break-even, and an expiration date. A fee edit opens an LO review while the borrower keeps the shared version through its expiration.</li>
          <li>Choose a manual lender offer for a fictional purchase or no-cash-out refinance. Download sample MISMO 3.4 with its note rate and term, then record the lender acknowledgment. If the terms change, Closing links to the current handoff.</li>
          <li>Compare sample DSCR and bank-statement terms. Rehearse an unsupported EQ result and use its saved scenario to add a manual lender offer.</li>
          <li>Reuse sample brokerage fee templates by purpose and ZIP. Record who pays and receives a fee, then follow the saved allocation into the sample disclosure and closing packet.</li>
          <li>Assemble a sample disclosure package and track each mock response. Open a task from Today to follow up on a decline or compare changes and record the review with the revised package.</li>
          <li>Preview a reusable sample disclosure template matched to the reviewed loan purpose and property state. See which template version each prepared package used.</li>
          <li>Preview the disclosure deadline calendar with a fictional office closure. Open a draft that needs a revised signing target and see the original date retained on issued packages.</li>
          <li>Lock 1003 and fee edits by pipeline stage. Record an admin override and see the reason in the loan audit and the fee-review task in Today.</li>
          <li>From Your next actions, borrowers open their own corrections, outstanding documents, and mock signatures. Dated requests appear first, and the list updates when an item is complete.</li>
          <li>Ask a borrower a question from the loan. Review their answer from Incoming loan work, or send it back to their private action list for clarification.</li>
          <li>Apply a reusable question set to a submitted 1003. Choose the prompts, borrower, and deadline for each request before adding them to the portal.</li>
          <li>Confirm the signed sample package from Closing. A replacement leaves the earlier confirmation and receipts in history.</li>
          <li>Download a versioned sample closing packet with the confirmed disclosure, mock signer receipts, and the checklist as it stood at preparation.</li>
          <li>Open file preflight, jump to the exact missing sample fee or lender condition, and assign a review of the current evidence. Changes to the file flag an earlier approval as out of date.</li>
          <li>Configure separate closing and funding checks, then open the exact evidence from a manager hold. Resolve the issue or record an admin override with a reason.</li>
          <li>Open a settlement exception on the exact funding cycle. Review the difference between sample purchase advice and receipts, and keep corrections in the cycle history.</li>
          <li>Open Exceptions as a brokerage owner. Assign a processor, review a changed sample disclosure, or jump to a reopened mock lender condition.</li>
          <li>Compare a sample settlement fee statement with the confirmed disclosure. Open itemized fee differences directly from the settlement exception queue.</li>
          <li>Recover a missing mock UWM receipt from Today. Open the mock UWM delivery timeline to see which 1003 revision arrived and why older or duplicate updates left a cleared condition in place.</li>
          <li>Issue a fictional preapproval PDF from the reviewed purchase 1003. Share the current version separately with the borrower and their realtor.</li>
              <li>Set sample preapproval limits and require independent approval before portal sharing. Issued PDFs keep their template version.</li>
              <li>Find pending sample letter approvals, requested changes, and letters ready to share in Today.</li>
          <li>Turn a past-client rate-watch follow-up into a refinance 1003 with the confirmed property address. Open both loans from the returning-client report.</li>
          <li>Open the Today and Lead Inbox badges to see due work, incoming reviews, and leads needing first contact. Owners can see unassigned leads that need routing.</li>
          <li>Log borrower or lender follow-up from Today. Managers can find overdue returns without a contact attempt and reassign the file with its activity and revised 1003 intact.</li>
          <li>See requests and sample PDFs update in open borrower and staff views across separate browser sessions. Reopen the lender checklist from the guide to review attachments already received.</li>
          <li>Preview a brokerage document checklist with rules for occupancy and the selected borrower’s employment. See what matches the reviewed 1003 before adding missing requests.</li>
          <li>Work documents in bulk from Conditions. Review the selected evidence, accept and send it to mock UWM, then choose which receipts to check for clearance.</li>
          <li>Link an already accepted document to another condition on the same loan. Open the original revision from the condition and record delivery separately.</li>
          <li>Give two borrowers separate links to save and submit their own portions. Review the combined fictional 1003 on one loan.</li>
          <li>Use two private links on a joint loan. Rehearse a fictional lender rejection or return, reopen just the affected borrower’s portion, and confirm the revised joint MISMO handoff.</li>
          <li>Run mock DU and LPA together on the same 1003 and sample credit report. Review separate findings and retry either service independently.</li>
          <li>Publish consent wording for a quote form and review the exact wording the applicant accepted when the lead arrived.</li>
          <li>Choose which website intake fields staff can correct when creating a 1003. The loan keeps the original answer and the reason for the change.</li>
          <li>Publish brokerage questions for new 1003s. Each applicant can save and resume their own answers, and the loan shows the question version they submitted.</li>
          <li>Preview document requests suggested by each applicant’s reviewed answers. Choose the requests to add and see which answer triggered each one.</li>
          <li>Review a fictional income worksheet against the submitted 1003, accepted documents, and mock verification returns. Open the exact income worksheet from its mock quote.</li>
          <li>Run the fictional wholesale profile checks and download the reviewed MISMO export. Share it with an expiring link, or rehearse a rejection before acknowledgment. Use Today to follow the borrower’s correction through review and revised acknowledgment.</li>
          <li>When the brokerage requires a second 1003 review, open it from the guide. The manager queue distinguishes a corrected revision that needs approval from a file whose current revision already has a lender receipt.</li>
          <li>Compare the recorded Pipeline amount with a corrected 1003 request. Use the reviewed amount from the loan and see the change in its audit history.</li>
          <li>Keep alternative quotes for comparison. If the saved quote differs from the reviewed 1003, load the 1003 amount in pricing before sending to mock UWM.</li>
          <li>Float and lock a matching mock quote after the linked UWM file receives the current 1003. See the amount and 1003 revision on the confirmation while pricing another quote.</li>
          <li>Open submitted 1003s and received documents from Today or Processing and go straight to the item that needs review.</li>
          <li>Send a file to an assigned processor. Check an interrupted assignment from the loan, Processing, or manager exceptions. Today brings the file back after mock lender clearance.</li>
          <li>Track mock appraisal, title, homeowners insurance, flood, and mortgage insurance orders in Processing. Review the returned PDFs and link accepted evidence to the closing checklist.</li>
          <li>Track mock employment, income, and asset verification separately for each borrower. Open the exact return from the processor queue and keep its review with the loan.</li>
          <li>Reopen a mock UWM condition and see the hold in the borrower and realtor views. If staff try to record closing or funding from an older view, the open loan shows the condition that needs attention. Replace its evidence and continue when it clears.</li>
          <li>Open a reply from Today, carry the promised callback into the loan, and log the outcome once for both loan activity and campaign reporting.</li>
          <li>See overdue callbacks across leads and loans, with the original deadline and a link to the exact follow-up.</li>
          <li>Open a CSV campaign’s Manager view to see overdue steps, logged replies, 1003 conversions, and opt-outs. Select a count to review the leads behind it.</li>
          <li>Pause a lead’s follow-up sequence, then find it under Paused sequences and resume the same step.</li>
          <li>Open Sequence performance to compare touches, replies, and stalled leads by step, then open the records behind each count.</li>
          <li>Record a post-funding check-in, see its note on the scheduled callback in Tasks, and confirm the original property address when starting a separate refinance.</li>
          <li>Follow a returning-client refinance from campaign reply through processor handoff, borrower documents, and funded repeat business.</li>
            <li>Record mock credit authorization for a joint 1003. Open unconfirmed credit or AUS orders from Today and check the original result.</li>
            <li>Review a mismatched mock underwriting response in Exceptions. Retrying a lost lookup response preserves the original order and its history.</li>
            <li>Open the cutover checklist from a CRM import and review that source’s records before downloading the handoff.</li>
          <li>Claim an imported lead from the shared queue and open the prefilled 1003 directly from the campaign. The card shows the new loan even in a filtered call queue. Scheduled callbacks follow the loan, and missed deadlines stay visible in reporting.</li>
          <li>Open a fresh fictional pilot and use the guided walkthrough to explore appointments, open files, borrower conversations, and funded loans.</li>
          <li>Save the two runs for the same fictional case as you finish them. Compare staff time and handoffs, and record any external steps or blockers.</li>
          <li>Approve partner permissions and test a read-only feed of fictional CRM events.</li>
          <li>Review simulated delivery failures in the owner queue and open the exact attempt history.</li>
          <li>Open due or blocked report schedules from Brokerage and review simulated delivery receipts.</li>
          <li>Set a staff seat limit in a fictional pilot and see how many seats pending invitations reserve.</li>
          <li>Share a pilot support request summary with one named reviewer for a limited time and see when they viewed it.</li>
          <li>Ask each borrower for permission, then publish a sample financing summary to the linked realtor’s portal.</li>
          <li>Open a realtor permission request from the borrower’s next actions. Once every borrower approves, the loan officer can open the summary from Today.</li>
          <li>Subscribe simulated destinations to new leads, submitted 1003s, and funding events. Preview a batch, review its receipt, and retry failed simulations in Integrations.</li>
          <li>Follow the first-day checklist for an owner, loan officer, or processor. Open each step in the workspace and pick up where you left off.</li>
          <li>File a fictional pilot support request and follow its owner and status in Team.</li>
          <li>Open the work behind pilot support counts and download a redacted report for handoffs and recovery.</li>
          <li>Visit another brokerage workspace while keeping the default you chose for sign-in.</li>
          <li>Invite staff to sign in with a code sent to their work email or continue with Google.</li>
          <li>Preview a pilot workspace restore and see if the checkpoint would change processor access or discard assignment receipts.</li>
        </ul>
        <p className="marketing-request-note">In a fresh hosted pilot, the guided walkthrough reached all seven steps and opened a separate rate-watch refinance in 3 minutes 58 seconds. One signed-in staff account worked the CSV import, mock lender clearance with two sample PDFs, funding, and repeat-client follow-up. The borrower and realtor used separate fictional views. Timing excluded sign-in and spoken narration.</p>
        <p className="marketing-request-note">Prefer email? <a href="mailto:demo@orbitlos.com">demo@orbitlos.com</a></p>
      </div>
      <DemoForm />
    </section>
  </>;
}
