import { z } from "zod";

const id = z.uuid();
const note = z.string().trim().min(1).max(2000);
const mutation = { requestId: id };
const version = { versionId: id };
const assignment = { assignmentId: id };
const question = z.strictObject({ prompt: z.string().trim().min(1).max(1000),
  options: z.array(z.string().trim().min(1).max(500)).min(2).max(6),
  correctIndex: z.number().int().min(0).max(5), explanation: z.string().trim().min(1).max(1000) })
  .refine(q => q.correctIndex < q.options.length, "Answer must identify an option");
export const learningRequest = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("myAssignments"), after: z.number().int().nonnegative().optional() }),
  z.strictObject({ operation: z.literal("list"), after: z.number().int().nonnegative().optional() }),
  z.strictObject({ operation: z.literal("listAssignments"), versionId: id, after: z.number().int().nonnegative().optional() }),
  z.strictObject({ operation: z.literal("readVersion"), ...version }),
  z.strictObject({ operation: z.literal("readAssignment"), ...assignment }),
  z.strictObject({ operation: z.literal("createVersion"), ...mutation, contentId: id,
    previousVersionId: id.nullable(), kind: z.enum(["Policy", "Course"]),
    title: z.string().trim().min(1).max(160), body: z.string().trim().min(1).max(40000),
    sourceReferences: z.string().trim().min(1).max(4000),
    questions: z.array(question).max(20), passPercent: z.number().int().min(1).max(100) }),
  z.strictObject({ operation: z.literal("review"), ...mutation, ...version, note,
    lawyerReviewReference: note, rightsConfirmed: z.literal(true), userReviewed: z.literal(true) }),
  z.strictObject({ operation: z.literal("publish"), ...mutation, ...version }),
  z.strictObject({ operation: z.literal("assign"), ...mutation, ...version, employeeEmail: z.email(), dueAt: z.iso.datetime() }),
  z.strictObject({ operation: z.literal("revokeAssignment"), ...mutation, ...assignment, note }),
  z.strictObject({ operation: z.literal("acknowledge"), ...mutation, ...assignment, ...version, acknowledged: z.literal(true) }),
  z.strictObject({ operation: z.literal("attempt"), ...mutation, ...assignment, ...version,
    answers: z.array(z.number().int().min(0).max(5)).min(1).max(20) }),
]);
export type LearningRequest = z.infer<typeof learningRequest>;
export const learningDisclaimer = "Internal training and policy evidence only; not NMLS CE credit or regulatory certification. Launch requires user and lawyer review.";
