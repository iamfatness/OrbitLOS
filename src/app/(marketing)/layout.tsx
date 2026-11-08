import { Orbit } from "lucide-react";
import "./marketing.css";

/* eslint-disable @next/next/no-html-link-for-pages -- Public routes use document navigation at the Worker boundary. */

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="marketing">
      <a className="marketing-skip" href="#content">Skip to content</a>
      <header className="marketing-header">
        <div className="marketing-wrap marketing-nav">
          <a href="/" className="marketing-brand" aria-label="OrbitLOS home">
            <span><Orbit size={23} aria-hidden="true" /></span>OrbitLOS
          </a>
          <nav aria-label="Main navigation">
            <a href="/product">Product</a>
            <a href="/integrations">Integrations</a>
          </nav>
          <a className="marketing-login" href="/login">Log in <span aria-hidden="true">↗</span></a>
        </div>
      </header>
      <main id="content">{children}</main>
      <footer className="marketing-footer">
        <div className="marketing-wrap">
          <p><strong>OrbitLOS</strong> <span>Built for independent mortgage brokers.</span></p>
          <nav aria-label="Footer navigation">
            <a href="/product">Product</a>
            <a href="/integrations">Integrations</a>
            <a href="/login">Staff login</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
