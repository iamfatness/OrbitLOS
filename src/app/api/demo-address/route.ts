import { placesHttp } from "@/lib/places";
import { reserveBorrowerAddressLookup } from "@/lib/workspace-service";

export function POST(request: Request) {
  return placesHttp(request, process.env.GOOGLE_PLACES_API_KEY?.trim() ?? "", reserveBorrowerAddressLookup);
}
