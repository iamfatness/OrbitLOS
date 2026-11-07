import type { Contact, Loan, Stage, Submission } from "./model";

const files = [
  ["Olivia Parker", 425000, "Bloomfield Hills, MI", "Lead", "Alex Morgan", 1],
  ["Ethan Brooks", 312000, "Royal Oak, MI", "Lead", "Jamie Chen", 3],
  ["Maya & Noah Chen", 685000, "Birmingham, MI", "Pre-qual", "Alex Morgan", 2],
  ["Sofia Martinez", 398000, "Troy, MI", "Pre-qual", "Jamie Chen", 4],
  ["Jackson Reed", 542000, "Ann Arbor, MI", "Application", "Alex Morgan", 1],
  ["Isabella Patel", 364500, "Canton, MI", "Application", "Jamie Chen", 3],
  ["Avery Williams", 475000, "Novi, MI", "Processing", "Alex Morgan", 5],
  ["Liam Thompson", 529000, "Rochester, MI", "Processing", "Jamie Chen", 2],
  ["Charlotte Kim", 618000, "Plymouth, MI", "Underwriting", "Alex Morgan", 6],
  ["Elijah Robinson", 285000, "Ferndale, MI", "Underwriting", "Jamie Chen", 2],
  ["Amelia Davis", 415000, "Northville, MI", "Clear to Close", "Alex Morgan", 1],
  ["Lucas Rivera", 349000, "Farmington, MI", "Funded", "Jamie Chen", 3],
  ["Harper Wilson", 468000, "West Bloomfield, MI", "Closed", "Alex Morgan", 8],
] as const satisfies readonly (readonly [string, number, string, Stage, string, number])[];

export function demoRecords() {
  const contacts: Contact[] = [
    { id: "partner-1", name: "Taylor Bennett", email: "taylor@example.test", phone: "", role: "Realtor" },
    { id: "partner-2", name: "Jordan Ellis", email: "jordan@example.test", phone: "", role: "Realtor" },
  ];
  const loans: Loan[] = files.map(([name, amount, address, stage, officer, days], index) => {
    const contactId = `contact-${index + 1}`;
    contacts.push({ id: contactId, name, email: `borrower${index + 1}@example.test`, phone: "", role: "Borrower" });
    return {
      id: `loan-${index + 1}`, contactId, address, amount, stage, officer, officerEmail: null,
      partnerId: index % 3 === 0 ? "partner-1" : index % 3 === 1 ? "partner-2" : null,
      purpose: index % 4 === 1 ? "Refinance" : "Purchase",
      stageSince: new Date(Date.now() - days * 86_400_000).toISOString(),
    };
  });
  const submissions: Submission[] = [
    { id: "demo-uwm-9", loanId: "loan-9", lender: "UWM", externalId: "9000001001", status: "Wholesale - Underwriting", conditions: [], syncedAt: null },
    { id: "demo-uwm-11", loanId: "loan-11", lender: "UWM", externalId: "9000001002", status: "Wholesale - Clear To Close", conditions: [], syncedAt: null },
    { id: "demo-manual", loanId: "loan-8", lender: "Rocket Pro", externalId: "DEMO-221", status: "File received", conditions: [], syncedAt: null },
  ];
  return { contacts, loans, submissions };
}
