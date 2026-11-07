import type { Metadata } from "next";
import { ArrowRight, ChartNoAxesCombined, RefreshCw } from "lucide-react";

export const metadata: Metadata = {
  title: "Lender integrations · OrbitLOS",
  description: "Explore OrbitLOS’s UWM pipeline and conditions demo, Easy Qualifier pricing plans, and future provider integrations.",
};

export default function Integrations() {
  return (
    <>
      <section className="marketing-interior">
        <div className="marketing-wrap">
          <p className="marketing-kicker"><span /> Integrations</p>
          <h1>Bring the lender into <em>the loan record.</em></h1>
          <p>See what the lender needs while you manage the borrower relationship. Orbit starts with United Wholesale Mortgage and is designed to support more providers over time.</p>
        </div>
      </section>
      <section className="marketing-section marketing-wrap">
        <p className="marketing-kicker">United Wholesale Mortgage</p>
        <h2>Two ways UWM fits into Orbit</h2>
        <div className="marketing-connectors">
          <article>
            <div className="marketing-card-top"><span className="marketing-feature-icon"><RefreshCw size={22} aria-hidden="true" /></span><span className="marketing-status">Simulated in demo</span></div>
            <h3>Pipeline and conditions</h3>
            <p>Try a mock submission from a reviewed application. Turn a condition into a borrower document request, review the response, and see mock delivery and clearance separately.</p>
          </article>
          <article>
            <div className="marketing-card-top"><span className="marketing-feature-icon"><ChartNoAxesCombined size={22} aria-hidden="true" /></span><span className="marketing-status">Sample rates in demo</span></div>
            <h3>Easy Qualifier pricing</h3>
            <p>Compare and save example pricing, then simulate floating, locking, extending, or cancelling a rate. The initial Easy Qualifier connection targets UWM’s test environment and requires UWM-issued credentials.</p>
          </article>
        </div>
        <p className="marketing-integration-note">The hosted pilot uses fictional data, sample rates, and simulated lender activity. Staff can also track other lenders manually from the loan record.</p>
      </section>
      <section className="marketing-section marketing-wrap marketing-banner-wrap">
        <div className="marketing-banner">
          <div>
            <p className="marketing-kicker">Additional providers</p>
            <h2>More pricing, lender, and provider connections are planned.</h2>
            <p>Optimal Blue is a candidate for future pricing coverage. The demo simulates credit and automated underwriting, email verification, and document scanning. Live provider connections and e-signature are planned.</p>
          </div>
          <a className="marketing-button" href="/product">See the broker workflow <ArrowRight size={17} aria-hidden="true" /></a>
        </div>
      </section>
    </>
  );
}
