import test from "node:test";
import assert from "node:assert/strict";
import {uwmUladLoanNumber} from "../src/lib/uwm-xml.ts";
const ns="http://www.mismo.org/residential/2009/schemas";
const id=(type,value)=>`<LOAN_IDENTIFIER><LoanIdentifier>${value}</LoanIdentifier><LoanIdentifierType>${type}</LoanIdentifierType></LOAN_IDENTIFIER>`;
const loan=(ids)=>`<LOAN><LOAN_IDENTIFIERS>${ids}</LOAN_IDENTIFIERS></LOAN>`;
const xml=(loans)=>`<MESSAGE xmlns="${ns}" MISMOReferenceModelIdentifier="3.4.032420160128"><DEAL_SETS><DEAL_SET><DEALS><DEAL><LOANS>${loans}</LOANS></DEAL></DEALS></DEAL_SET></DEAL_SETS></MESSAGE>`;
const example=()=>xml(loan(id("AgencyCase","1234567891")+id("LenderLoan","1234567890")+id("UniversalLoan","1234567892")));
test("ULAD selects the exact MISMO LenderLoan identifier, preserving prefix independence",()=>{
 assert.equal(uwmUladLoanNumber(example()),"1234567890");
 const prefixed=example().replace('xmlns=', 'xmlns:m=').replace(/<(\/?)([A-Z][A-Za-z_]*)/g,'<$1m:$2');
 assert.equal(uwmUladLoanNumber(prefixed),"1234567890");
 assert.equal(uwmUladLoanNumber(example().replace('1234567890','<![CDATA[1234567890]]>')),"1234567890");
});
test("import identifiers and ambiguous, unsupported or spoofed export identifiers never route",()=>{
 for(const value of [xml(loan(id("LenderLoan","25125"))),xml(loan(id("AgencyCase","1234567890"))),xml(loan(id("LenderLoan","1234567890")+id("LenderLoan","1234567890"))),xml(loan(id("LenderLoan","1234567890"))+loan('')),example().replace(ns,'urn:other'),example().replace('3.4.032420160128','3.5.1'),example().replace('<LoanIdentifierType>LenderLoan','<LoanIdentifierType xmlns="urn:other">LenderLoan'),example().replace('<LoanIdentifier>1234567890','<LoanIdentifier xmlns="urn:other">1234567890'),example().replace('1234567890','12345<Extra/>67890')])assert.equal(uwmUladLoanNumber(value),null);
 assert.equal(uwmUladLoanNumber('<ROOT><![CDATA['+example()+']]></ROOT>'),null);
});
test("malformed XML, declarations, unknown entities and excessive nesting fail before routing",()=>{
 for(const value of [example().slice(0,-10),'<MESSAGE><BAD></MESSAGE>','<!DOCTYPE MESSAGE SYSTEM "https://example.test/secret">'+example(),example().replace('1234567890','&unknown;'),'<A>'.repeat(129)+'</A>'.repeat(129),example()+'<OTHER/>'])assert.throws(()=>uwmUladLoanNumber(value),/XML export/);
});
