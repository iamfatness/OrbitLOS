import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
registerHooks({resolve(specifier,context,next){try{return next(specifier,context);}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND'||!specifier.startsWith('./'))throw error;return next(`${specifier}.ts`,context);}}});
const {initializeStore}=await import('../src/lib/store.ts');
const {partnerAccessWork,sandboxEventAuthority,serveSandboxEvents}=await import('../src/lib/partner-access.ts');
const {loadExplorationExamples}=await import('../src/lib/pilot-exploration.ts');
const {readOfficerQueue,readWorkspaceCalendar}=await import('../src/lib/officer-queue.ts');
const {readLeadInbox}=await import('../src/lib/lead-inbox-query.ts');
const {readConversations}=await import('../src/lib/conversations.ts');
const {readProcessorQueue}=await import('../src/lib/processor-queue.ts');
const {brokerageFinanceWork}=await import('../src/lib/brokerage-finance.ts');
const {loadPilotScenario,readPilotSupportRequests,savePilotFeedback,triagePilotFeedback}=await import('../src/lib/pilot.ts');
const {loanReviewWork}=await import('../src/lib/loan-reviews.ts');
const {readDraftQueue}=await import('../src/lib/communication-draft-query.ts');
const {officerDashboardWork}=await import('../src/lib/officer-dashboard.ts');
const {initializeBrokerages,activeBrokerages,activateBrokerages,brokerageMembers}=await import('../src/lib/brokerages.ts');
const {scenarioPlanSchema,compareLoanScenarios}=await import('../src/lib/loan-scenario-model.ts');
function fixture(t){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
 const db={exec:s=>sqlite.exec(s),prepare:s=>sqlite.prepare(s),transaction:fn=>{sqlite.exec('BEGIN');try{const result=fn();sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 initializeStore(db,false);
 const brokerage={id:crypto.randomUUID(),name:'Fictional Exploration',role:'Admin',pilot:true,financeAccess:true};
 const admin={email:'owner@example.test',name:'Owner',brokerage};
 const officer={email:'officer@example.test',name:'Alex Morgan',brokerage:{...brokerage,role:'LO'}};
 const processor={email:'processor@example.test',name:'Jamie Chen',brokerage:{...brokerage,role:'Processor'}};
 const members=[admin,officer,processor].map(m=>({email:m.email,name:m.name,role:m.brokerage.role,status:'Active'}));
 const input={type:'loadPilotExploration',officerEmail:officer.email,processorEmail:processor.email};
 const seed=(at='2026-11-09T15:00:00.000Z',actor=admin,roster=members)=>loadExplorationExamples(db,actor,input,roster,new Date(at));
 return {db,admin,officer,processor,members,input,seed};
}
test('exploration examples populate real role-scoped pages and preserve presenter data',t=>{
 const {db,admin,officer,processor,members,seed}=fixture(t);const now=new Date('2026-11-09T15:00:00.000Z');
 loadPilotScenario(db,admin,{type:'loadPilotScenario',id:crypto.randomUUID(),previousId:null,officerEmail:officer.email,presenter:true},officer,now);
 const scenario=db.prepare('SELECT * FROM pilot_scenario').get();
 assert.ok(seed().message);
 assert.deepEqual(db.prepare('SELECT * FROM pilot_scenario').get(),scenario);
 const today=readOfficerQueue(db,{horizon:1},officer,officer.brokerage.id,now);assert.ok(today.items.length>=5);assert.ok(today.replies.items.length);
 const calendar=readWorkspaceCalendar(db,{week:'2026-11-09',scope:'Mine',group:'Appointments'},officer,officer.brokerage.id,now);assert.equal(calendar.items.length,5);
 const leads=readLeadInbox(db,{type:'list',view:'Mine'},officer,now);assert.ok(leads.leads.length>=4);
 const shared=readLeadInbox(db,{type:'list',view:'Unassigned'},admin,now);assert.equal(shared.leads.length,2);
 const conversations=readConversations(db,{type:'list',filter:'Active',mine:true},officer,officer.brokerage.id,now);assert.equal(conversations.rows.length,3);
 const processing=readProcessorQueue(db,{readyOnly:false},processor,processor.brokerage.id,now);assert.equal(processing.files.length,3);
 const drafts=readDraftQueue(db,{view:'Ready to copy'},officer);assert.ok(drafts.rows.length>=12);
 const reviews=loanReviewWork(db,{type:'queue',view:'Assigned to me',filter:'Open'},officer,officer.brokerage.id,members,now);assert.equal(reviews.reviews.length,1);
 const notices=loanReviewWork(db,{type:'inbox',unread:true},officer,officer.brokerage.id,members,now);assert.ok(notices.notices.length);
 assert.ok(officerDashboardWork(db,{type:'opportunities'},officer,officer.brokerage.id,now).items.length);
 assert.ok(officerDashboardWork(db,{type:'stalledLoans'},officer,officer.brokerage.id,now).items.length);
 const refinance=db.prepare("SELECT app.draft FROM applications app JOIN loans loan ON loan.id=app.loanId WHERE loan.purpose='Refinance'").get();
 assert.equal(JSON.parse(refinance.draft).purpose,'Refinance');
 const finance=brokerageFinanceWork(db,{type:'list',from:'2026-11-01',through:'2026-11-30',view:'Funded',owner:''},admin,admin.brokerage.id,now);assert.equal(finance.totals.expectedCents,1440000);
 const stranger={...officer,email:'other@example.test'};assert.equal(readOfficerQueue(db,{horizon:1},stranger,stranger.brokerage.id,now).items.length,0);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('the shared demo supports examples while a one-person workspace never fabricates a reviewer',t=>{
 const {db,admin}=fixture(t);
 const actor={...admin,brokerage:{...admin.brokerage,id:'orbit-demo',pilot:false}};
 const member={email:actor.email,name:actor.name,role:'Admin',status:'Active'};
 assert.ok(loadExplorationExamples(db,actor,{type:'loadPilotExploration',officerEmail:actor.email},[member]).message);
 assert.equal(db.prepare('SELECT count(*) AS n FROM loan_reviews').get().n,0);
 assert.equal(db.prepare('SELECT count(*) AS n FROM loans WHERE officerEmail=?').get(actor.email).n,8);
});

test('different officers can load their own examples in the same workspace',t=>{
 const {db,admin,officer,processor,members,seed}=fixture(t);
 assert.ok(seed().message);
 assert.ok(loadExplorationExamples(db,admin,{type:'loadPilotExploration',officerEmail:admin.email,processorEmail:processor.email},members).message);
 for (const email of [admin.email,officer.email]) assert.equal(db.prepare('SELECT count(*) AS n FROM loans WHERE officerEmail=?').get(email).n,8);
});
test('repeat loading refreshes dates without duplicating, reopening, or overwriting edited examples',t=>{
 const {db,seed}=fixture(t);assert.ok(seed().message);
 const tasks=db.prepare('SELECT * FROM tasks ORDER BY id').all();const appointments=db.prepare('SELECT * FROM loan_appointments ORDER BY id').all();
 db.prepare('UPDATE tasks SET completedAt=? WHERE id=?').run('2026-11-09T16:00:00.000Z',tasks[0].id);
 db.prepare('UPDATE loan_appointments SET startsAt=? WHERE id=?').run('2027-02-01T15:00:00.000Z',appointments[0].id);
 assert.ok(seed('2026-12-01T15:00:00.000Z').message);
 assert.equal(db.prepare('SELECT count(*) AS n FROM loans').get().n,8);
 assert.equal(db.prepare('SELECT count(*) AS n FROM referral_leads').get().n,6);
 assert.equal(db.prepare('SELECT dueAt FROM tasks WHERE id=?').get(tasks[0].id).dueAt,tasks[0].dueAt);
 assert.equal(db.prepare('SELECT startsAt FROM loan_appointments WHERE id=?').get(appointments[0].id).startsAt,'2027-02-01T15:00:00.000Z');
 assert.notEqual(db.prepare('SELECT startsAt FROM loan_appointments WHERE id=?').get(appointments[1].id).startsAt,appointments[1].startsAt);
 assert.ok(seed('2026-12-01T15:00:00.000Z').message);
 assert.equal(db.prepare('SELECT count(*) AS n FROM loan_appointments').get().n,6);
});
test('exploration setup rejects non-pilot, restricted and revoked staff',t=>{
 const {db,admin,officer,members,seed}=fixture(t);
 assert.ok(seed(undefined,officer).error);
 assert.ok(seed(undefined,{...admin,brokerage:{...admin.brokerage,pilot:false}}).error);
 assert.ok(seed(undefined,admin,members.map(m=>m.email===officer.email?{...m,status:'Revoked'}:m)).error);
 assert.equal(db.prepare('SELECT count(*) AS n FROM loans').get().n,0);
});

test('invited evaluators receive complete personal data without activating access, then see reviews after normal sign-in',t=>{
 const {db,admin,processor,input,members}=fixture(t);
 initializeBrokerages(db);
 db.prepare('INSERT INTO brokerages (id,name,pilot) VALUES (?,?,1)').run(admin.brokerage.id,'Evaluator demo');
 for(const member of members) db.prepare('INSERT INTO brokerage_members (brokerageId,email,name,role,status,accessRevision) VALUES (?,?,?,?,?,4)')
  .run(admin.brokerage.id,member.email,member.name,member.role,member.status);
 const emails=['first@example.test','second@example.test'];
 for(const email of emails) db.prepare("INSERT INTO brokerage_members (brokerageId,email,name,role,status,accessRevision) VALUES (?,?,?,'Admin','Invited',7)")
  .run(admin.brokerage.id,email,email);
 const now=new Date('2026-11-09T15:00:00.000Z');
 for(const email of emails){
  const request={...input,officerEmail:email};
  assert.ok(loadExplorationExamples(db,admin,request,brokerageMembers(db,admin.brokerage.id,[]),now).message);
  assert.deepEqual(activeBrokerages(db,email,[]),[]);
  assert.deepEqual({...db.prepare('SELECT status,accessRevision FROM brokerage_members WHERE email=?').get(email)},{status:'Invited',accessRevision:7});
  assert.equal(db.prepare('SELECT count(*) AS n FROM loans WHERE officerEmail=?').get(email).n,8);
  const row=db.prepare('SELECT plan FROM loan_scenario_plans s JOIN loans l ON l.id=s.loanId WHERE l.officerEmail=?').get(email);
  const plan=scenarioPlanSchema.parse(JSON.parse(row.plan));
  assert.equal(plan.options.length,3);assert.equal(plan.holdingMonths,60);
  assert.equal(plan.recommendedId,plan.options[1].id);
  assert.equal(compareLoanScenarios(plan).every(option=>option.withinBudget),true);
  const brokerage=activateBrokerages(db,{email,name:'Evaluator'},[])[0];
  assert.equal(brokerage.accessRevision,8);
  const viewer={email,name:'Evaluator',brokerage};
  const roster=brokerageMembers(db,brokerage.id,[]);
  assert.ok(readOfficerQueue(db,{horizon:1},viewer,brokerage.id,now).items.length>=5);
  assert.equal(readWorkspaceCalendar(db,{week:'2026-11-09',scope:'Mine',group:'Appointments'},viewer,brokerage.id,now).items.length,5);
  assert.ok(readLeadInbox(db,{type:'list',view:'Mine'},viewer,now).leads.length>=4);
  assert.equal(loanReviewWork(db,{type:'queue',view:'Assigned to me',filter:'Open'},viewer,brokerage.id,roster,now).reviews.length,1);
  assert.ok(loanReviewWork(db,{type:'inbox',unread:true},viewer,brokerage.id,roster,now).notices.length);
  assert.ok(loadExplorationExamples(db,admin,request,roster,now).message);
  assert.equal(db.prepare('SELECT count(*) AS n FROM loans WHERE officerEmail=?').get(email).n,8);
 }
 assert.equal(db.prepare('SELECT count(*) AS n FROM loan_scenario_plans').get().n,2);
 assert.ok(loadExplorationExamples(db,admin,{...input,officerEmail:'unknown@example.test'},brokerageMembers(db,admin.brokerage.id,[]),now).error);
 assert.ok(loadExplorationExamples(db,admin,{...input,officerEmail:processor.email},brokerageMembers(db,admin.brokerage.id,[]),now).error);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});


test('pilot support preserves existing feedback, pages consistently and protects private triage', t => {
 const {db,admin,officer,processor,members}=fixture(t);
 const id=crypto.randomUUID(), legacy=crypto.randomUUID();
 const read=(staff,query={},roster=members)=>readPilotSupportRequests(db,staff,{type:'readPilotSupportRequests',...query},roster);
 db.prepare('INSERT INTO pilot_feedback(id,author,step,message,createdAt) VALUES (?,?,?,?,?)')
   .run(legacy,processor.email,'Pricing','Legacy fictional report','2026-10-01T12:00:00.000Z');
 const input={type:'pilotFeedback',id,step:'Documents',message:'Fictional review issue'};
 assert.ok(savePilotFeedback(db,officer,input,admin.email).message);
 assert.ok(savePilotFeedback(db,officer,input,processor.email).message);
 assert.ok(savePilotFeedback(db,processor,input,admin.email).error);
 assert.equal(read(officer,{id}).items[0].ownerName,admin.name);
 assert.equal(read(processor,{id}).items.length,0);
 assert.equal(read(processor,{id:legacy}).items[0].updatedAt,'2026-10-01T12:00:00.000Z');
 assert.equal(read(processor,{id:legacy}).items[0].requesterUpdate,'');
 assert.equal(read(admin,{id},members.filter(member=>member.email!==admin.email)).items[0].needsOwner,true);

 const update={type:'triagePilotFeedback',id,revision:0,owner:admin.email,status:'Ready to retest',priority:'High',
   requesterUpdate:'Try the sample document again.',retest:'Private test notes'};
 assert.ok(triagePilotFeedback(db,officer,update).error);
 assert.ok(triagePilotFeedback(db,admin,{...update,status:'Closed',retest:''}).error);
 assert.ok(triagePilotFeedback(db,admin,update).message);
 assert.ok(triagePilotFeedback(db,admin,update).message);
 assert.match(triagePilotFeedback(db,admin,{...update,status:'Open'}).error,/changed/);
 const saved=read(admin,{id}).items[0];
 assert.equal(saved.triage.revision,1);
 assert.equal(saved.triage.retest,update.retest);
 assert.equal(read(officer,{id}).items[0].requesterUpdate,update.requesterUpdate);
 assert.equal('triage' in read(officer,{id}).items[0],false);
 assert.equal(read(admin,{status:'Ready to retest'}).items[0].id,id);
 assert.ok(read(admin,{id,status:'Open'}).error);
 assert.ok(read({...admin,brokerage:{...admin.brokerage,pilot:false}}).error);

 for(let index=0;index<21;index++){
   db.prepare('INSERT INTO pilot_feedback(id,author,step,message,createdAt) VALUES (?,?,?,?,?)')
     .run(crypto.randomUUID(),officer.email,'Pricing','Paged fictional report','2026-10-05T12:00:00.000Z');
 }
 const first=read(officer);
 assert.equal(first.items.length,20);
 assert.ok(first.next);
 const last=read(officer,{after:first.next});
 assert.equal(last.items.length,2);
 assert.equal(last.next,null);
 assert.equal(new Set([...first.items,...last.items].map(item=>item.id)).size,22);
});


test('sandbox grant expiration and approver revision invalidate a previously allowed check', t => {
 const {db,admin}=fixture(t);
 admin.brokerage.accessRevision=2;
 const roster=[{email:admin.email,name:admin.name,role:'Admin',status:'Active',accessRevision:2}];
 const at='2026-11-10T10:00:00.000Z';
 const expiresAt='2026-11-11T10:00:00.000Z';
 const id=crypto.randomUUID();
 const approved=partnerAccessWork(db,admin,{type:'approve',id,name:'Fictional partner',scopes:['loans.read'],expiresAt},roster,at);
 assert.equal(approved.grant.state,'Active');
 const check={type:'check',id,clientId:approved.grant.clientId,scope:'loans.read',operationId:crypto.randomUUID()};
 const allowed=partnerAccessWork(db,admin,check,roster,at);
 assert.equal(allowed.check.decision,'Allowed');
 assert.equal(allowed.sample.loanId,'sample-loan-01');
 assert.match(partnerAccessWork(db,admin,check,roster,expiresAt).error,/decision changed/);
 const expired=partnerAccessWork(db,admin,{...check,operationId:crypto.randomUUID()},roster,expiresAt);
 assert.equal(expired.check.decision,'Expired');
 assert.equal(expired.sample,undefined);
 const current=[{...roster[0],accessRevision:3}];
 assert.match(partnerAccessWork(db,admin,check,current,at).error,/Refresh/);
 admin.brokerage.accessRevision=3;
 const changed=partnerAccessWork(db,admin,{...check,operationId:crypto.randomUUID()},current,at);
 assert.equal(changed.check.decision,'Approval changed');
 assert.equal(changed.sample,undefined);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('sandbox credential reads enforce exact expiry and invalidate credentials after maintenance', t => {
 const {db,admin,members}=fixture(t);
 admin.brokerage.accessRevision=0;
 const roster=members.map(member=>({...member,accessRevision:0}));
 const at='2026-11-09T15:00:00.000Z', expiresAt='2026-11-10T15:00:00.000Z', id=crypto.randomUUID();
 const grant=partnerAccessWork(db,admin,{type:'approve',id,name:'Fictional feed',scopes:['events.read'],expiresAt},roster,at);
 assert.equal(grant.kind,'grant');
 const issue=partnerAccessWork(db,admin,{type:'issueEventCredential',id,previous:null,operationId:crypto.randomUUID()},roster,at,0);
 assert.equal(issue.kind,'eventCredential');
 const secret=issue.bearer.split('.').at(-1);
 const input={grantId:id,secretHash:createHash('sha256').update(secret).digest('hex')};
 const authority=sandboxEventAuthority(db,input);
 const reviewed={approval:authority.approval,credentialId:authority.credential.id,accessCurrent:true,maintenanceRevision:0};
 assert.equal(serveSandboxEvents(db,input,'?limit=1',reviewed,at).status,200);
 assert.equal(serveSandboxEvents(db,input,'?limit=1',{...reviewed,maintenanceRevision:2},at).status,403);
 assert.equal(serveSandboxEvents(db,input,'?limit=1',reviewed,expiresAt).status,403);
 assert.deepEqual(partnerAccessWork(db,admin,{type:'detail',id},roster,expiresAt).eventReceipts.map(receipt=>receipt.decision),
  ['Expired','Workspace revision changed','Allowed']);
 assert.equal(db.prepare('SELECT secretHash FROM partner_event_credentials').get().secretHash,input.secretHash);
});
