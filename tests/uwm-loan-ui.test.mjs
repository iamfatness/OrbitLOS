import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
registerHooks({resolve(specifier,context,next){try{return next(specifier,context);}catch(error){if(error.code!=="ERR_MODULE_NOT_FOUND"||!specifier.startsWith("./"))throw error;return next(`${specifier}.ts`,context);}}});
const {uwmRateBody,uwmRateFields}=await import("../src/lib/uwm-loan-ui.ts");
const common={loanShield:"No",titleSelection:"Traditional Lender's Policy",commitmentPeriodDays:"30",waiveUnderwritingFee:"false",waiveOption:"No Waiver"};
const lock={productId:"362",calculationTypeId:"1",targetRate:"6.125",targetPrice:"0",targetCash:"0",commitmentPeriod:"30",compensationType:"1",waiveUWFeeIndicator:"false",escrowWaiver:"false",waiveEscrowOption:"1",flexTerm:"30",tracTypeId:"0",loanShieldTypeId:"0",loppBasisPoints:"0",cypBasisPoints:"0",buydownTypeId:"None",firstTimeHomebuyerId:"1",freeLockExtensionDays:"0"};
test("empty fields cannot silently become zero or false financial terms",()=>{
 assert.throws(()=>uwmRateBody("lock",{}),/product number/);
 assert.throws(()=>uwmRateBody("lock",{...lock,targetRate:""}),/target rate/);
 assert.throws(()=>uwmRateBody("lock",{...lock,waiveUWFeeIndicator:""}),/underwriting/);
 assert.throws(()=>uwmRateBody("lock",{...lock,cypBasisPoints:"41"}),/CYP|cyp/);
});
test("rate forms map explicit choices to UWM types and preserve decimal rates",()=>{
 const body=uwmRateBody("lock",lock);assert.equal(body.productId,362);assert.equal(body.targetRate,6.125);assert.equal(body.waiveUWFeeIndicator,false);assert.equal(body.firstTimeHomebuyerId,"1");assert.equal("paPlusTypeId" in body,false);
 assert.throws(()=>uwmRateBody("extend-lock",lock),/quick lock/);
 assert.equal(uwmRateBody("extend-lock",{...lock,isQuickLock:"false"}).isQuickLock,false);
 assert.equal(uwmRateBody("relock",{...lock,isQuickLock:"true"}).isQuickLock,true);
 assert.deepEqual(uwmRateBody("cancel-lock",{productId:"362"}),{});
});
test("search and float use distinct contracts and require an explicit product and rate",()=>{
 assert.equal(uwmRateBody("products",{...common,excludeInvalidProducts:"true"}).excludeInvalidProducts,true);
 const body=uwmRateBody("float",{...common,productId:"362",interestRate:"6.125",actualTerm:"360",isUWMAppraisalDirectSelected:"false"});
 assert.equal(body.buydownAlias,"None");assert.equal(body.actualTerm,360);assert.equal(body.interestRate,6.125);assert.equal("excludeInvalidProducts" in body,false);
 assert.throws(()=>uwmRateBody("float",{...common,productId:"362",interestRate:"6.1234",actualTerm:"360",isUWMAppraisalDirectSelected:"false"}),/rate/);
 for(const action of ["products","float","lock","relock","extend-lock"]){const fields=uwmRateFields(action);assert.equal(new Set(fields.map(f=>f.name)).size,fields.length);}
});
