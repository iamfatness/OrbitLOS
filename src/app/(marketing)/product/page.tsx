import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";

export const metadata: Metadata = {
  title: "Product · OrbitLOS",
  description: "See the OrbitLOS workflow from realtor referral and borrower 1003 through processing, closing, and past-client follow-up.",
};

const workflow = [
  { title: "Bring in the lead", copy: "Start a lead directly or convert a realtor referral into a prefilled 1003. Review contact matches, assign an officer, and keep the original referral attached to the file." },
  { title: "Collect and review the 1003", copy: "Share an application the borrower can save and resume. Request corrections, compare versions, and see the application and document checklist together before handing off the file." },
  { title: "Work from the loan and My Tasks", copy: "See who owns the file, what’s due, and what is blocking it. Compare saved sample conventional, DSCR, and bank statement scenarios. Review mock credit, DU, and LPA findings from the same loan." },
  { title: "Work conditions and prepare for closing", copy: "Keep delivery and lender clearance separate. In the pilot, try mock UWM conditions or track another lender manually. Hand off the closing checklist and record signing, closing, and funding." },
  { title: "Keep the relationship after closing", copy: "Use a shared contact history to start a repeat loan. See which referrals reached funding, log outreach, and plan follow-ups using closing anniversaries and rate-watch targets." },
];

export default function Product() {
  return (
    <>
      <section className="marketing-interior">
        <div className="marketing-wrap">
          <p className="marketing-kicker"><span /> Product</p>
          <h1>One workspace from <em>referral to repeat business.</em></h1>
          <p>Work a loan from the first conversation through closing. Keep the borrower, realtor, team, and lender activity connected to the same file.</p>
        </div>
      </section>
      <section className="marketing-section marketing-wrap marketing-story">
        <div>
          <p className="marketing-kicker">Review before sharing</p>
          <h2>Start with the facts already in the file.</h2>
        </div>
        <p>Prepare a condition response from the lender request and document review, or draft a realtor update from the current milestone. Edit the message before copying it. Orbit also shows the observed rate and target behind a past-client follow-up.</p>
      </section>
      <section className="marketing-section marketing-wrap marketing-story">
        <div>
          <p className="marketing-kicker">From lead to closing</p>
          <h2>How a loan moves through Orbit</h2>
          <p>Use the board to see where loans stand, switch to the list to filter your pipeline, or work directly from your task queue.</p>
        </div>
        <ol className="marketing-steps">
          {workflow.map(({ title, copy }, index) => (
            <li key={title}><span aria-hidden="true">0{index + 1}</span><div><h3>{title}</h3><p>{copy}</p></div></li>
          ))}
        </ol>
      </section>
      <section className="marketing-section marketing-wrap marketing-banner-wrap">
        <div className="marketing-banner">
          <div>
            <p className="marketing-kicker">Demo workspace</p>
            <h2>Walk through a sample loan.</h2>
            <p>Invited staff can walk through a fictional loan, from referral and 1003 through sample pricing, mock UWM conditions, and borrower and realtor follow-up.</p>
          </div>
          <a className="marketing-button" href="/login">Staff login <ArrowRight size={17} aria-hidden="true" /></a>
        </div>
      </section>
    </>
  );
}
