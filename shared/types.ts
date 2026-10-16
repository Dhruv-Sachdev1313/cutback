export type Winner = 'orbit' | 'forma' | 'tie';
export type Evidence = {
  orbitBase: number; orbitAdapter: number; adapterIncluded: boolean; formaBase: number;
};
export type Calculation = {
  orbitTotal: number; formaTotal: number; savings: number; winner: Winner; winnerName: string;
};
export type SceneId = 'opening' | 'cost' | 'verdict' | 'outro';
export type Scene = {
  id: SceneId; order: number; label: string; headline: string; subline: string; narration: string;
  duration: number; footageHash: string; videoUrl: string; posterUrl: string; audioUrl: string;
  rebuilt: boolean; citedFacts: string[];
};
export type Version = {
  id: string; revision: number; createdAt: string; evidence: Evidence; calculation: Calculation;
  sourceNote: string; scenes: Scene[]; videoUrl: string; captionsUrl: string; duration: number;
  changedFields: string[]; affectedScenes: SceneId[]; mode: 'openai' | 'local'; runId: string;
  checks: { name: string; passed: boolean; detail: string }[];
};
export type GraphNode = { id: string; kind: string; title: string; layer: number; order: number };
export type GraphEdge = { source: string; target: string };
export type EvidenceGraph = { nodes: GraphNode[]; edges: GraphEdge[] };
export type ImpactPath = { ids: string[]; titles: string[] };
export type Impact = { nodes: string[]; sceneIds: SceneId[]; paths: ImpactPath[]; query: string };
export type RunEvent = {
  seq: number; time: string; role: 'system' | 'evidence' | 'analyst' | 'editor' | 'renderer' | 'verifier';
  tool: string; title: string; detail: string; status: 'running' | 'done' | 'error';
  data?: unknown;
};
export type Run = {
  id: string; status: 'running' | 'complete' | 'failed'; revision: number; mode: 'openai' | 'local';
  events: RunEvent[]; impact?: Impact; error?: string; versionId?: string;
};
export type AppState = {
  ready: boolean; graphConnected: boolean; mode: 'openai' | 'local'; model: string;
  versions: Version[]; latest: Version | null; graph: EvidenceGraph; activeRun: Run | null;
};
