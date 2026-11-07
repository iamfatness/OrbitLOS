import type { Metadata } from "next";

export const metadata: Metadata = { title: "Address lookup privacy and terms · OrbitLOS" };

export default function AddressLookupTerms() {
  return <section className="marketing-section marketing-wrap">
    <p className="marketing-kicker">OrbitLOS demo</p>
    <h1>Address lookup privacy and terms</h1>
    <p>Street lookup is optional. You can enter an address manually and use Orbit’s ZIP suggestions without using Google Maps.</p>
    <h2>Privacy</h2>
    <p>When you choose Search with Google Maps, Orbit sends the street text and any entered ZIP to Google. When you choose a result, Orbit asks Google for that address’s components. Orbit keeps the address you choose and save with your application. Search suggestions are temporary.</p>
    <p>Google processes lookup requests under the <a className="name-link" href="https://policies.google.com/privacy">Google Privacy Policy</a>.</p>
    <h2>Terms of use</h2>
    <p>Use fictional borrower information in the Orbit demo. Review the address fields before saving, including the street number and apartment or unit. Google Maps lookup is subject to the <a className="name-link" href="https://maps.google.com/help/terms_maps/">Google Maps terms</a> and the <a className="name-link" href="https://policies.google.com/terms">Google Terms of Service</a>.</p>
  </section>;
}
