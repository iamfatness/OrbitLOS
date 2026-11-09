import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { sqliteStore } from "./workspace-baseline.mjs";

const { initializeStore } = await import("../src/lib/store.ts");
const { indexPendingContactOutreach, optOutLead } = await import("../src/lib/outreach-preferences.ts");
const { campaignOptOutPlans, captureCampaignOptOutCapacity, refillCampaignsAfterOptOut } = await import("../src/lib/campaign-routing.ts");

const campaigns = Number(process.argv[2] ?? 100);
const leadsPerCampaign = Number(process.argv[3] ?? 100);
const samples = Number(process.argv[4] ?? 11);
assert.ok(Number.isInteger(campaigns) && campaigns >= 2 && campaigns <= 300);
assert.ok(Number.isInteger(leadsPerCampaign) && leadsPerCampaign >= 43 && leadsPerCampaign <= 500);
assert.ok(Number.isInteger(samples) && samples >= 1 && samples <= 30);
const at = "2026-11-09T15:00:00.000Z";
const dueAt = "2026-11-10T15:00:00.000Z";
const staff = { name: "Fictional routing owner", email: "owner@example.test",
  brokerage: { id: "routing-benchmark", name: "Fictional routing benchmark", role: "Admin", pilot: true } };
const memberByEmail = new Map();
const sqlite = new DatabaseSync(":memory:");
const db = sqliteStore(sqlite);

try {
  initializeStore(db, false);
  const insertCampaign = db.prepare("INSERT INTO call_campaigns (id, name, createdAt) VALUES (?, ?, ?)");
  const insertRouting = db.prepare("INSERT INTO campaign_routing (campaignId, enabled, officers, revision) VALUES (?, 1, ?, 1)");
  const insertLead = db.prepare(`INSERT INTO referral_leads (id, requestId, name, email, phone, purpose, officer, officerEmail, createdAt, dueAt)
    VALUES (?, ?, ?, ?, ?, 'Purchase', ?, ?, ?, ?)`);
  const insertMember = db.prepare("INSERT INTO call_campaign_members (leadId, campaignId, joinedAt) VALUES (?, ?, ?)");
  const insertContact = db.prepare("INSERT INTO contacts (id, name, email, phone, role) VALUES (?, ?, ?, ?, 'Borrower')");
  const phone = (campaign, index) => `248${String(campaign * leadsPerCampaign + index).padStart(7, "0")}`;
  db.transaction(() => {
    for (let campaign = 0; campaign < campaigns; campaign++) {
      const campaignId = `campaign-${campaign}`;
      const officers = Array.from({ length: 4 }, (_, index) => {
        const email = `officer-${campaign}-${index}@example.test`;
        memberByEmail.set(email, { email, name: `Fictional officer ${campaign}-${index}` });
        return { email, limit: 10 };
      });
      insertCampaign.run(campaignId, `Fictional campaign ${campaign}`, at);
      insertRouting.run(campaignId, JSON.stringify(officers));
      for (let index = 0; index < leadsPerCampaign; index++) {
        const id = `lead-${campaign}-${index}`;
        const email = `${id}@example.test`;
        const owner = index < 40 ? memberByEmail.get(officers[index % 4].email) : undefined;
        insertLead.run(id, id, `Fictional lead ${id}`, email, phone(campaign, index), owner?.name ?? "", owner?.email ?? null, at, dueAt);
        insertMember.run(id, campaignId, at);
        insertContact.run(`contact-${id}`, `Fictional contact ${id}`, email, phone(campaign, index));
      }
    }
    insertLead.run("unrelated", "unrelated", "Fictional unrelated lead", "unrelated@example.test", "", "", null, at, dueAt);
    insertContact.run("bridge-one", "Fictional alias bridge", "lead-0-0@example.test", phone(1, 0));
    insertContact.run("bridge-two", "Fictional shared alias bridge", "lead-0-40@example.test", phone(1, 0));
    while (db.prepare("SELECT 1 FROM contact_outreach_pending LIMIT 1").get()) indexPendingContactOutreach(db);
  });

  function measure(leadId, expectedAssignments) {
    const rounds = [];
    let planCount;
    let ownerCount;
    for (let round = 0; round <= samples; round++) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const started = performance.now();
        const plans = campaignOptOutPlans(db, { kind: "lead", id: leadId });
        const selected = [...new Set(plans.flatMap(({ officers }) => officers))];
        const preflight = performance.now();
        const roster = { plans, members: selected.map((email) => memberByEmail.get(email)) };
        const capacity = captureCampaignOptOutCapacity(db, staff, roster);
        optOutLead(db, leadId, at);
        const assigned = refillCampaignsAfterOptOut(db, staff, capacity, at, roster);
        const finished = performance.now();
        assert.equal(assigned, expectedAssignments);
        if (expectedAssignments) {
          assert.equal(db.prepare("SELECT officerEmail FROM referral_leads WHERE id = 'lead-0-40'").get().officerEmail, null);
          for (const campaignId of ["campaign-0", "campaign-1"]) assert.equal(db.prepare(`SELECT count(*) AS count
            FROM referral_leads lead JOIN call_campaign_members member ON member.leadId = lead.id
            WHERE member.campaignId = ? AND lead.officerEmail IS NOT NULL`).get(campaignId).count, 41);
        }
        planCount = plans.length;
        ownerCount = selected.length;
        if (round) rounds.push({ preflightMs: preflight - started, mutationMs: finished - preflight, totalMs: finished - started });
      } finally {
        db.exec("ROLLBACK");
      }
    }
    const median = (key) => Number(rounds.map((round) => round[key]).sort((a, b) => a - b)[Math.floor(samples / 2)].toFixed(2));
    return { plans: planCount, candidateOwners: ownerCount, rosterBatchesAt30: Math.ceil(ownerCount / 30), assigned: expectedAssignments,
      medianPreflightMs: median("preflightMs"), medianMutationMs: median("mutationMs"), medianTotalMs: median("totalMs") };
  }

  console.log(JSON.stringify({ campaigns, leads: campaigns * leadsPerCampaign, contacts: campaigns * leadsPerCampaign + 2, samples,
    matching: measure("lead-0-0", 2), unrelated: measure("unrelated", 0) }, null, 2));
} finally {
  sqlite.close();
}
