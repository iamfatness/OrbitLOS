const questions = [
  ["Who is OrbitLOS built for?", "Independent wholesale mortgage brokers, from individual loan officers to teams with dedicated processors and managers."],
  ["What does Orbit bring together?", "Lead follow-up, borrower applications, loan processing, team priorities, and business reporting. Your team shares the record and keeps ownership clear."],
  ["What will I see in a demo?", "Follow a loan from first contact through closing, then explore the owner, loan officer, and processor views. Demos use fictional records, sample pricing, and simulated lender activity."],
  ["How does migration work?", "Preview your CRM import, map fields and owners, and review duplicates before bringing records into Orbit. We’ll walk through the process with your team."],
  ["What does OrbitLOS cost?", "Request a demo to discuss pricing for your team and the workflows you need."],
  ["How should we prepare?", "Bring the people who manage your pipeline and a few examples of where work slows down. We’ll provide the sample loan records."],
];

export function BuyerFAQ() {
  return <section className="marketing-section marketing-wrap marketing-faq" id="faq">
    <div><p className="marketing-kicker">Before we meet</p><h2>Your questions,<br />answered.</h2><a className="marketing-text-link" href="/demo">Talk about your brokerage</a></div>
    <div>{questions.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div>
  </section>;
}
