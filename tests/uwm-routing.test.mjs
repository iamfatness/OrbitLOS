import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {initializeUwmRouting,registerUwmRoute,routedUwmWorkspace,bindUwmLoanRoute,deliverUwmWebhook} from "../src/lib/uwm-routing.ts";
function fixture(t){const sql=new DatabaseSync(":memory:");t.after(()=>sql.close());const db={exec:q=>sql.exec(q),prepare:q=>sql.prepare(q),transaction:f=>f()};initializeUwmRouting(db);return db;}
const route=(brokerageId,transactionId)=>({brokerageId,transactionId,environment:"production",operationId:crypto.randomUUID()});
const event=(transactionId,number="1234567890")=>({environment:"production",kind:"import",transactionId,loanNumber:number,body:JSON.stringify({LoanStatus:"Completed"})});
test("UWM transactions route by exact environment and immutable workspace ownership",t=>{
 const db=fixture(t),a=route(crypto.randomUUID(),"one"),b=route(crypto.randomUUID(),"two");registerUwmRoute(db,a);registerUwmRoute(db,a);registerUwmRoute(db,b);
 assert.equal(routedUwmWorkspace(db,event("one")),a.brokerageId);assert.equal(routedUwmWorkspace(db,event("two")),b.brokerageId);
 assert.equal(routedUwmWorkspace(db,{...event("one"),environment:"stage"}),null);
 assert.equal(routedUwmWorkspace(db,event("unknown")),null);
 assert.throws(()=>registerUwmRoute(db,{...a,brokerageId:b.brokerageId}),/another file/);
 assert.throws(()=>registerUwmRoute(db,{...a,operationId:b.operationId}),/another file/);
});
test("completion reserves one lender file before routing conditions, rejects conflicting ownership",t=>{
 const db=fixture(t),a=route(crypto.randomUUID(),"one"),b=route(crypto.randomUUID(),"two");registerUwmRoute(db,a);registerUwmRoute(db,b);
 assert.throws(()=>bindUwmLoanRoute(db,event("unknown"),a.brokerageId),/unavailable/);
 bindUwmLoanRoute(db,event("one"),a.brokerageId);bindUwmLoanRoute(db,event("one"),a.brokerageId);
 assert.throws(()=>bindUwmLoanRoute(db,event("two"),b.brokerageId),/another import/);
 assert.equal(routedUwmWorkspace(db,{...event("one"),kind:"conditions"}),a.brokerageId);
 assert.equal(routedUwmWorkspace(db,{...event("one"),kind:"conditions",environment:"stage"}),null);
 assert.equal(routedUwmWorkspace(db,{...event("one"),kind:"ulad"}),null);
 assert.equal(routedUwmWorkspace(db,{...event("one"),kind:"status"}),null);
 initializeUwmRouting(db);assert.equal(routedUwmWorkspace(db,event("one")),a.brokerageId);
});


test("delivery uses the registered tenant, preserves retries, quarantines unknown events and rejects collisions before writes",async t=>{
 const db=fixture(t),a=route(crypto.randomUUID(),"one"),b=route(crypto.randomUUID(),"two"),fallback=crypto.randomUUID();registerUwmRoute(db,a);registerUwmRoute(db,b);
 let delivered=[];const save=async(workspace,event)=>{delivered.push([workspace,event.kind]);return {receiptId:1};};
 await assert.rejects(deliverUwmWebhook(db,event("one"),fallback,async workspace=>{assert.equal(workspace,a.brokerageId);throw new Error("temporarily unavailable");}),/unavailable/);
 await deliverUwmWebhook(db,event("one"),fallback,save);
 await deliverUwmWebhook(db,{...event("one"),kind:"conditions"},fallback,save);
 assert.deepEqual(delivered,[[a.brokerageId,"import"],[a.brokerageId,"conditions"]]);
 await assert.rejects(deliverUwmWebhook(db,event("two"),fallback,save),/another import/);assert.equal(delivered.length,2);
 await deliverUwmWebhook(db,event("unknown","9999999999"),fallback,save);assert.equal(delivered.at(-1)[0],fallback);
});
