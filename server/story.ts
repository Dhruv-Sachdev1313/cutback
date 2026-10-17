import { z } from 'zod';
import type { Calculation, Evidence, Scene, SceneId } from '../shared/types.js';

const cents = z.number().int().min(0).max(1000000);
export const evidenceSchema = z
  .object({ orbitBase: cents, orbitAdapter: cents, adapterIncluded: z.boolean(), formaBase: cents })
  .strict();
export const correctionSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    evidence: evidenceSchema,
    sourceNote: z.string().trim().min(1).max(1000),
  })
  .strict();
export const ORIGINAL: Evidence = {
  orbitBase: 7900,
  orbitAdapter: 4900,
  adapterIncluded: true,
  formaBase: 11900,
};
export const CORRECTED: Evidence = { ...ORIGINAL, adapterIncluded: false };
export const SCENE_IDS: SceneId[] = ['opening', 'cost', 'verdict', 'outro'];
export const FIELD_TITLES: Record<keyof Evidence, string> = {
  orbitBase: 'Orbit Mini · base price',
  orbitAdapter: 'Orbit Mini · adapter price',
  adapterIncluded: 'Orbit Mini · adapter included',
  formaBase: 'Forma One · complete price',
};
export const money = (cents: number) =>
  '$' +
  (cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: cents % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  });
export function calculate(evidence: Evidence): Calculation {
  const e = evidenceSchema.parse(evidence);
  const orbitTotal = e.orbitBase + (e.adapterIncluded ? 0 : e.orbitAdapter);
  const formaTotal = e.formaBase;
  const winner = orbitTotal < formaTotal ? 'orbit' : orbitTotal > formaTotal ? 'forma' : 'tie';
  return {
    orbitTotal,
    formaTotal,
    savings: Math.abs(orbitTotal - formaTotal),
    winner,
    winnerName: winner === 'orbit' ? 'Orbit Mini' : winner === 'forma' ? 'Forma One' : 'Neither',
  };
}
export function changedFields(before: Evidence, after: Evidence) {
  return (Object.keys(before) as (keyof Evidence)[]).filter((key) => before[key] !== after[key]);
}
export type EditorialPlan = {
  sceneIds: SceneId[];
  framing: 'reversal' | 'confirmed' | 'tie';
  transition: 'look_closer' | 'full_picture' | 'follow_evidence';
};
export const planSchema = z
  .object({
    sceneIds: z
      .array(z.enum(['opening', 'cost', 'verdict', 'outro']))
      .min(1)
      .max(4),
    framing: z.enum(['reversal', 'confirmed', 'tie']),
    transition: z.enum(['look_closer', 'full_picture', 'follow_evidence']),
  })
  .strict();
export function expectedFraming(
  previous: Calculation | undefined,
  next: Calculation,
): EditorialPlan['framing'] {
  return next.winner === 'tie'
    ? 'tie'
    : previous && previous.winner !== next.winner
      ? 'reversal'
      : 'confirmed';
}
export function validatePlan(
  plan: EditorialPlan,
  affected: SceneId[],
  previous: Calculation | undefined,
  next: Calculation,
) {
  planSchema.parse(plan);
  if (
    new Set(plan.sceneIds).size !== plan.sceneIds.length ||
    [...plan.sceneIds].sort().join() !== [...affected].sort().join()
  )
    throw new Error('The edit plan must contain exactly the scenes reached through the graph.');
  if (plan.framing !== expectedFraming(previous, next))
    throw new Error('The editorial framing contradicts the calculated result.');
}
export function buildScenes(e: Evidence, c: Calculation, plan?: EditorialPlan): Scene[] {
  const lead =
    plan?.transition === 'full_picture'
      ? 'Here is the full picture.'
      : plan?.transition === 'follow_evidence'
        ? 'Follow the evidence.'
        : 'Let’s look a little closer.';
  const costNote = e.adapterIncluded
    ? 'The required adapter is included.'
    : 'The required adapter is sold separately for ' + money(e.orbitAdapter) + '.';
  const verdict =
    c.winner === 'tie'
      ? 'Both cost ' + money(c.orbitTotal) + ' to get started. On upfront cost, it is a tie.'
      : c.winnerName +
        ' costs ' +
        money(c.savings) +
        ' less to get started. That makes it our lower-cost pick.';
  const allFacts = Object.keys(e).map((k) => 'fact_' + k);
  const scripts = [
    {
      id: 'opening' as const,
      label: 'The question',
      headline: 'Small speakers.\nThe bigger picture.',
      subline: 'ORBIT MINI / FORMA ONE',
      narration:
        'Two small speakers. One simple question. Which costs less to get started? Let’s follow the numbers.',
      citedFacts: [],
    },
    {
      id: 'cost' as const,
      label: 'The real cost',
      headline: 'What does it\nactually cost?',
      subline: 'TOTAL UPFRONT COST · USD',
      narration:
        lead +
        ' Orbit Mini starts at ' +
        money(e.orbitBase) +
        '. ' +
        costNote +
        ' Total cost: ' +
        money(c.orbitTotal) +
        '. Forma One costs ' +
        money(c.formaTotal) +
        ', ready to use.',
      citedFacts: allFacts,
    },
    {
      id: 'verdict' as const,
      label: 'The verdict',
      headline:
        c.winner === 'tie' ? 'A level\nplaying field.' : c.winnerName + '.\nThe lower-cost pick.',
      subline:
        c.winner === 'tie' ? 'SAME COST TO GET STARTED' : money(c.savings) + ' LESS TO GET STARTED',
      narration: verdict,
      citedFacts: allFacts,
    },
    {
      id: 'outro' as const,
      label: 'The evidence',
      headline: 'Good stories\nfollow the facts.',
      subline: 'MADE WITH CUTBACK',
      narration:
        'This comparison covers upfront cost, not sound quality. Both products and their specifications are fictional. Every conclusion stays linked to its evidence.',
      citedFacts: [],
    },
  ];
  return scripts.map((s, order) => ({
    ...s,
    order,
    duration: 0,
    footageHash: '',
    videoUrl: '',
    posterUrl: '',
    audioUrl: '',
    rebuilt: true,
  }));
}
