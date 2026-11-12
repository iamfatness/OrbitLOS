import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
registerHooks({resolve(specifier,context,next){try{return next(specifier,context);}catch(error){if(error.code!=="ERR_MODULE_NOT_FOUND" || !specifier.startsWith("./"))throw error;return next(`${specifier}.ts`,context);}}});
const { initializeUwmWebhooks, parseUwmWebhook, readUwmWebhookReceipts, saveUwmWebhook,
  uwmWebhookHttp, uwmWebhookConnection, uwmWebhookMaxBytes } = await import("../src/lib/uwm-webhooks.ts");

const stageId = "c394bec8-16d3-4274-b4f0-13b30d18d65f";
const productionId = "69011148-c106-4456-a47c-1245140a05f1";
const token = "s".repeat(48), productionToken = "p".repeat(48), previousToken = "r".repeat(48);
const config = JSON.stringify({ stage: { brokerageId: stageId, token, previousToken }, production: { brokerageId: productionId, token: productionToken } });
const imported = { TransactionId: "tx-1", LoanNumber: "123456", LoanStatus: "Completed", Message: "Imported", LogDateTime: "2026-11-10T12:00:00Z" };
const condition = { id: "condition-1", category: "Income", bucketKey: "income", conditionDescription: "Supply paystub", conditionSatisfactionDate: "", loanNumber: "123456", loanStatus: "Approved With Conditions" };
const status = { id: "delivery-1", type: "com.uwm.LoanStatus", source: "urn:uwm-com:webhooks", data: { key: "Funded", value: "2026-11-10T12:00:00Z" } };
function request(kind = "import", body = JSON.stringify(imported), headers = {}, environment = "stage") {
  return new Request(`https://orbitlos.com/api/webhooks/uwm/${environment}/${kind}`, { method: "POST", body,
    headers: { "X-API-Key": token, "Content-Type": kind === "ulad" ? "application/xml" : "application/json", ...headers } });
}
function database(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = { exec: sql => sqlite.exec(sql), prepare: sql => sqlite.prepare(sql), transaction: fn => {
    sqlite.exec("BEGIN");
    try { const result = fn(); sqlite.exec("COMMIT"); return result; } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  initializeUwmWebhooks(db);
  return db;
}
test("authenticated import is durable before acknowledgement, retry is idempotent", async t => {
  const db = database(t);
  const persist = async (id, event) => { assert.equal(id, stageId); return saveUwmWebhook(db, event); };
  const response = await uwmWebhookHttp(request(), config, persist);
  assert.equal(response.status, 200);
  assert.equal(readUwmWebhookReceipts(db, Number.MAX_SAFE_INTEGER).length, 1);
  assert.equal((await (await uwmWebhookHttp(request(), config, persist)).json()).receipt.duplicate, true);
  assert.equal(readUwmWebhookReceipts(db, Number.MAX_SAFE_INTEGER).length, 1);
  assert.equal(db.prepare("SELECT body FROM uwm_webhook_receipts").get().body, JSON.stringify(imported));
});
test("failures and corrections retain transaction references without claiming success", t => {
  const db = database(t);
  saveUwmWebhook(db, parseUwmWebhook("stage", "import", JSON.stringify({ ...imported, LoanNumber: null, LoanStatus: "Failed" })));
  saveUwmWebhook(db, parseUwmWebhook("stage", "import", JSON.stringify(imported)));
  const rows = readUwmWebhookReceipts(db, Number.MAX_SAFE_INTEGER);
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.transactionId === "tx-1" && row.status === "Awaiting reconciliation"));
  assert.throws(() => parseUwmWebhook("stage", "import", JSON.stringify({ ...imported, LoanNumber: null })));
});
test("an early receipt stays held on an exact retry and the column upgrades existing receipt stores", (t) => {
  const db = database(t);
  const event = (transactionId) => parseUwmWebhook("stage", "import", JSON.stringify({ ...imported, TransactionId: transactionId }));
  const old = event("previously-saved");
  db.exec("ALTER TABLE uwm_webhook_receipts DROP COLUMN heldImport");
  db.prepare("INSERT INTO uwm_webhook_receipts(environment,kind,eventKey,digest,body,transactionId,loanNumber,receivedAt) VALUES(?,?,?,?,?,?,?,?)")
    .run(old.environment, old.kind, old.eventKey, old.digest, old.body, old.transactionId, old.loanNumber, "2026-11-10T12:00:00Z");
  initializeUwmWebhooks(db);
  assert.deepEqual(saveUwmWebhook(db, old), { receiptId: 1, duplicate: true, heldImport: false });
  const early = event("early");
  const saved = saveUwmWebhook(db, early, "2026-11-10T12:00:00Z", true);
  assert.equal(saved.heldImport, true);
  assert.deepEqual(saveUwmWebhook(db, early), { ...saved, duplicate: true });
  const formatted = parseUwmWebhook("stage", "import", JSON.stringify({ ...imported, TransactionId: "early", Message: "Reformatted" }, null, 2));
  const reformatted = saveUwmWebhook(db, formatted);
  assert.equal(reformatted.duplicate, false);
  assert.equal(reformatted.heldImport, true);
  const newOutcome = parseUwmWebhook("stage", "import", JSON.stringify({ ...imported, TransactionId: "early", LogDateTime: "2026-11-10T13:00:00Z" }));
  assert.equal(saveUwmWebhook(db, newOutcome).heldImport, false);
});
test("condition updates sharing an ID and conflicting status events are not discarded", t => {
  const db = database(t);
  saveUwmWebhook(db, parseUwmWebhook("stage", "conditions", JSON.stringify(condition)));
  saveUwmWebhook(db, parseUwmWebhook("stage", "conditions", JSON.stringify({ ...condition, conditionSatisfactionDate: "2026-11-10T13:00:00Z" })));
  saveUwmWebhook(db, parseUwmWebhook("stage", "status", JSON.stringify(status)));
  saveUwmWebhook(db, parseUwmWebhook("stage", "status", JSON.stringify({ ...status, data: { ...status.data, key: "Withdrawn" } })));
  assert.equal(readUwmWebhookReceipts(db, Number.MAX_SAFE_INTEGER).length, 4);
  assert.equal(db.prepare("SELECT loanNumber FROM uwm_webhook_receipts WHERE kind = 'status'").get().loanNumber, null);
});
test("environment keys and workspaces cannot be shared; rotation accepts previous key", async () => {
  const noWrite = async () => assert.fail("Unauthorized write");
  assert.equal((await uwmWebhookHttp(request("import", undefined, {}, "production"), config, noWrite)).status, 401);
  assert.equal((await uwmWebhookHttp(request("import", undefined, { "X-API-Key": "" }), config, noWrite)).status, 401);
  assert.equal((await uwmWebhookHttp(request(), "{}", noWrite)).status, 503);
  assert.equal(uwmWebhookConnection(JSON.stringify({ stage: { brokerageId: stageId, token }, production: { brokerageId: stageId, token: productionToken } }), "stage"), null);
  assert.equal((await uwmWebhookHttp(request("import", undefined, { "X-API-Key": previousToken }), config, async () => ({}))).status, 200);
});
test("payload validation, media types, XML entities, actual byte limit, and persistence failures", async () => {
  const noWrite = async () => assert.fail("Invalid payload persisted");
  for (const invalid of ["{", "{}", JSON.stringify({ ...imported, TransactionId: "" })]) {
    assert.equal((await uwmWebhookHttp(request("import", invalid), config, noWrite)).status, 400);
  }
  assert.equal((await uwmWebhookHttp(request("ulad", '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///secret">]><x/>'), config, noWrite)).status, 400);
  assert.equal((await uwmWebhookHttp(request("import", undefined, { "Content-Type": "text/plain" }), config, noWrite)).status, 415);
  assert.equal((await uwmWebhookHttp(request("import", "x".repeat(uwmWebhookMaxBytes + 1)), config, noWrite)).status, 413);
  assert.equal((await uwmWebhookHttp(request(), config, async () => { throw new Error("storage unavailable"); })).status, 503);
  assert.equal((await uwmWebhookHttp(request("ulad", '<?xml version="1.0"?><MESSAGE/>'), config, async () => ({}))).status, 200);
});
test("UWM requires a raw X-API-Key; bearer-only, prefixed, and wrong keys fail", async () => {
  const noWrite = async () => assert.fail("Unauthorized write");
  for (const headers of [
    { "X-API-Key": "", Authorization: `Bearer ${token}` },
    { "X-API-Key": `Bearer ${token}` },
    { "X-API-Key": "wrong-key" },
  ]) assert.equal((await uwmWebhookHttp(request("import", undefined, headers), config, noWrite)).status, 401);
  const req = request();
  req.headers.delete("X-API-Key");
  req.headers.set("x-api-key", token);
  assert.equal((await uwmWebhookHttp(req, config, async () => ({}))).status, 200);
});
test("condition callbacks retain the documented null outstanding date", () => {
  for (const key of Object.keys(condition).filter(key => key !== "conditionSatisfactionDate")) {
    assert.throws(() => parseUwmWebhook("stage", "conditions", JSON.stringify({ ...condition, [key]: null })));
  }
  assert.equal(parseUwmWebhook("stage", "conditions", JSON.stringify(condition)).loanNumber, "123456");
  assert.equal(parseUwmWebhook("stage", "conditions", JSON.stringify({...condition, conditionSatisfactionDate:null})).loanNumber, "123456");
});
test("route and method restrictions and metadata pagination", async t => {
  const noWrite = async () => assert.fail("Unexpected write");
  assert.equal((await uwmWebhookHttp(new Request("https://orbitlos.com/api/webhooks/uwm/stage/import"), config, noWrite)).status, 405);
  assert.equal((await uwmWebhookHttp(new Request("https://orbitlos.com/api/webhooks/uwm/stage/unknown"), config, noWrite)).status, 404);
  const db = database(t);
  for (let i = 0; i < 55; i++) saveUwmWebhook(db, parseUwmWebhook("stage", "status", JSON.stringify({ ...status, id: `delivery-${i}` })));
  const page = readUwmWebhookReceipts(db, Number.MAX_SAFE_INTEGER);
  assert.equal(page.length, 50);
  assert.equal("body" in page[0], false);
  assert.equal(readUwmWebhookReceipts(db, page.at(-1).id).length, 5);
});
test("deployment restricts callbacks even when a wrong-environment secret is installed", async () => {
  const noWrite = async () => assert.fail("Cross-environment write");
  assert.equal((await uwmWebhookHttp(request(), config, noWrite, "production")).status, 404);
  assert.equal((await uwmWebhookHttp(request(), config, noWrite, "dev")).status, 404);
  assert.equal((await uwmWebhookHttp(request(), config, async () => ({}), "stage")).status, 200);
});
test("worker routes provider callbacks before browser CSRF and restricts receipt reads", () => {
  const worker = readFileSync(new URL("../src/worker.ts", import.meta.url), "utf8");
  assert.ok(worker.indexOf('url.pathname.startsWith("/api/webhooks/uwm/")') < worker.indexOf('request.headers.get("Origin")'));
  assert.match(worker, /!staff \|\| staff.brokerage.role !== "Admin"/);
  assert.match(worker, /target \? route.brokerageId : connection.brokerageId\) !== this.#id/);
  assert.match(worker, /getByName\(demoBrokerageId\).routeUwmWebhook\(event\)/);
});
