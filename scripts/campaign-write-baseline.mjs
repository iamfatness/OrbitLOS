import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { profiles, seedFictionalWorkspace, sqliteStore } from "./workspace-baseline.mjs";

const { executeCommand } = await import("../src/lib/commands.ts");
const { campaignOrigin, parseCampaignLeadCsv } = await import("../src/lib/call-campaign-model.ts");
const { initializeStore } = await import("../src/lib/store.ts");
const sqlite = new DatabaseSync(":memory:");
const db = sqliteStore(sqlite);
const existing = Number(process.argv[2] ?? 10_000);
assert.ok(Number.isInteger(existing) && existing >= 1 && existing <= 50_000);
const campaignId = randomUUID();
const unrelatedCampaignId = randomUUID();
const at = "2026-11-09T15:00:00.000Z";
const dueAt = "2026-11-10T15:00:00.000Z";
const staff = { name: "Fictional campaign owner", email: "owner@example.test",
  brokerage: { id: "campaign-benchmark", name: "Fictional campaign benchmark", role: "Admin", pilot: true } };
const officer = { name: "Fictional loan officer", email: "officer@example.test", role: "LO", status: "Active" };
const roster = [officer];
const csv = ["id,name,phone,email,purpose", ...Array.from({ length: 100 }, (_, index) =>
  `csv-${index},Fictional imported lead ${index},248555${1000 + index},csv-${index}@example.test,Purchase`)].join("\n");
const input = { type: "migratePipeline", campaignId, origin: campaignOrigin(campaignId), decisions: {},
  rows: parseCampaignLeadCsv(csv, at).map((row) => ({ ...row, dueAt })) };

try {
  initializeStore(db, false);
  seedFictionalWorkspace(db, profiles.small, officer.email, "backup@example.test");
  db.prepare("INSERT INTO call_campaigns (id, name, createdAt) VALUES (?, 'Upload rehearsal', ?), (?, 'Existing campaign', ?)")
    .run(campaignId, at, unrelatedCampaignId, at);
  db.prepare(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ?)
    INSERT INTO referral_leads (id, requestId, name, email, phone, purpose, officer, createdAt, dueAt)
    SELECT printf('existing-%06d', n), printf('existing-%06d', n), printf('Fictional existing lead %06d', n),
      printf('existing-%06d@example.test', n), printf('947%07d', n), 'Purchase', '', ?, ? FROM seq`).run(existing, at, dueAt);
  db.prepare("INSERT INTO call_campaign_members (campaignId, leadId, joinedAt) SELECT ?, id, ? FROM referral_leads")
    .run(unrelatedCampaignId, at);

  async function measure(command) {
    const start = performance.now();
    const result = await executeCommand(db, command, staff, undefined, roster,
      { scopedLeadUpdates: true, scopedLoanUpdates: true });
    const json = JSON.stringify(result);
    assert.ok(result.message, result.error);
    return { result, bytes: Buffer.byteLength(json), elapsedMs: Number((performance.now() - start).toFixed(2)) };
  }
  const preview = await measure(input);
  assert.ok(preview.result.migration.rows.every(({ status }) => status === "Create"));
  const commit = await measure({ ...input, preview: preview.result.migration.fingerprint });
  const leads = commit.result.migration.rows.map(({ targetId }) => ({ id: targetId, previousEmail: null }));
  assert.equal(new Set(leads.map(({ id }) => id)).size, 100);
  assert.equal(db.prepare("SELECT count(*) AS count FROM call_campaign_members WHERE campaignId = ?").get(campaignId).count, 100);
  const assignment = await measure({ type: "assignCampaignLeads", campaignId, email: officer.email, leads });
  assert.equal(db.prepare(`SELECT count(*) AS count FROM call_campaign_members member JOIN referral_leads lead ON lead.id = member.leadId
    WHERE member.campaignId = ? AND lead.officerEmail = ? AND lead.dueAt = ?`).get(campaignId, officer.email, dueAt).count, 100);
  assert.equal(db.prepare("SELECT count(*) AS count FROM referral_leads WHERE id LIKE 'existing-%' AND officerEmail IS NOT NULL").get().count, 0);
  const fullRefresh = await measure({ type: "refreshWorkspace" });
  const campaignRefresh = await measure({ type: "refreshCampaignQueue", campaignId });
  const campaignEntry = await measure({ type: "openCampaigns", campaignId, loadIntake: true });
  assert.equal(campaignRefresh.result.state, undefined);
  assert.deepEqual(campaignRefresh.result.campaignQueue.members,
    fullRefresh.result.state.callCampaignMembers.filter((member) => member.campaignId === campaignId));
  assert.deepEqual(campaignRefresh.result.campaignQueue.inboxLeads,
    fullRefresh.result.state.inboxLeads.filter((lead) => lead.campaignId === campaignId));
  assert.deepEqual(campaignEntry.result.campaignNavigation.queue, campaignRefresh.result.campaignQueue);
  assert.equal(campaignEntry.result.campaignNavigation.campaigns.length, 2);
  const stats = ({ bytes, elapsedMs }) => ({ bytes, elapsedMs });
  console.log(JSON.stringify({ existing, imported: leads.length, unrelated: profiles.small,
    preview: stats(preview), commit: stats(commit), assignment: stats(assignment),
    fullRefresh: stats(fullRefresh), campaignRefresh: stats(campaignRefresh), campaignEntry: stats(campaignEntry) }, null, 2));
} finally {
  sqlite.close();
}
