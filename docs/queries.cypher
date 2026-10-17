// 1. Multi-hop invalidation. Parameters: factIds, e.g. ["fact_adapterIncluded"].
MATCH p=(f:Artifact)-[:FEEDS*1..8]->(a:Artifact)
WHERE f.id IN $factIds
RETURN DISTINCT a.id AS id, a.kind AS kind,
  [n IN nodes(p) | n.id] AS pathIds,
  [n IN nodes(p) | n.title] AS pathTitles;

// 2. Explain a scene. Parameter: sceneId, e.g. "scene_verdict".
MATCH p=(s:Artifact {kind:'source'})-[:FEEDS*1..8]->(scene:Artifact {id:$sceneId})
RETURN [n IN nodes(p) | n.id] AS ids, [n IN nodes(p) | n.title] AS titles;

// 3. Read a run's candidate evidence for calculation and verification.
MATCH (r:Run {id:$id})-[:HAS_CANDIDATE]->(f:CandidateFact)
  -[:INSTANCE_OF]->(:Artifact {kind:'fact'})
RETURN f.field AS field, f.value AS value;

// 4. Inspect immutable evidence actually cited by a historical scene.
// Parameter: sceneVersionId = version ID + ":cost" or ":verdict".
MATCH (s:SceneVersion {id:$sceneVersionId})-[:CITES]->(f:CandidateFact)
MATCH (source:SourceVersion)-[:REPORTS]->(f)
RETURN s.sceneId, source.revision, source.note, f.field, f.value;

// 5. Persistent execution trace.
MATCH (:Run {id:$id})-[:RECORDED]->(e:RunEvent)
RETURN e.json AS json ORDER BY e.seq;

// 6. Atomic acquisition of a revision lock; used with Run creation in store.ts.
MATCH (p:Project {id:'cutback'})
WHERE p.revision=$expected AND p.busyRun=''
SET p.busyRun=$id
RETURN p.revision AS revision;
