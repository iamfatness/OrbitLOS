import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {initializeUwmRouting,registerUwmRoute,findUwmWebhookRoute,deliverUwmWebhook} from "../src/lib/uwm-routing.ts";
function fixture(t){const sql=new DatabaseSync(":memory:");t.after(()=>sql.close());const db={exec:q=>sql.exec(q),prepare:q=>sql.prepare(q),transaction:f=>f()};initializeUwmRouting(db);return db;}
const route=(brokerageId,transactionId)=>({brokerageId,transactionId,environment:"production",operationId:crypto.randomUUID()});
const event=(transactionId,number="1234567890")=>({environment:"production",kind:"import",transactionId,loanNumber:number,body:JSON.stringify({LoanStatus:"Completed"})});
test("UWM transactions route by exact environment and immutable workspace ownership",t=>{
 const db=fixture(t),a=route(crypto.randomUUID(),"one"),b=route(crypto.randomUUID(),"two");registerUwmRoute(db,a);registerUwmRoute(db,a);registerUwmRoute(db,b);
 assert.equal(findUwmWebhookRoute(db,event("one")).brokerageId,a.brokerageId);assert.equal(findUwmWebhookRoute(db,event("two")).brokerageId,b.brokerageId);
 assert.equal(findUwmWebhookRoute(db,{...event("one"),environment:"stage"}),null);
 assert.equal(findUwmWebhookRoute(db,event("unknown")),null);
 assert.throws(()=>registerUwmRoute(db,{...a,brokerageId:b.brokerageId}),/another file/);
 assert.throws(()=>registerUwmRoute(db,{...a,operationId:b.operationId}),/another file/);
});
test("delivery preserves a pending reservation but routes downstream only after tenant verification", async t => {
  const db = fixture(t);
  const a = route(crypto.randomUUID(), "one");
  const b = route(crypto.randomUUID(), "two");
  const fallback = crypto.randomUUID();
  registerUwmRoute(db, a);
  registerUwmRoute(db, b);
  const delivered = [];
  const completions = [];
  let claimed = false;
  let verified = false;
  let interrupt = true;
  const receive = (body) => deliverUwmWebhook(db, body, fallback, {
    persist: async (target, current) => {
      delivered.push([target, current.kind]);
      return { receiptId: 1, duplicate: false, claimLoanNumber: claimed && current.kind === "import" && target !== fallback };
    },
    verify: async (target) => verified && target.operationId === a.operationId,
    complete: async (target) => {
      if (interrupt) throw new Error("temporarily unavailable");
      completions.push(target.operationId);
      verified = true;
    },
  });
  const conditions = { ...event("one"), kind: "conditions" };
  await receive(event("one"));
  assert.equal(findUwmWebhookRoute(db, conditions), null);
  claimed = true;
  await assert.rejects(receive(event("one")), /unavailable/);
  assert.equal(findUwmWebhookRoute(db, conditions).brokerageId, a.brokerageId);
  await receive(conditions);
  assert.deepEqual(delivered.at(-1), [fallback, "conditions"]);
  await assert.rejects(receive(event("two")), /conflicts/);
  await assert.rejects(receive(event("one", "1234567891")), /conflicts/);
  assert.deepEqual(completions, []);
  interrupt = false;
  await receive(event("one"));
  await receive(conditions);
  assert.deepEqual(delivered.at(-1), [a.brokerageId, "conditions"]);
  assert.deepEqual(completions, [a.operationId]);
  assert.equal(findUwmWebhookRoute(db, { ...conditions, environment: "stage" }), null);
  assert.equal(findUwmWebhookRoute(db, { ...conditions, kind: "ulad" }).brokerageId, a.brokerageId);
  assert.equal(findUwmWebhookRoute(db, { ...conditions, kind: "status" }), null);
  await receive(event("unknown", "9999999999"));
  assert.deepEqual(delivered.at(-1), [fallback, "import"]);
  initializeUwmRouting(db);
  assert.equal(findUwmWebhookRoute(db, conditions).brokerageId, a.brokerageId);
});
