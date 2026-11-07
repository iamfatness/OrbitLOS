import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";

export const metadata: Metadata = {
  title: "Product · OrbitLOS",
  description: "See how mortgage brokers manage contacts, borrower applications, pricing, and lender milestones in OrbitLOS.",
};

const workflow = [
  { title: "Track the relationship", copy: "Create a loan from a new or existing borrower. Link a realtor, assign a loan officer, and log calls, emails, texts, and notes on the loan timeline." },
  { title: "Collect and review the application", copy: "Share a borrower link for the demo 1003. The borrower can save and resume. Submission puts the answers on the loan record for review and creates a follow-up task for the assigned loan officer." },
  { title: "Price the scenario", copy: "Enter a scenario, compare sample fixed-rate options, and save one to the loan. Preview the borrower quote with its payment breakdown and sample pricing label." },
  { title: "Follow the lender and keep partners informed", copy: "Try a simulated UWM submission and refresh the lender status and conditions. Keep your CRM stage separate and preview a status-only update for the linked realtor." },
];

export default function Product() {
  return (
    <>
      <section className="marketing-interior">
        <div className="marketing-wrap">
          <p className="marketing-kicker"><span /> Product</p>
          <h1>One file for the <em>whole conversation.</em></h1>
          <p>See who you’re working with, what the borrower has submitted, and what needs to happen next. The people and lender milestones stay connected to the loan.</p>
        </div>
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
            <p>Use fictional data for the demo. The application covers a subset of the 1003, and realtor updates are previews you can review in Orbit.</p>
          </div>
          <a className="marketing-button" href="/login">Staff login <ArrowRight size={17} aria-hidden="true" /></a>
        </div>
      </section>
    </>
  );
}
