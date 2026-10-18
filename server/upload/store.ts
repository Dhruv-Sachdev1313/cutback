import { FalkorDB } from 'falkordb';
import { uploadConfig } from './config.js';
import type { GraphView, UploadProject } from '../../shared/upload.js';
export const IMPORT_IMPACT_QUERY = `MATCH p=(f:Fact {id:$factId})-[:SUPPORTS|APPEARS_IN*1..4]->(s:Scene)
RETURN s.id AS id, [n IN nodes(p) | n.title] AS path`;
export class UploadStore {
  constructor(private db: FalkorDB) {}
  static async connect() {
    const options = {
      socket: { host: '127.0.0.1', port: uploadConfig.dbPort, connectTimeout: 4000 },
      disableOfflineQueue: true,
    };
    const db = await FalkorDB.connect(options);
    db.on('error', () => {});
    return new UploadStore(db);
  }
  name(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid project ID.');
    return 'cutback_import_' + id.replaceAll('-', '');
  }
  async query(id: string, query: string, params: Record<string, any> = {}) {
    const r = await this.db
      .selectGraph(this.name(id))
      .query<Record<string, any>>(query, { params, TIMEOUT: 10000 });
    return r.data || [];
  }
  async save(p: UploadProject) {
    await this.query(p.id, 'MERGE (p:Project {id:$id}) SET p.json=$json', {
      id: p.id,
      json: JSON.stringify(p),
    });
    await this.db
      .selectGraph('cutback_upload_index')
      .query(
        'MERGE (p:UploadProject {id:$id}) SET p.title=$title,p.createdAt=$createdAt,p.status=$status',
        { params: { id: p.id, title: p.title, createdAt: p.createdAt, status: p.status } },
      );
  }
  async get(id: string): Promise<UploadProject> {
    const rows = await this.query(id, 'MATCH (p:Project {id:$id}) RETURN p.json AS json', { id });
    if (!rows.length) throw Object.assign(new Error('Project not found.'), { status: 404 });
    return JSON.parse(rows[0].json);
  }
  async list() {
    const r = await this.db
      .selectGraph('cutback_upload_index')
      .query(
        'MATCH (p:UploadProject) RETURN p.id AS id,p.title AS title,p.createdAt AS createdAt,p.status AS status ORDER BY p.createdAt DESC',
      );
    return r.data || [];
  }
  async build(p: UploadProject) {
    // Only this project's isolated graph is affected; saved media/history is retained.
    await this.query(
      p.id,
      'MATCH (n) WHERE NOT n:Project AND NOT n:Revision AND NOT n:Correction DETACH DELETE n',
    );
    await this.query(p.id, 'CREATE (:Source {id:$id,title:$title,kind:"source",url:$url})', {
      id: 'video',
      title: p.filename,
      url: p.originalUrl,
    });
    if (p.sourceText)
      await this.query(
        p.id,
        'CREATE (:Source {id:"source-note",title:"Your supplied source notes",kind:"source"})',
      );
    for (const e of p.evidence) {
      await this.query(
        p.id,
        'MATCH (src:Source {id:$source}) CREATE (e:Evidence {id:$id,title:$title,kind:"evidence",start:$start,quote:$quote,url:$url}) CREATE (src)-[:CONTAINS]->(e)',
        {
          source: e.kind === 'document' ? 'source-note' : 'video',
          id: e.id,
          title: e.kind === 'document' ? e.sourceName : `${e.kind} · ${e.start.toFixed(1)}s`,
          start: e.start,
          quote: e.text,
          url: e.imageUrl || p.originalUrl,
        },
      );
    }
    for (const s of p.scenes)
      await this.query(
        p.id,
        'CREATE (:Scene {id:$id,title:$title,kind:"scene",start:$start,end:$end})',
        { id: s.id, title: s.title, start: s.start, end: s.end },
      );
    for (const f of p.facts)
      await this.query(
        p.id,
        'MATCH (e:Evidence {id:$evidence}) CREATE (f:Fact {id:$id,title:$title,kind:"fact"}) CREATE (e)-[:SUPPORTS]->(f)',
        { evidence: f.evidenceId, id: f.id, title: f.text },
      );
    for (const c of p.claims) {
      await this.query(p.id, 'CREATE (:Claim {id:$id,title:$title,kind:"claim"})', {
        id: c.id,
        title: c.text,
      });
      for (const f of c.factIds)
        await this.query(
          p.id,
          'MATCH (f:Fact {id:$f}),(c:Claim {id:$c}) MERGE (f)-[:SUPPORTS]->(c)',
          { f, c: c.id },
        );
      for (const s of c.sceneIds)
        await this.query(
          p.id,
          'MATCH (c:Claim {id:$c}),(s:Scene {id:$s}) MERGE (c)-[:APPEARS_IN]->(s)',
          { c: c.id, s },
        );
    }
  }
  async graph(id: string): Promise<GraphView> {
    const nodes = await this.query(
      id,
      'MATCH (n) WHERE n.kind IS NOT NULL RETURN n.id AS id,n.title AS title,n.kind AS kind',
    );
    const edges = await this.query(
      id,
      'MATCH (a)-[r]->(b) WHERE a.kind IS NOT NULL AND b.kind IS NOT NULL RETURN a.id AS from,b.id AS to,type(r) AS type',
    );
    return { nodes, edges } as GraphView;
  }
  async impact(id: string, factId: string) {
    const rows = await this.query(id, IMPORT_IMPACT_QUERY, { factId });
    return {
      sceneIds: [...new Set(rows.map((r) => r.id as string))],
      paths: rows.map((r) => r.path as string[]),
      query: IMPORT_IMPACT_QUERY,
    };
  }
  async receipt(p: UploadProject) {
    const revision = p.revisions.at(-1)!;
    await this.query(
      p.id,
      'MATCH (f:Fact {id:$fact}) CREATE (r:Revision {id:$id,createdAt:$at,videoUrl:$url,json:$json}) CREATE (c:Correction {id:$correction,title:$text,source:$source}) CREATE (c)-[:CORRECTS]->(f) CREATE (r)-[:APPLIES]->(c)',
      {
        fact: revision.correction.factId,
        id: revision.id,
        at: revision.createdAt,
        url: revision.videoUrl,
        json: JSON.stringify(revision),
        correction: 'correction_' + revision.id,
        text: revision.correction.text,
        source: revision.correction.source,
      },
    );
    for (const id of revision.affectedIds)
      await this.query(
        p.id,
        'MATCH (r:Revision {id:$r}),(s:Scene {id:$s}) CREATE (r)-[:REBUILDS]->(s)',
        { r: revision.id, s: id },
      );
  }
  async close() {
    await this.db.close();
  }
}
