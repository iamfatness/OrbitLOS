import { ArrowRight } from "lucide-react";

export const demoHref = "/demo";

export function DemoCTA() {
  return <section className="marketing-section marketing-wrap marketing-banner-wrap" id="demo">
    <div className="marketing-banner marketing-demo">
      <div><p className="marketing-kicker">See OrbitLOS in action</p>
        <h2>Bring your brokerage into Orbit.</h2>
        <p>See how your team can manage the day, move loans forward, and build repeat business.</p>
      </div>
      <div className="marketing-demo-contact"><a className="marketing-button" href={demoHref}>Request a demo <ArrowRight size={17} aria-hidden="true" /></a><a href="mailto:demo@orbitlos.com">Or email demo@orbitlos.com</a></div>
    </div>
  </section>;
}
