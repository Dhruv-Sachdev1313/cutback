// Select the cutback graph in FalkorDB Browser before running a query.
// All queries in this file are read-only.

// 1. The authored dependency model, including isolated opening/outro nodes.
MATCH (a:Artifact)
OPTIONAL MATCH (a)-[r:FEEDS]->(b:Artifact)
RETURN a, r, b;

// 2. Paths from the corrected adapter-inclusion fact to the affected scenes.
// Expected: two paths, with six unique nodes and five relationships.
MATCH p=(f:Artifact {id:'fact_adapterIncluded'})
  -[:FEEDS*1..8]->(s:Artifact {kind:'scene'})
RETURN p;

// 3. The same result as columns for this model's fact/calculation/claim/scene path.
MATCH p=(f:Artifact {id:'fact_adapterIncluded'})
  -[:FEEDS*1..8]->(s:Artifact {kind:'scene'})
WITH s, [n IN nodes(p) | n.title] AS steps
RETURN steps[0] AS fact,
  steps[1] AS calculation,
  steps[2] AS claim,
  s.title AS scene;

// 4. Persisted published versions. The count grows as revisions are created.
MATCH (v:Version {status:'ready'})
RETURN v.revision AS revision, v.id AS version_id
ORDER BY v.revision DESC;
