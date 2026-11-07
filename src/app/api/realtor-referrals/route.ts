import { realtorHttp } from "@/lib/realtor-portal";
import { loadRealtorReferrals } from "@/lib/workspace-service";

export function POST(request: Request) {
  return realtorHttp(request, loadRealtorReferrals);
}
