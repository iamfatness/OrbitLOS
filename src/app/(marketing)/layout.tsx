import { ArrowUpRight, Orbit } from "lucide-react";
import type { Metadata } from "next";
import Script from "next/script";
import "./marketing.css";
import { demoHref } from "./demo-cta";

export const metadata: Metadata = {
  metadataBase: new URL("https://orbitlos.com"),
  openGraph: {
    type: "website", siteName: "OrbitLOS", title: "Every loan. Every relationship. In Orbit.",
    description: "One workspace for mortgage leads, loans, relationships, and the team moving them forward.",
    images: [{ url: "/marketing/social-preview.png", width: 1200, height: 630, alt: "OrbitLOS — Every loan. Every relationship. In Orbit." }],
  },
  twitter: { card: "summary_large_image", title: "Every loan. Every relationship. In Orbit.", description: "Loan origination and CRM for independent wholesale mortgage brokers.", images: ["/marketing/social-preview.png"] },
};

/* eslint-disable @next/next/no-html-link-for-pages -- Public routes use document navigation at the Worker boundary. */

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="marketing">
      <Script id="orbit-google-tag-manager" src="https://www.googletagmanager.com/gtm.js?id=GTM-WGL2P6H7" strategy="beforeInteractive" async />
      <Script id="orbit-google-tag-init" strategy="beforeInteractive">{`
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());
      `}</Script>
      <a className="marketing-skip" href="#content">Skip to content</a>
      <header className="marketing-header">
        <div className="marketing-wrap marketing-nav">
          <a href="/" className="marketing-brand" aria-label="OrbitLOS home">
            <span><Orbit size={23} aria-hidden="true" /></span>OrbitLOS
          </a>
          <nav aria-label="Main navigation">
            <a href="/product">Product</a>
            <a href="/integrations">Lenders</a>
          </nav>
          <a className="marketing-login" href="/login">Log in <ArrowUpRight size={16} aria-hidden="true" /></a>
          <a className="marketing-button marketing-nav-demo" href={demoHref}>Request a demo</a>
        </div>
      </header>
      <main id="content">{children}</main>
      <footer className="marketing-footer">
        <div className="marketing-wrap">
          <p><strong>OrbitLOS</strong> <span>Built for independent mortgage brokers.</span></p>
          <nav aria-label="Footer navigation">
            <a href="/product">Product</a>
            <a href="/integrations">Lender workflows</a>
            <a href={demoHref}>Request a demo</a>
            <a href="/product#faq">FAQ</a>
            <a href="/login">Staff login</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
