import type { Store } from "./store";
import type { WorkspaceStaff } from "./staff-store";
import { activeBrokerages } from "./brokerages";
import { demoBrokerageId } from "./brokerage-model";
import { maintenanceInput, type MaintenanceState, type MaintenanceView } from "./workspace-maintenance-model";

export function initializeMaintenance(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS brokerage_maintenance (
    brokerageId TEXT PRIMARY KEY REFERENCES brokerages(id), mode TEXT NOT NULL, revision INTEGER NOT NULL,
    reason TEXT NOT NULL, startedAt TEXT, startedBy TEXT, reviewedAt TEXT, reviewedBy TEXT, review TEXT NOT NULL, checks TEXT NOT NULL
  ); CREATE TABLE IF NOT EXISTS brokerage_maintenance_history (
    id TEXT PRIMARY KEY, brokerageId TEXT NOT NULL REFERENCES brokerages(id), action TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL, note TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS brokerage_maintenance_history_recent ON brokerage_maintenance_history(brokerageId,at DESC,id DESC);`);
}
export function maintenanceState(db: Store, id: string): MaintenanceState {
  const row = db.prepare("SELECT * FROM brokerage_maintenance WHERE brokerageId = ?").get(id);
  return row ? {mode:row.mode as MaintenanceState["mode"],revision:Number(row.revision),reason:String(row.reason),
    startedAt:row.startedAt as string|null,startedBy:row.startedBy as string|null,reviewedAt:row.reviewedAt as string|null,
    reviewedBy:row.reviewedBy as string|null,review:String(row.review),checks:JSON.parse(String(row.checks))} :
    {mode:"Open",revision:0,reason:"",startedAt:null,startedBy:null,reviewedAt:null,reviewedBy:null,review:"",checks:[false,false,false]};
}
export function maintenanceAdmin(db: Store, staff: WorkspaceStaff, emails: string[]) {
  const current=activeBrokerages(db,staff.email,emails).find(row=>row.id===staff.brokerage.id);
  return !!current && current.id!==demoBrokerageId && current.pilot===true && current.role==="Admin" &&
    staff.brokerage.role==="Admin" && current.accessRevision===staff.brokerage.accessRevision;
}
export function maintenanceView(db: Store, id: string, active: number): MaintenanceView {
  return {...maintenanceState(db,id),active,history:db.prepare(
    "SELECT action,actor,at,note FROM brokerage_maintenance_history WHERE brokerageId = ? ORDER BY at DESC,id DESC LIMIT 20"
  ).all(id) as unknown as MaintenanceView["history"]};
}
function record(db: Store,id: string,state: MaintenanceState,action: string,actor: string,note: string,at: string) {
  db.prepare(`INSERT INTO brokerage_maintenance VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(brokerageId) DO UPDATE SET
    mode=excluded.mode,revision=excluded.revision,reason=excluded.reason,startedAt=excluded.startedAt,startedBy=excluded.startedBy,
    reviewedAt=excluded.reviewedAt,reviewedBy=excluded.reviewedBy,review=excluded.review,checks=excluded.checks`)
    .run(id,state.mode,state.revision,state.reason,state.startedAt,state.startedBy,state.reviewedAt,state.reviewedBy,state.review,JSON.stringify(state.checks));
  db.prepare("INSERT INTO brokerage_maintenance_history VALUES (?,?,?,?,?,?)").run(crypto.randomUUID(),id,action,actor,at,note);
}
export function changeMaintenance(db: Store, staff: WorkspaceStaff, emails: string[], input: unknown, now=new Date().toISOString()) {
  return db.transaction(()=>{
    if (!maintenanceAdmin(db,staff,emails)) return {error:"Only an active pilot workspace admin can manage maintenance."};
    const parsed=maintenanceInput.safeParse(input);
    if (!parsed.success) return {error:"Complete the maintenance fields and required checks."};
    const data=parsed.data,id=staff.brokerage.id,state=maintenanceState(db,id);
    if(data.revision!==state.revision) return {error:"Maintenance changed. Refresh its status before continuing."};
    const name=db.prepare("SELECT name FROM brokerages WHERE id = ?").get(id)?.name;
    if ("confirmation" in data && data.confirmation!==name) return {error:"Enter this brokerage’s exact name to confirm."};
    if(data.type==="pause") {
      if(state.mode!=="Open") return {error:"This workspace is already in maintenance. Refresh its status."};
      record(db,id,{...state,mode:"Pausing",revision:state.revision+1,reason:data.reason,startedAt:now,startedBy:staff.name,
        reviewedAt:null,reviewedBy:null,review:"",checks:[false,false,false]},"Started maintenance",staff.name,data.reason,now);
    } else if(data.type==="review") {
      if(state.mode!=="Paused") return {error:"Wait for active work to finish before recording the review."};
      record(db,id,{...state,revision:state.revision+1,reviewedAt:now,reviewedBy:staff.name,review:data.review,checks:data.checks},
        "Recorded reopening review",staff.name,data.review,now);
    } else {
      if(state.mode!=="Paused" || !state.reviewedAt || !state.checks.every(Boolean)) return {error:"Complete the reopening review before reopening the workspace."};
      record(db,id,{...state,mode:"Open",revision:state.revision+1},"Reopened workspace",staff.name,state.review,now);
    }
    return {state:maintenanceState(db,id)};
  });
}
export function markMaintenanceDrained(db: Store,id: string,revision: number) {
  return db.transaction(()=>{
    const state=maintenanceState(db,id);
    if(state.mode==="Pausing" && state.revision===revision) {
      record(db,id,{...state,mode:"Paused",revision:revision+1},"Workspace paused","Orbit","No active workspace requests remain. Review interrupted or unresolved requests before reopening.",new Date().toISOString());
    }
    return maintenanceState(db,id);
  });
}
