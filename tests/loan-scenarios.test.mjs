import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
registerHooks({resolve(specifier,context,next){try{return next(specifier,context);}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND'||!specifier.startsWith('./'))throw error;return next(`${specifier}.ts`,context);}}});
const {initializeStore,insertContact,insertLoan}=await import('../src/lib/store.ts');
const {loanScenarioWork}=await import('../src/lib/loan-scenarios.ts');
const {blankScenarioOption,sampleScenarioPlan,scenarioPlanSchema,scenarioSchedule,compareLoanScenarios}=await import('../src/lib/loan-scenario-model.ts');
const {compareQuoteCosts}=await import('../src/lib/quote-cost-comparison.ts');
const {sustainedCostBreakEven}=await import('../src/lib/loan-amortization.ts');

test('fixed-rate amortization rounds cents, handles zero rates and pays off at term',()=>{
 const option={...blankScenarioOption(30_000_000),rate:6,years:30};
 const schedule=scenarioSchedule(option);
 assert.equal(schedule.payment,179865);
 assert.equal(schedule.rows[1].interest,150000);
 assert.equal(schedule.rows[1].balance,29970135);
 assert.equal(schedule.rows.at(-1).balance,0);
 const zero=scenarioSchedule({...option,loanAmount:12_000_000,rate:0,years:10});
 assert.equal(zero.payment,100000);assert.equal(zero.rows[12].balance,10800000);assert.equal(zero.rows.at(-1).interest,0);
 assert.ok(Number.isFinite(scenarioSchedule({...option,rate:0.000001}).payment));
});

test('comparison separates equity, closing cash, monthly expenses, and borrowing cost',()=>{
 const plan=sampleScenarioPlan(30_000_000,'Purchase');
 Object.assign(plan,{propertyValue:40_000_000,deposit:1_000_000,sellerCredit:100000,holdingMonths:12,monthlyBudget:100000,cashBudget:100});
 plan.options=[{...plan.options[0],rate:0,years:10,pointsPercent:1,fees:200000,lenderCredit:50000,prepaids:100000,escrow:150000,monthlyTaxes:10000,monthlyInsurance:5000,monthlyHoa:2000,monthlyMi:3000,miMonths:6}];
 assert.ok(scenarioPlanSchema.safeParse(plan).success);
 const [result]=compareLoanScenarios(plan);
 assert.equal(result.principalAndInterest,250000);assert.equal(result.monthly,270000);
 assert.equal(result.points,300000);assert.equal(result.closingCosts,600000);assert.equal(result.cashToClose,9600000);
 assert.equal(result.mortgageInsurance,18000);assert.equal(result.borrowingCost,468000);
 assert.equal(result.principalPaid,3000000);assert.equal(result.balance,27000000);assert.equal(result.withinBudget,false);
 const [refi]=compareLoanScenarios({...plan,purpose:'Refinance',deposit:0,sellerCredit:0,payoffs:28_000_000});
 assert.equal(refi.cashToClose,-1300000);
});

test('cost break-even uses interest and fees rather than treating principal as a cost',()=>{
 const plan=sampleScenarioPlan(30_000_000,'Purchase');
 const rows=compareLoanScenarios(plan);assert.ok(rows[1].breakEvenMonths>1);assert.ok(rows[1].breakEvenMonths<60);
 const schedules=plan.options.map(scenarioSchedule),month=rows[1].breakEvenMonths;
 assert.ok(schedules[1].rows[month-1].cost>schedules[0].rows[month-1].cost);
 assert.ok(schedules[1].rows[month].cost<=schedules[0].rows[month].cost);
 const unequal={...plan,options:[plan.options[0],{...plan.options[1],loanAmount:29_000_000}]};
 assert.equal(compareLoanScenarios(unequal)[1].breakEvenMonths,null);
 const late=compareLoanScenarios({...plan,holdingMonths:480});assert.equal(late[0].balance,0);
});

function savedQuote({rate=0,years=10,loanAmount=120000,points=0,lenderCredit=0}={}){
 const {payment}=scenarioSchedule({...blankScenarioOption(loanAmount*100),rate,years});
 return {product:`Sample ${years}-year fixed`,rate,years,loanAmount,principalAndInterest:payment/100,purpose:'Purchase',
  estimate:{points,lenderCredit,inputs:{purchasePrice:15_000_000,payoffs:null,deposit:150000,sellerCredits:100000,otherCredits:50000,
   fees:{origination:85000,appraisal:60000,creditReport:0,settlement:80000,government:25000,other:0,prepaid:100000,escrow:150000}}}};
}

test('saved quote costs distinguish five-year interest, principal and qualifying upfront charges',()=>{
 const primary=savedQuote({lenderCredit:50000}), alternative=savedQuote({points:100000});
 const [base, next]=compareQuoteCosts({primary,alternatives:[alternative]});
 assert.equal(base.cost,200000);
 assert.equal(base.interest,0);
 assert.equal(base.principalPaid,6_000_000);
 assert.equal(base.borrowingCost,200000);
 assert.equal(next.borrowingCost,350000);
 assert.equal(next.breakEven,'No sustained break-even');
 assert.equal(compareQuoteCosts({primary,alternatives:[primary]})[1].breakEven,'Same upfront cost');
 const short=savedQuote({years:4});
 assert.equal(compareQuoteCosts({primary:short,alternatives:[]})[0].principalPaid,12_000_000);
});

test('saved quote break-even works in either direction and requires a sustained crossover',()=>{
 const primary=savedQuote({rate:6}), points=savedQuote({rate:5.75,points:100000});
 const [, lowerRate]=compareQuoteCosts({primary,alternatives:[points]});
 assert.match(lowerRate.breakEven,/^This offer breaks even in month \d+/);
 assert.equal(compareQuoteCosts({primary:points,alternatives:[primary]})[1].breakEven,
  lowerRate.breakEven.replace('This offer','Selected offer'));
 const rows=(costs)=>costs.map(cost=>({cost}));
 assert.equal(sustainedCostBreakEven(rows([10,11,15,17]),rows([0,12,14,19])),3);
 assert.equal(sustainedCostBreakEven(rows([10,11,15,17]),rows([0,12,14])),null);
});

test('saved quote costs keep unknown inputs explicit and only compare equivalent loan bases',()=>{
 const primary=savedQuote(), incomplete=structuredClone(primary);
 incomplete.estimate.inputs.fees.creditReport=null;
 const [,missing,noWorksheet,unsupported]=compareQuoteCosts({primary,alternatives:[incomplete,{...primary,estimate:null},
  {...primary,product:'Sample ARM'}]});
 assert.equal(missing.borrowingCost,undefined);
 assert.equal(missing.principalPaid,6_000_000);
 assert.equal(noWorksheet.reason,'Fee worksheet pending.');
 assert.equal(unsupported.interest,undefined);
 assert.equal(compareQuoteCosts({primary,alternatives:[{...primary,principalAndInterest:1001}]})[1].interest,undefined);
 assert.equal(compareQuoteCosts({primary,alternatives:[savedQuote({lenderCredit:300000})]})[1].borrowingCost,undefined);
 assert.equal(compareQuoteCosts({primary,alternatives:[savedQuote({loanAmount:119999})]})[1].breakEven,'Different loan amounts');
 const otherPurchase=structuredClone(primary);
 otherPurchase.estimate.inputs.purchasePrice+=100;
 assert.equal(compareQuoteCosts({primary,alternatives:[otherPurchase]})[1].breakEven,'Different purchase prices');
 const refinance=structuredClone(primary);
 refinance.purpose='Refinance'; refinance.estimate.inputs.purchasePrice=null; refinance.estimate.inputs.payoffs=11_000_000;
 const otherPayoff=structuredClone(refinance);otherPayoff.estimate.inputs.payoffs+=100;
 assert.equal(compareQuoteCosts({primary:refinance,alternatives:[otherPayoff]})[1].breakEven,'Different refinance payoffs');
});

test('scenario validation rejects impossible credits, incomplete recommendations and duplicate options',()=>{
 const plan=sampleScenarioPlan(30_000_000,'Purchase');
 assert.equal(scenarioPlanSchema.safeParse({...plan,recommendedId:plan.options[0].id}).success,false);
 assert.equal(scenarioPlanSchema.safeParse({...plan,options:[plan.options[0],plan.options[0]]}).success,false);
 assert.equal(scenarioPlanSchema.safeParse({...plan,propertyValue:1}).success,false);
 assert.equal(scenarioPlanSchema.safeParse({...plan,sellerCredit:100_000_000}).success,false);
 assert.equal(scenarioPlanSchema.safeParse({...plan,options:[{...plan.options[0],rate:Infinity}]}).success,false);
 assert.equal(scenarioPlanSchema.safeParse({...plan,options:[{...plan.options[0],monthlyMi:100,miMonths:0}]}).success,false);
});

function fixture(t){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
 const db={exec:s=>sqlite.exec(s),prepare:s=>sqlite.prepare(s),transaction:fn=>{sqlite.exec('BEGIN');try{const v=fn();sqlite.exec('COMMIT');return v;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 initializeStore(db,false);
 const brokerage={id:crypto.randomUUID(),name:'Scenario fixture',role:'LO',pilot:true};
 const staff={email:'owner@example.test',name:'Owner',brokerage};
 const loanId=crypto.randomUUID(),contactId=crypto.randomUUID();
 insertContact(db,{id:contactId,name:'Fictional Borrower',email:'borrower@example.test',phone:'248-555-0140',role:'Borrower'});
 insertLoan(db,{id:loanId,contactId,partnerId:null,officer:staff.name,officerEmail:staff.email,address:'Example Lane',amount:300000,purpose:'Purchase',stage:'Lead',createdAt:new Date().toISOString(),stageSince:new Date().toISOString(),leadSource:'Website quote request'});
 const plan=sampleScenarioPlan(30_000_000,'Purchase');
 const input={type:'save',loanId,revision:0,applicationRevision:null,plan};
 const run=(data=input,actor=staff,id=brokerage.id)=>loanScenarioWork(db,data,actor,id);
 return {db,staff,loanId,plan,input,run};
}

test('plans persist with permissions, optimistic concurrency, and no changes to the loan',t=>{
 const {db,staff,loanId,plan,input,run}=fixture(t);
 const before=db.prepare('SELECT * FROM loans WHERE id=?').get(loanId);
 assert.equal(run({type:'read',loanId}).record,null);
 const saved=run();assert.equal(saved.record.revision,1);
 assert.deepEqual(run({type:'read',loanId}).record.plan,plan);
 assert.ok(run().error);
 assert.ok(run({type:'read',loanId},{...staff,email:'stranger@example.test'}).error);
 assert.ok(run({type:'read',loanId},staff,'another-workspace').error);
 const processor={...staff,email:'processor@example.test',brokerage:{...staff.brokerage,role:'Processor'}};
 db.prepare("INSERT INTO loan_processing (loanId,processorEmail,processorName,status,note,updatedAt,revision) VALUES (?,?,?,'In processing','',?,1)").run(loanId,processor.email,'Processor',new Date().toISOString());
 assert.equal(run({type:'read',loanId},processor).canEdit,false);
 assert.ok(run({...input,revision:1},processor).error);
 assert.deepEqual(db.prepare('SELECT * FROM loans WHERE id=?').get(loanId),before);
 assert.equal(db.prepare('SELECT count(*) AS n FROM workspace_access_history').get().n,1);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('a changed application blocks saving assumptions from an old revision',t=>{
 const {db,loanId,input,run}=fixture(t);
 run();
 db.prepare("INSERT INTO applications (loanId,token,expiresAt,draft,step,revision,updatedAt) VALUES (?,?,'2027-01-01','{}',0,2,'2026-11-09')").run(loanId,crypto.randomUUID());
 assert.ok(run({...input,revision:1}).error);
 assert.equal(run({...input,revision:1,applicationRevision:2}).record.applicationRevision,2);
});
