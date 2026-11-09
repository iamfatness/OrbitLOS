import type { Metadata } from "next";
import { ArrowRight, ChartNoAxesCombined, ListChecks, FileCheck2 } from "lucide-react";
import { DemoCTA } from "../demo-cta";

export const metadata: Metadata = {
  title: "Lender workflows · OrbitLOS",
  alternates: { canonical: "https://orbitlos.com/integrations" },
  description: "Keep quote comparisons, lender conditions, document requests, and closing milestones with the loan in OrbitLOS.",
};

const workflows = [
  { icon: ChartNoAxesCombined, title: "Compare the options", text: "Review quotes side by side, with itemized fees and estimated cash to close. Save the details behind each option." },
  { icon: ListChecks, title: "Work the conditions", text: "Turn a lender condition into a document request. Keep ownership, review, and clearance visible on the file." },
  { icon: FileCheck2, title: "Carry the file through closing", text: "Keep document delivery, rate-lock history, and closing milestones together so each handoff has context." },
];

export default function Integrations() {
  return <>
    <section className="marketing-interior"><div className="marketing-wrap">
      <p className="marketing-kicker">Lender workflows</p>
      <h1>From quote to closing.<br /><em>In Orbit.</em></h1>
      <p>Keep quote comparisons, conditions, and closing milestones in the same workspace as your borrower and your team.</p>
      <div className="marketing-actions"><a href="/demo" className="marketing-button">See the workflow <ArrowRight size={18} aria-hidden="true" /></a></div>
    </div></section>
    <section className="marketing-section marketing-wrap" id="availability">
      <p className="marketing-kicker">One file. A clear next step.</p>
      <h2>Keep the details moving<br />with the loan.</h2>
      <div className="orbit-tool-grid">{workflows.map(({icon: Icon, title, text}) => <article key={title}>
        <Icon size={24} aria-hidden="true" /><h3>{title}</h3><p>{text}</p>
      </article>)}</div>
    </section>
    <section className="marketing-band"><div className="marketing-section marketing-wrap">
      <p className="marketing-kicker">Explore in your demo</p>
      <h2>Follow a file through<br />the UWM workflow.</h2>
      <p className="marketing-integration-note">The walkthrough uses fictional records, sample pricing, and simulated UWM activity.</p>
      <div className="marketing-connectors">
        <article><div className="marketing-card-top"><span className="marketing-feature-icon"><ListChecks size={22} aria-hidden="true" /></span></div>
          <h3>Submission to clearance</h3>
          <p>Start with a reviewed application. Follow lender updates, request a missing document, and review the response through clearance.</p>
        </article>
        <article><div className="marketing-card-top"><span className="marketing-feature-icon"><ChartNoAxesCombined size={22} aria-hidden="true" /></span></div>
          <h3>Quote to rate lock</h3>
          <p>Compare sample pricing and save a quote. Walk through floating, locking, and extending a rate from the loan record.</p>
        </article>
      </div>
      <p className="marketing-integration-note">Working with another lender? Track conditions, document delivery, and clearance manually in the same loan file.</p>
    </div></section>
    <DemoCTA />
  </>;
}
