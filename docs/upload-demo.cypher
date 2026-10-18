// CUTBACK upload demo — READ-ONLY queries.
// Open http://localhost:6398 and select the uploaded project's graph.
// Copy its name from CUTBACK > Review the graph > Dependency graph
// > Inspect this project in FalkorDB Browser.
// Do not select cutback_upload_index for these queries.
// Run one query at a time. No query here calls OpenAI or changes data.

// 0. A newly analysed project has zero exports; its first render creates one.
MATCH (r:Revision)
RETURN count(r) AS exports;

// 1. Find the fact meaning "the required adapter is included".
// In the tested project it is f2. A new extraction may assign another ID.
// Replace f2 in subsequent queries with the ID you find here.
MATCH (f:Fact)
RETURN f.id AS id, f.title AS fact
ORDER BY id;

// 2. Provenance: where did the original assumption come from?
// e.quote contains the full evidence passage; the UI shows the selected excerpt.
MATCH (src:Source)-[:CONTAINS]->(e:Evidence)-[:SUPPORTS]->(f:Fact {id:'f2'})
RETURN src.title AS source,
       e.title AS evidence,
       e.quote AS sourcePassage,
       f.title AS originalFact;

// 3. Main visual query: connected source, fact, claims and scenes.
// RETURN p returns paths that Browser can draw as a graph.
MATCH p=(src:Source)-[:CONTAINS]->(:Evidence)-[:SUPPORTS]->(f:Fact {id:'f2'})
        -[:SUPPORTS]->(:Claim)-[:APPEARS_IN]->(:Scene)
RETURN p;

// 4. Main impact query: the unique segments allowed to change.
// This uses the same MATCH pattern as the agent's trace_impact tool.
// Aligned speaker-film result: s1 = 6.917–20.292s; s2 = 20.292–25.75s.
MATCH p=(f:Fact {id:'f2'})-[:SUPPORTS|APPEARS_IN*1..4]->(s:Scene)
RETURN DISTINCT s.id AS sceneId,
                s.title AS scene,
                s.start AS startsAt,
                s.end AS endsAt
ORDER BY startsAt;

// 5. Explanation paths: several paths can lead to the same scene.
// The aligned rehearsal reaches the cost scene and verdict through 2 paths.
// New analyses may produce different fact IDs or multiple paths per scene.
MATCH p=(f:Fact {id:'f2'})-[:SUPPORTS|APPEARS_IN*1..4]->(s:Scene)
RETURN s.id AS sceneId,
       [n IN nodes(p) | n.title] AS dependencyPath;

// 6. After rendering: original fact, correction, export and rebuilt scenes.
// No rows before the first successful render is expected.
MATCH p=(f:Fact)<-[:CORRECTS]-(c:Correction)<-[:APPLIES]-(r:Revision)
        -[:REBUILDS]->(s:Scene)
RETURN p;

// 7. Table receipt, including the source text supplied for the correction.
MATCH (r:Revision)-[:APPLIES]->(c:Correction),
      (r)-[:REBUILDS]->(s:Scene)
RETURN r.id AS revision,
       c.title AS correction,
       c.source AS correctionSource,
       collect(DISTINCT s.title) AS rebuiltScenes;
