import { z } from 'zod';
import type { ImportedClaim, ImportedFact, UploadProject, Edit } from '../../shared/upload.js';
const short = z.string().trim().min(1).max(450);
export const analysisSchema = z.object({
  title: z.string().min(1).max(100),
  facts: z
    .array(
      z.object({
        id: z.string().regex(/^f\d+$/),
        text: short,
        evidenceId: z.string(),
        quote: short,
      }),
    )
    .min(1)
    .max(18),
  claims: z
    .array(
      z.object({
        id: z.string().regex(/^c\d+$/),
        text: short,
        factIds: z.array(z.string()).min(1).max(10),
        sceneIds: z.array(z.string()).min(1).max(12),
      }),
    )
    .min(1)
    .max(18),
});
export const editSchema = z.object({
  edits: z
    .array(
      z.object({
        sceneId: z.string(),
        title: z.string().min(1).max(100),
        narration: z.string().min(10).max(650),
        reason: short,
      }),
    )
    .min(1)
    .max(12),
});
export const correctionSchema = z.object({
  factId: z.string(),
  text: short,
  source: z.string().trim().min(8).max(2000),
});
const normalized = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
export function validateAnalysis(p: UploadProject, facts: ImportedFact[], claims: ImportedClaim[]) {
  if (
    new Set(facts.map((f) => f.id)).size !== facts.length ||
    new Set(claims.map((c) => c.id)).size !== claims.length
  )
    throw new Error('The analysis returned duplicate IDs.');
  for (const fact of facts) {
    const evidence = p.evidence.find((e) => e.id === fact.evidenceId);
    if (!evidence) throw new Error('The analysis cited evidence that does not exist.');
    if (evidence.kind !== 'frame' && !normalized(evidence.text).includes(normalized(fact.quote)))
      throw new Error(
        'A quoted passage could not be found in its source. Review the transcript before retrying.',
      );
  }
  for (const claim of claims) {
    if (
      claim.factIds.some((id) => !facts.some((f) => f.id === id)) ||
      claim.sceneIds.some((id) => !p.scenes.some((s) => s.id === id))
    )
      throw new Error('The analysis linked a missing fact or scene.');
  }
  if (facts.some((f) => !claims.some((c) => c.factIds.includes(f.id))))
    throw new Error('The analysis contains an unconnected fact.');
}
export function validateEdits(allowed: string[], edits: Edit[]) {
  const ids = edits.map((e) => e.sceneId);
  if (
    ids.length !== new Set(ids).size ||
    ids.length !== allowed.length ||
    ids.some((id) => !allowed.includes(id))
  )
    throw new Error('The edit plan must contain exactly the scenes reached by FalkorDB.');
}
