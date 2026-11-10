import { z } from "zod";

export const borrowerChannels = ["Call", "Email", "Text"] as const;
export type BorrowerChannel = (typeof borrowerChannels)[number];
export const borrowerChannelBits = { Call: 1, Email: 2, Text: 4 } satisfies Record<BorrowerChannel, number>;

export function borrowerChannelBlocked(blocked: number | undefined, channel: BorrowerChannel) {
  return Boolean((blocked ?? 0) & borrowerChannelBits[channel]);
}

export const saveBorrowerChannelsInput = z.object({
  type: z.literal("saveBorrowerChannels"),
  target: z.enum(["lead", "contact"]),
  recordId: z.string().min(1).max(200),
  expected: z.number().int().min(0).max(7),
  blocked: z.number().int().min(0).max(7),
});
