import { ArrowRight, ClipboardList, Layers3, Radio, UsersRound } from "lucide-react";

const tools = [
  { icon: UsersRound, title: "Client relationships", copy: "Keep borrower and realtor contacts, conversations, and next steps on the loan record." },
  { icon: ClipboardList, title: "Borrower applications", copy: "Give borrowers a link to save and resume their application. Review the answers in Orbit and follow up from the same file." },
  { icon: Layers3, title: "Pipeline and pricing", copy: "Move loans through your stages, compare sample pricing, and save a quote option to the loan." },
  { icon: Radio, title: "Lender activity", copy: "Follow a simulated UWM handoff and see lender milestones and conditions alongside your own pipeline stage." },
];

export default function Home() {
  return (
    <>
      <section className="marketing-hero">
        <div className="marketing-wrap marketing-hero-grid">
          <div className="marketing-hero-copy">
            <p className="marketing-kicker"><span /> The mortgage broker workspace</p>
            <h1>From first conversation to <em>clear to close.</em></h1>
            <p>Manage clients, collect applications, price scenarios, and track lender updates in one workspace built for independent mortgage brokers.</p>
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
        <h2>Everything you need to work a loan stays with the file.</h2>
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
        <div className="marketing-preview-top"><span aria-hidden="true"><i /><i /><i /></span>Orbit pipeline · demo preview</div>
        <div className="marketing-preview-content">
          <p className="marketing-preview-label">Loan overview</p>
          <div className="marketing-preview-heading"><strong>Purchase loan</strong><span>Sample file</span></div>
          <div className="marketing-preview-progress">
            <span>Application</span><span>Processing</span><span>Underwriting</span>
          </div>
          <div className="marketing-preview-records">
            <div><span>Borrower application</span><strong>Submitted</strong><small>LO follow-up created</small></div>
            <div><span>UWM lender status</span><strong>Approved with conditions</strong><small>2 conditions open · mock sync</small></div>
          </div>
        </div>
      </div>
    </figure>
  );
}
