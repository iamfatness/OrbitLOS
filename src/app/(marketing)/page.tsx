import { ArrowRight, ClipboardList, Layers3, Orbit, Radio, UsersRound } from "lucide-react";
import { OrbitRings } from "@/components/orbit-brand";

const tools = [
  { icon: UsersRound, title: "Referrals and relationships", copy: "Give realtors a referral link, see which referrals turn into loans, and keep in touch with past clients after closing." },
  { icon: ClipboardList, title: "Borrower applications and documents", copy: "Start a 1003 from a lead. Borrowers can save and resume, check their status, and respond to document requests." },
  { icon: Layers3, title: "Pipeline, pricing, and closing", copy: "Assign work, compare sample pricing, and track what still needs to happen before closing." },
  { icon: Radio, title: "Lender conditions", copy: "Try the mock UWM workflow from document request and review through delivery and lender clearance." },
];

export default function Home() {
  return (
    <>
      <section className="marketing-hero">
        <OrbitRings />
        <div className="marketing-wrap marketing-hero-grid">
          <div className="marketing-hero-copy">
            <p className="marketing-kicker"><span /> Loan origination and CRM for mortgage brokers</p>
            <h1>Take a lead to closing. <em>Keep the relationship.</em></h1>
            <p>OrbitLOS brings referrals, applications, pricing, loan processing, and client follow-up into one workspace for independent wholesale mortgage brokers.</p>
            <div className="marketing-actions">
              <a className="marketing-button" href="/product">Explore the product <ArrowRight size={17} aria-hidden="true" /></a>
              <a className="marketing-button marketing-button-quiet" href="/login">Log in to OrbitLOS</a>
            </div>
          </div>
          <PipelinePreview />
        </div>
      </section>
      <section className="marketing-section marketing-wrap">
        <p className="marketing-kicker">The broker workflow</p>
        <h2>Manage the loan and the relationship in one place.</h2>
        <div className="marketing-features">
          {tools.map(({ icon: Icon, title, copy }) => (
            <article key={title}>
              <span className="marketing-feature-icon"><Icon size={22} aria-hidden="true" /></span>
              <h3>{title}</h3><p>{copy}</p>
            </article>
          ))}
        </div>
        <a className="marketing-text-link" href="/product">See how the workflow fits together <ArrowRight size={16} aria-hidden="true" /></a>
      </section>
      <section className="marketing-section marketing-wrap marketing-banner-wrap">
        <div className="marketing-banner">
          <div>
            <p className="marketing-kicker">Lender integrations</p>
            <h2>UWM is the first integration we’re building.</h2>
            <p>The demo brings mock submissions, pipeline sync, and conditions into the loan record. See where Easy Qualifier pricing fits and what needs a live connection.</p>
          </div>
          <a className="marketing-button" href="/integrations">Explore integrations <ArrowRight size={17} aria-hidden="true" /></a>
        </div>
      </section>
    </>
  );
}

function PipelinePreview() {
  return (
    <figure className="marketing-preview">
      <figcaption className="sr-only">Sample Orbit loan overview</figcaption>
      <div className="marketing-preview-window">
        <div className="marketing-preview-rail" aria-hidden="true">
          <span className="brand-icon"><Orbit size={17} /></span>
          <span className="marketing-preview-selected"><Layers3 size={13} /> <span>Pipeline</span></span>
          <span><UsersRound size={13} /> <span>Contacts</span></span>
          <span><ClipboardList size={13} /> <span>Tasks</span></span>
        </div>
        <div className="marketing-preview-content">
          <div className="marketing-preview-heading"><strong>Loan overview</strong><span>Sample file</span></div>
          <div className="marketing-preview-summary">
            <p className="marketing-preview-label">Purchase · $425,000</p>
            <strong>Olivia Parker</strong>
            <div className="marketing-preview-progress">
              <span>Application</span><span>Processing</span><span>Underwriting</span>
            </div>
          </div>
          <div className="marketing-preview-next"><div><small>Next action</small><strong>Request a pay stub</strong></div><ArrowRight size={16} aria-hidden="true" /></div>
          <p className="marketing-preview-conditions"><span /> 2 UWM conditions open · Mock</p>
        </div>
      </div>
    </figure>
  );
}
