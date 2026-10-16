import { FalkorDB } from 'falkordb';
import type { Evidence, EvidenceGraph, Impact, ImpactPath, Run, RunEvent, SceneId, Version } from '../shared/types.js';
import { config } from './config.js';
import { GRAPH, IMPACT_QUERY, PROVENANCE_QUERY } from './graph-model.js';
import { evidenceSchema } from './story.js';

type Params = Record<string, string | number | boolean | null | string[]>;
export class ConflictError extends Error { status = 409; }
export class GraphStore {
  private constructor(private db: FalkorDB, readonly name: string) {}
  static async connect(name = config.graph) {
    const db = await FalkorDB.connect({
      host: config.graphHost, port: config.graphPort,
      ...(process.env.FALKORDB_PASSWORD ? { password: process.env.FALKORDB_PASSWORD } : {}),
      socket: { host: config.graphHost, port: config.graphPort, connectTimeout: 4000 },
    });
    db.on('error', (error: Error) => console.error('[FalkorDB]', error.message));
    return new GraphStore(db, name);
  }
  async query<T = Record<string, unknown>>(query: string, params: Params = {}): Promise<T[]> {
    const result = await this.db.selectGraph(this.name).query<T>(query, { params, TIMEOUT: 10000 });
    return result.data || [];
  }
  async close() { await this.db.close(); }
  async health() { return (await this.query<{ok: number}>('RETURN 1 AS ok'))[0]?.ok === 1; }
  async initialize() {
    await this.query("MERGE (p:Project {id:'cutback'}) ON CREATE SET p.revision=0, p.busyRun='', p.activeVersion=''");
    for (const n of GRAPH.nodes) await this.query('MERGE (a:Artifact {id:$id}) SET a.kind=$kind, a.title=$title, a.layer=$layer, a.order=$order', n);
    for (const edge of GRAPH.edges) await this.query('MATCH (a:Artifact {id:$source}), (b:Artifact {id:$target}) MERGE (a)-[:FEEDS]->(b)', edge);
  }
  async recoverInterruptedRuns() {
    await this.query("MATCH (p:Project {id:'cutback'}) MATCH (r:Run {id:p.busyRun}) WHERE r.status='running' SET r.status='failed', r.error='The server restarted before this render finished. The previous version is intact.', p.busyRun=''");
  }
  async graph(): Promise<EvidenceGraph> {
    const nodes = await this.query<EvidenceGraph['nodes'][number]>('MATCH (a:Artifact) RETURN a.id AS id, a.kind AS kind, a.title AS title, a.layer AS layer, a.order AS order ORDER BY a.layer, a.order');
    const edges = await this.query<EvidenceGraph['edges'][number]>('MATCH (a:Artifact)-[:FEEDS]->(b:Artifact) RETURN a.id AS source, b.id AS target');
    return { nodes, edges };
  }
  async impact(fields: string[]): Promise<Impact> {
    const factIds = fields.map(f => 'fact_' + f);
    const rows = await this.query<{id: string; kind: string; pathIds: string[]; pathTitles: string[]}>(IMPACT_QUERY, { factIds });
    return {
      nodes: [...new Set([...factIds, ...rows.map(r => r.id)])],
      sceneIds: [...new Set(rows.filter(r => r.kind === 'scene').map(r => r.id.replace('scene_', '') as SceneId))],
      paths: rows.filter(r => r.kind === 'scene').map(r => ({ ids: r.pathIds, titles: r.pathTitles })),
      query: IMPACT_QUERY,
    };
  }
  async provenance(sceneId: SceneId): Promise<ImpactPath[]> { return this.query(PROVENANCE_QUERY, { sceneId: 'scene_' + sceneId }); }
  async versions(): Promise<Version[]> {
    const rows = await this.query<{json: string}>('MATCH (v:Version {status:\'ready\'}) RETURN v.json AS json ORDER BY v.revision DESC');
    return rows.map(row => JSON.parse(row.json) as Version);
  }
  async latest(): Promise<Version | null> {
    const rows = await this.query<{json: string}>("MATCH (p:Project {id:'cutback'}) MATCH (v:Version {id:p.activeVersion, status:'ready'}) RETURN v.json AS json");
    return rows.length ? JSON.parse(rows[0].json) : null;
  }
  async startRun(run: Run, evidence: Evidence, expectedRevision: number, note: string) {
    const rows = await this.query<{id: string}>(`MATCH (p:Project {id:'cutback'})
      WHERE p.revision=$expected AND p.busyRun=''
      SET p.busyRun=$id
      CREATE (r:Run {id:$id, status:'running', revision:$revision, mode:$mode, sourceNote:$note, createdAt:$now})
      CREATE (p)-[:HAS_RUN]->(r) RETURN r.id AS id`,
      { expected: expectedRevision, id: run.id, revision: run.revision, mode: run.mode, note, now: new Date().toISOString() });
    if (!rows.length) throw new ConflictError('The evidence changed or another render is running. Refresh and try again.');
    try {
      for (const [field, value] of Object.entries(evidence)) await this.query(`MATCH (r:Run {id:$runId}), (a:Artifact {id:$artifactId})
        CREATE (f:CandidateFact {id:$id, field:$field, value:$value})
        CREATE (r)-[:HAS_CANDIDATE]->(f) CREATE (f)-[:INSTANCE_OF]->(a)`,
        { runId: run.id, id: run.id + ':' + field, artifactId: 'fact_' + field, field, value: JSON.stringify(value) });
    } catch (error) { await this.failRun(run.id, 'Could not save candidate evidence.'); throw error; }
  }
  async candidateEvidence(runId: string): Promise<Evidence> {
    const rows = await this.query<{field: string; value: string}>(`MATCH (r:Run {id:$id})-[:HAS_CANDIDATE]->(f:CandidateFact)-[:INSTANCE_OF]->(:Artifact {kind:'fact'}) RETURN f.field AS field, f.value AS value`, { id: runId });
    return evidenceSchema.parse(Object.fromEntries(rows.map(r => [r.field, JSON.parse(r.value)])));
  }
  async setImpact(runId: string, impact: Impact) { await this.query('MATCH (r:Run {id:$id}) SET r.impact=$json', { id: runId, json: JSON.stringify(impact) }); }
  async appendEvent(runId: string, event: RunEvent) {
    await this.query('MATCH (r:Run {id:$id}) CREATE (e:RunEvent {seq:$seq, json:$json}) CREATE (r)-[:RECORDED]->(e)', { id: runId, seq: event.seq, json: JSON.stringify(event) });
  }
  async getRun(id: string): Promise<Run | null> {
    const rows = await this.query<{id: string; status: Run['status']; revision: number; mode: Run['mode']; impact: string | null; error: string | null; versionId: string | null}>('MATCH (r:Run {id:$id}) RETURN r.id AS id, r.status AS status, r.revision AS revision, r.mode AS mode, r.impact AS impact, r.error AS error, r.versionId AS versionId', { id });
    if (!rows.length) return null;
    const events = await this.query<{json: string}>('MATCH (:Run {id:$id})-[:RECORDED]->(e:RunEvent) RETURN e.json AS json ORDER BY e.seq', { id });
    const row = rows[0];
    return { ...row, impact: row.impact ? JSON.parse(row.impact) : undefined, error: row.error || undefined, versionId: row.versionId || undefined, events: events.map(e => JSON.parse(e.json)) };
  }
  async activeRun() {
    const rows = await this.query<{id: string}>("MATCH (p:Project {id:'cutback'}) WHERE p.busyRun<>'' RETURN p.busyRun AS id");
    return rows.length ? this.getRun(rows[0].id) : null;
  }
  async finishRun(version: Version) {
    // Candidate facts become immutable evidence for this version. Old sources are never overwritten.
    for (const product of ['orbit', 'forma']) {
      const sourceId = version.id + ':source:' + product;
      await this.query(`MATCH (r:Run {id:$runId}) CREATE (s:SourceVersion {id:$id, product:$product, revision:$revision, note:$note}) CREATE (r)-[:PRODUCED_SOURCE]->(s)`, { runId: version.runId, id: sourceId, product, revision: version.revision, note: version.sourceNote });
      await this.query(`MATCH (r:Run {id:$runId})-[:HAS_CANDIDATE]->(f:CandidateFact), (s:SourceVersion {id:$sourceId})
        WHERE ($product='orbit' AND f.field<>'formaBase') OR ($product='forma' AND f.field='formaBase')
        CREATE (s)-[:REPORTS]->(f)`, { runId: version.runId, sourceId, product });
    }
    for (const scene of version.scenes) {
      await this.query(`MATCH (r:Run {id:$runId}), (a:Artifact {id:$artifactId})
        CREATE (s:SceneVersion {id:$id, sceneId:$sceneId, hash:$hash, json:$json})
        CREATE (r)-[:PRODUCED_SCENE]->(s) CREATE (s)-[:REALIZES]->(a)`,
        { runId: version.runId, artifactId: 'scene_' + scene.id, id: version.id + ':' + scene.id, sceneId: scene.id, hash: scene.footageHash, json: JSON.stringify(scene) });
      if (scene.citedFacts.length) await this.query(`MATCH (s:SceneVersion {id:$id}), (r:Run {id:$runId})-[:HAS_CANDIDATE]->(f:CandidateFact)-[:INSTANCE_OF]->(a:Artifact)
        WHERE a.id IN $facts CREATE (s)-[:CITES]->(f)`, { id: version.id + ':' + scene.id, runId: version.runId, facts: scene.citedFacts });
    }
    const rows = await this.query<{id: string}>(`MATCH (p:Project {id:'cutback'}), (r:Run {id:$runId})
      WHERE p.busyRun=$runId AND p.revision=$previous
      CREATE (v:Version {id:$id, revision:$revision, status:'ready', json:$json})
      CREATE (p)-[:HAS_VERSION]->(v) CREATE (v)-[:CREATED_BY]->(r)
      SET p.revision=$revision, p.activeVersion=$id, p.busyRun='', r.status='complete', r.versionId=$id
      RETURN v.id AS id`,
      { runId: version.runId, previous: version.revision - 1, id: version.id, revision: version.revision, json: JSON.stringify(version) });
    if (!rows.length) throw new ConflictError('The project changed before the render could be published.');
  }
  async failRun(id: string, message: string) {
    await this.query("MATCH (p:Project {id:'cutback'}), (r:Run {id:$id}) SET r.status='failed', r.error=$message WITH p WHERE p.busyRun=$id SET p.busyRun=''", { id, message });
  }
}
