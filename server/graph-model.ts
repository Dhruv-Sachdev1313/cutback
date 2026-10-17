import type { EvidenceGraph } from '../shared/types.js';
export const GRAPH: EvidenceGraph = {
  nodes: [
    { id: 'source_orbit', kind: 'source', title: 'Orbit price sheet', layer: 0, order: 0 },
    { id: 'source_forma', kind: 'source', title: 'Forma price sheet', layer: 0, order: 1 },
    { id: 'fact_orbitBase', kind: 'fact', title: 'Base price', layer: 1, order: 0 },
    { id: 'fact_orbitAdapter', kind: 'fact', title: 'Adapter price', layer: 1, order: 1 },
    { id: 'fact_adapterIncluded', kind: 'fact', title: 'Adapter included?', layer: 1, order: 2 },
    { id: 'fact_formaBase', kind: 'fact', title: 'Complete price', layer: 1, order: 3 },
    { id: 'calc_orbit', kind: 'calculation', title: 'Orbit total cost', layer: 2, order: 0 },
    { id: 'calc_forma', kind: 'calculation', title: 'Forma total cost', layer: 2, order: 1 },
    { id: 'claim_cost', kind: 'claim', title: 'Price comparison', layer: 3, order: 0 },
    { id: 'claim_verdict', kind: 'claim', title: 'Lower-cost choice', layer: 3, order: 1 },
    { id: 'scene_opening', kind: 'scene', title: '01 · The question', layer: 4, order: 0 },
    { id: 'scene_cost', kind: 'scene', title: '02 · The real cost', layer: 4, order: 1 },
    { id: 'scene_verdict', kind: 'scene', title: '03 · The verdict', layer: 4, order: 2 },
    { id: 'scene_outro', kind: 'scene', title: '04 · The evidence', layer: 4, order: 3 },
    { id: 'asset_cost', kind: 'asset', title: 'Chart + voice + captions', layer: 5, order: 0 },
    { id: 'asset_verdict', kind: 'asset', title: 'Title + voice + captions', layer: 5, order: 1 },
  ],
  edges: [
    ['source_orbit', 'fact_orbitBase'],
    ['source_orbit', 'fact_orbitAdapter'],
    ['source_orbit', 'fact_adapterIncluded'],
    ['source_forma', 'fact_formaBase'],
    ['fact_orbitBase', 'calc_orbit'],
    ['fact_orbitAdapter', 'calc_orbit'],
    ['fact_adapterIncluded', 'calc_orbit'],
    ['fact_formaBase', 'calc_forma'],
    ['calc_orbit', 'claim_cost'],
    ['calc_forma', 'claim_cost'],
    ['calc_orbit', 'claim_verdict'],
    ['calc_forma', 'claim_verdict'],
    ['claim_cost', 'scene_cost'],
    ['claim_verdict', 'scene_verdict'],
    ['scene_cost', 'asset_cost'],
    ['scene_verdict', 'asset_verdict'],
  ].map(([source, target]) => ({ source, target })),
};
export const IMPACT_QUERY = `MATCH p=(f:Artifact)-[:FEEDS*1..8]->(a:Artifact)
WHERE f.id IN $factIds
RETURN DISTINCT a.id AS id, a.kind AS kind,
  [n IN nodes(p) | n.id] AS pathIds,
  [n IN nodes(p) | n.title] AS pathTitles`;
export const PROVENANCE_QUERY = `MATCH p=(s:Artifact {kind:'source'})-[:FEEDS*1..8]->(scene:Artifact {id:$sceneId})
RETURN [n IN nodes(p) | n.id] AS ids, [n IN nodes(p) | n.title] AS titles`;
