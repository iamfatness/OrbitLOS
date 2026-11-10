import { demoBrokerageId } from "@/lib/brokerage-model";
import { closingPacketRequest, closingPacketUnavailable } from "@/lib/closing-packet-model";
import { currentStaff, loadClosingPacket } from "@/lib/workspace-service";

const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const staff = await currentStaff();
  const brokerageId = params.get("brokerage") ?? demoBrokerageId;
  if (brokerageId !== (staff?.brokerage.id ?? demoBrokerageId) || (!staff && process.env.NODE_ENV !== "development")) {
    return Response.json({ error: closingPacketUnavailable }, { status: 403, headers: privateHeaders });
  }
  const input = closingPacketRequest.safeParse({ loanId: params.get("loanId"), version: Number(params.get("version")) });
  const packet = input.success && await loadClosingPacket(input.data, staff);
  if (!packet) return Response.json({ error: closingPacketUnavailable }, { status: 404, headers: privateHeaders });
  return new Response(packet.pdf, { headers: { ...privateHeaders,
    "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="orbit-sample-closing-packet-v${packet.version}.pdf"`,
  } });
}
