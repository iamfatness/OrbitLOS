export function checkpointCanonical(value:unknown,seen=new Set<object>()):string {
  if(value===null)return "null";
  if(typeof value==="string"||typeof value==="boolean")return JSON.stringify(value);
  if(typeof value==="number")return `number:${Object.is(value,-0)?"-0":String(value)}`;
  if(typeof value==="bigint")return `bigint:${value}`;
  if(value===undefined)return "undefined";
  if(typeof value!=="object" || seen.has(value))throw new Error("Unsupported checkpoint value. No checkpoint was saved.");
  seen.add(value);
  try {
    if(value instanceof ArrayBuffer)return `bytes:${Buffer.from(value).toString("hex")}`;
    if(ArrayBuffer.isView(value))return `${value.constructor.name}:${Buffer.from(value.buffer,value.byteOffset,value.byteLength).toString("hex")}`;
    if(value instanceof Date)return `date:${value.toISOString()}`;
    if(Array.isArray(value))return `[${value.map(item=>checkpointCanonical(item,seen)).join(",")}]`;
    if(value instanceof Map)return `map:[${[...value].map(([key,item])=>`[${checkpointCanonical(key,seen)},${checkpointCanonical(item,seen)}]`).join(",")}]`;
    if(value instanceof Set)return `set:[${[...value].map(item=>checkpointCanonical(item,seen)).join(",")}]`;
    if(Object.getPrototypeOf(value)!==Object.prototype && Object.getPrototypeOf(value)!==null)throw new Error("Unsupported checkpoint value. No checkpoint was saved.");
    return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${checkpointCanonical((value as Record<string,unknown>)[key],seen)}`).join(",")}}`;
  }finally{seen.delete(value);}
}
