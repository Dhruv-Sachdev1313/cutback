export type Provider = 'api' | 'chatgpt';
export type EvidenceItem = {
  id: string;
  kind: 'speech' | 'frame' | 'document';
  text: string;
  start: number;
  end: number;
  sourceName: string;
  imageUrl?: string;
};
export type ImportedScene = {
  id: string;
  title: string;
  start: number;
  end: number;
  transcript: string;
  frameUrl: string;
  clipUrl?: string;
};
export type ImportedFact = { id: string; text: string; evidenceId: string; quote: string };
export type ImportedClaim = { id: string; text: string; factIds: string[]; sceneIds: string[] };
export type Edit = { sceneId: string; title: string; narration: string; reason: string };
export type Correction = { factId: string; text: string; source: string };
export type UploadEvent = { at: string; tool: string; detail: string };
export type ImportedRevision = {
  id: string;
  createdAt: string;
  videoUrl: string;
  captionsUrl: string;
  correction: Correction;
  edits: Edit[];
  affectedIds: string[];
  preservedIds: string[];
};
export type UploadProject = {
  id: string;
  filename: string;
  title: string;
  createdAt: string;
  originalUrl: string;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  status:
    | 'uploaded'
    | 'extracting'
    | 'review'
    | 'ready'
    | 'planning'
    | 'plan'
    | 'rendering'
    | 'complete'
    | 'failed';
  error?: string;
  provider: Provider;
  model: string;
  sourceText: string;
  evidence: EvidenceItem[];
  scenes: ImportedScene[];
  facts: ImportedFact[];
  claims: ImportedClaim[];
  approved: boolean;
  correction?: Correction;
  edits?: Edit[];
  impact?: { sceneIds: string[]; paths: string[][]; query: string };
  revisions: ImportedRevision[];
  events: UploadEvent[];
};
export type GraphView = {
  nodes: { id: string; title: string; kind: string }[];
  edges: { from: string; to: string; type: string }[];
};
