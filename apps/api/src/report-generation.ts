import { z } from "zod";

export class SourceGroundingError extends Error {}

const aiOutputSchema = z.object({
  items: z.array(
    z.object({
      section: z.string().min(1).max(100),
      title: z.string().min(1).max(300),
      content: z.string().min(1),
      sourceIds: z.array(z.uuid()).min(1),
    }),
  ).min(1),
});

export type GroundedAiItem = z.infer<typeof aiOutputSchema>["items"][number];

/** Parses model output only; it cannot create facts, metrics, or non-AI report items. */
export function parseGroundedAiOutput(raw: string, allowedSourceIds: readonly string[]): GroundedAiItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SourceGroundingError("AI output was not valid JSON.");
  }
  const result = aiOutputSchema.safeParse(parsed);
  if (!result.success) throw new SourceGroundingError("AI output did not match the required structured schema.");
  const allowed = new Set(allowedSourceIds);
  for (const item of result.data.items) {
    if (item.sourceIds.some((sourceId) => !allowed.has(sourceId))) {
      throw new SourceGroundingError("AI output cited a source outside the allowed workflow context.");
    }
  }
  return result.data.items;
}
