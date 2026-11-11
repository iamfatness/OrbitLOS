import { maintenanceMessage } from "./workspace-maintenance-model";

// Tracks whole RPC promises, including provider work and alarms. Closing the
// gate refuses new RPCs while already-started work is allowed to finish.
export class WorkspaceMaintenanceGate {
  active=0;
  closed=true;
  revision=-1;
  apply(revision: number, closed: boolean) {
    if(revision<this.revision)return;
    this.revision=revision;this.closed=closed;
  }
  run<T>(work:()=>T):T {
    if(this.closed)throw new Error(maintenanceMessage);
    this.active++;
    let settled=false;
    const finish=()=>{if(!settled){settled=true;this.active--;}};
    try {
      const result=work();
      if(result instanceof Promise)return result.finally(finish) as T;
      finish();return result;
    } catch(error){finish();throw error;}
  }
}
// Default coverage includes future public RPCs. Only the narrowly scoped
// maintenance control methods are exempt; directory objects have no gate.
export function guardWorkspaceMethods<T extends object>(prototype:T,gate:(instance:T)=>WorkspaceMaintenanceGate|null,exempt:ReadonlySet<string>) {
  for(const name of Object.getOwnPropertyNames(prototype)) {
    const descriptor=Object.getOwnPropertyDescriptor(prototype,name);
    if(name==="constructor" || exempt.has(name) || typeof descriptor?.value!=="function")continue;
    const method=descriptor.value as (...args:unknown[])=>unknown;
    function invoke(instance:T,args:unknown[]) {
      const fence=gate(instance);
      return fence ? fence.run(()=>Reflect.apply(method,instance,args)) : Reflect.apply(method,instance,args);
    }
    // Preserve async rejection semantics for RPC bridges as well as callers.
    const wrapped=method.constructor.name === "AsyncFunction" ? async function(this:T,...args:unknown[]) {return invoke(this,args);} :
      function(this:T,...args:unknown[]) {return invoke(this,args);};
    Object.defineProperty(prototype,name,{...descriptor,value:wrapped});
  }
}
