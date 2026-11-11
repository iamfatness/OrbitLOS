import assert from "node:assert/strict";
import test from "node:test";
import {expectedDeadline, reviewPending, remainingReplay} from "../scripts/hosted-recovery/reconciliation.mjs";

const identity={tenant:"fictional-a",run:"run-1",source:"source-1"};
const before={id:"request-1",revision:2,deadlineRevision:3,dueOn:"2030-01-01"};
const pending={...identity,status:"pending",before,command:{type:"setDocumentDeadline",loanId:"loan-1",requestId:before.id,
  revision:2,deadlineRevision:3,dueOn:"2030-02-03"}};
const acknowledged={...pending,status:"acknowledged",after:expectedDeadline(pending)};
const next={...pending,before:acknowledged.after,command:{...pending.command,deadlineRevision:4,dueOn:"2030-02-10"}};
const reconciled={...next,status:"reconciled",after:expectedDeadline(next),review:{decision:"preserve-observed",
  by:"reviewer@example.test",at:"2030-02-04T12:00:00Z",observed:expectedDeadline(next)}};

test("lost acknowledgment requires review, and a matching value alone is insufficient",()=>{
  assert.equal(reviewPending(pending,expectedDeadline(pending),identity),"matches-intended-revision");
  assert.throws(()=>remainingReplay([pending],before,identity),/provenance|Unverified/);
  assert.equal(reviewPending(pending,{...expectedDeadline(pending),deadlineRevision:8},identity),"conflict");
  assert.equal(reviewPending(pending,{...expectedDeadline(pending),revision:3},identity),"conflict");
});
test("undispatched, missing and no-op writes do not become acknowledgments",()=>{
  assert.equal(reviewPending(pending,before,identity),"not-observed");
  assert.equal(reviewPending(pending,null,identity),"unavailable");
  const noop={...pending,command:{...pending.command,dueOn:before.dueOn}};
  assert.equal(reviewPending(noop,before,identity),"not-observed");
  assert.throws(()=>reviewPending(pending,before,{...identity,tenant:"fictional-b"}),/provenance/);
});
test("replay resumes at the exact revision and repeated full replay is empty",()=>{
  const receipts=[acknowledged,reconciled];
  assert.deepEqual(remainingReplay(receipts,before,identity),receipts);
  assert.deepEqual(remainingReplay(receipts,acknowledged.after,identity),[reconciled]);
  assert.deepEqual(remainingReplay(receipts,reconciled.after,identity),[]);
  assert.throws(()=>remainingReplay(receipts,{...reconciled.after,deadlineRevision:9},identity),/conflicts/);
});
test("foreign, changed, discontinuous and unreviewed recovery evidence is refused",()=>{
  for(const changed of [{...reconciled,tenant:"fictional-b"},{...reconciled,source:"other-build"},
    {...reconciled,run:"other-run"},{...reconciled,review:undefined},
    {...reconciled,review:{...reconciled.review,observed:before}},
    {...reconciled,after:{...reconciled.after,dueOn:"2030-06-01"}},
    {...reconciled,command:{...reconciled.command,requestId:"other-request"}}]) {
    assert.throws(()=>remainingReplay([acknowledged,changed],before,identity));
  }
  assert.throws(()=>remainingReplay([acknowledged,{...reconciled,command:{...reconciled.command,loanId:"other-loan"}}],before,identity),/chain/);
  assert.throws(()=>remainingReplay([reconciled,acknowledged],before,identity),/chain/);
});
