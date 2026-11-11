import { SaxesParser } from "saxes";
const mismo = "http://www.mismo.org/residential/2009/schemas";
const loanPath = ["MESSAGE","DEAL_SETS","DEAL_SET","DEALS","DEAL","LOANS","LOAN"];
const identifierPath = [...loanPath,"LOAN_IDENTIFIERS","LOAN_IDENTIFIER"];
// Phil Abraham's 2026-11-11 ULAD example identifies the lender number by this
// exact namespace/path and sibling type. Never use AgencyCase, UniversalLoan,
// arbitrary local-name matches, a filename, or an embedded XML string.
export function uwmUladLoanNumber(xml:string):string|null {
  if(new TextEncoder().encode(xml).length>1024*1024 || /<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error("Invalid XML export");
  const parser=new SaxesParser({xmlns:true,position:false});
  const stack:{local:string;uri:string}[]=[];
  let loans=0,nodes=0,version=true,record:{values:string[];types:string[];invalid:boolean}|null=null;
  let leaf:{kind:"values"|"types";value:string;depth:number}|null=null;
  const identifiers:string[]=[];
  const matches=(path:string[])=>stack.length===path.length && stack.every((tag,index)=>tag.uri===mismo && tag.local===path[index]);
  parser.on("error",()=>{throw new Error("Invalid XML export");});
  parser.on("doctype",()=>{throw new Error("Invalid XML export");});
  parser.on("opentag",tag=>{
    stack.push({local:tag.local,uri:tag.uri});
    if(++nodes>50000 || stack.length>128)throw new Error("XML export is too complex");
    if(stack.length===1){const model=tag.attributes.MISMOReferenceModelIdentifier?.value;version=!model || model.startsWith("3.4.");}
    if(matches(loanPath))loans++;
    if(matches(identifierPath))record={values:[],types:[],invalid:false};
    if(record && stack.length===identifierPath.length+1 && tag.uri===mismo && ["LoanIdentifier","LoanIdentifierType"].includes(tag.local))
      leaf={kind:tag.local==="LoanIdentifier"?"values":"types",value:"",depth:stack.length};
    else if(leaf && stack.length>leaf.depth)record!.invalid=true;
  });
  const text=(value:string)=>{if(leaf && stack.length===leaf.depth)leaf.value+=value;};
  parser.on("text",text);parser.on("cdata",text);
  parser.on("closetag",()=>{
    if(leaf && stack.length===leaf.depth){record![leaf.kind].push(leaf.value.trim());leaf=null;}
    if(matches(identifierPath) && record){
      if(record.types.includes("LenderLoan"))identifiers.push(!record.invalid && record.types.length===1 && record.values.length===1 ? record.values[0] : "");
      record=null;
    }
    stack.pop();
  });
  parser.write(xml).close();
  return version && loans===1 && identifiers.length===1 && /^\d{10}$/.test(identifiers[0]) ? identifiers[0] : null;
}
