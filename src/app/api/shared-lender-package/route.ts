import { demoBrokerageId, portalBrokerage } from "@/lib/brokerage-model";
import { sharedLenderPackageHttp } from "@/lib/lender-handoff-share-http";
import { loadSharedLenderPackage } from "@/lib/workspace-service";

export function POST(request: Request) {
  return sharedLenderPackageHttp(request, (token) => portalBrokerage(token) === demoBrokerageId ?
    { id: demoBrokerageId, read: loadSharedLenderPackage } : null);
}
