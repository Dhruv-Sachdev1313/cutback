import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import type { Evidence, Impact, Run, RunEvent, Scene, Version } from '../shared/types.js';
import { agentMode } from './config.js';
import { GraphStore } from './store.js';
import {
  ORIGINAL,
  SCENE_IDS,
  buildScenes,
  calculate,
  changedFields,
  type EditorialPlan,
} from './story.js';
import { editorialAgent } from './agent.js';
import { assembleVideo, fileForUrl, renderScene } from './render.js';

export const events = new EventEmitter();
export class Pipeline {
  constructor(readonly store: GraphStore) {}
  async begin(evidence: Evidence, expectedRevision: number, sourceNote: string): Promise<Run> {
    const previous = await this.store.latest();
    const fields = previous ? changedFields(previous.evidence, evidence) : Object.keys(evidence);
    if (previous && !fields.length)
      throw Object.assign(
        new Error('No facts changed. Edit a price or adapter inclusion before rebuilding.'),
        { status: 400 },
      );
    const run: Run = {
      id: randomUUID(),
      revision: expectedRevision + 1,
      status: 'running',
      mode: agentMode(),
      events: [],
    };
    await this.store.startRun(run, evidence, expectedRevision, sourceNote);
    void this.execute(run, fields, previous, sourceNote).catch((error) =>
      console.error('[Pipeline]', error.message),
    );
    return run;
  }
  private async execute(run: Run, fields: string[], previous: Version | null, note: string) {
    let seq = 0;
    const emit = async (event: Omit<RunEvent, 'seq' | 'time'>) => {
      const full: RunEvent = { ...event, seq: ++seq, time: new Date().toISOString() };
      await this.store.appendEvent(run.id, full);
      events.emit(run.id, full);
    };
    try {
      await emit({
        role: 'system',
        tool: 'begin_revision',
        title: previous ? 'Source correction received' : 'Building the first cut',
        detail:
          run.mode === 'openai'
            ? 'OpenAI tool-using agent · evidence stored in FalkorDB.'
            : 'Local rules mode · evidence stored in FalkorDB. No LLM call is being simulated.',
        status: 'done',
      });
      const evidence = await this.store.candidateEvidence(run.id);
      let calculation = calculate(evidence);
      let impact: Impact;
      let plan: EditorialPlan | undefined;
      if (previous) {
        const result = await editorialAgent({
          store: this.store,
          runId: run.id,
          mode: run.mode,
          fields,
          previous,
          note,
          emit,
        });
        calculation = result.calculation;
        impact = result.impact;
        plan = result.plan;
      } else {
        const graph = await this.store.graph();
        impact = {
          nodes: graph.nodes.map((n) => n.id),
          sceneIds: [...SCENE_IDS],
          paths: [],
          query: "MATCH (s:Artifact {kind:'scene'}) RETURN s.id",
        };
        await this.store.setImpact(run.id, impact);
        await emit({
          role: 'evidence',
          tool: 'seed_sources',
          title: 'Sources connected',
          detail: 'Two synthetic source sheets, four facts, two calculations, and four scenes.',
          status: 'done',
          data: impact,
        });
      }
      const drafts = buildScenes(evidence, calculation, plan);
      const scenes: Scene[] = [];
      for (const draft of drafts) {
        const old = previous?.scenes.find((s) => s.id === draft.id);
        if (old && !impact.sceneIds.includes(draft.id)) {
          // Reuse the exact file, not just equivalent content.
          await fs.access(fileForUrl(old.videoUrl));
          scenes.push({ ...old, rebuilt: false });
          await emit({
            role: 'renderer',
            tool: 'reuse_scene',
            title: 'Preserved “' + old.label + '”',
            detail: 'Same media file and content hash. No dependency on the corrected fact.',
            status: 'done',
            data: { sceneId: old.id, hash: old.footageHash },
          });
          continue;
        }
        await emit({
          role: 'renderer',
          tool: 'render_scene',
          title: 'Rendering “' + draft.label + '”',
          detail: 'Composing visuals, synthesizing narration, and synchronizing captions.',
          status: 'running',
          data: { sceneId: draft.id },
        });
        const rendered = await renderScene(draft, evidence, calculation);
        scenes.push(rendered);
        await emit({
          role: 'renderer',
          tool: 'render_scene',
          title: '“' + draft.label + '” is ready',
          detail: rendered.rebuilt
            ? 'Rendered a new MP4 with narration and burned-in captions.'
            : 'Content is unchanged; reused the cached clip.',
          status: 'done',
          data: { sceneId: draft.id, hash: rendered.footageHash },
        });
      }
      const verified = calculate(await this.store.candidateEvidence(run.id));
      const checks = [
        {
          name: 'Price arithmetic',
          passed: JSON.stringify(verified) === JSON.stringify(calculation),
          detail:
            'Independent recalculation from facts read back from FalkorDB; integer cents throughout.',
        },
        {
          name: 'Scene coverage',
          passed: scenes.length === 4 && SCENE_IDS.every((id) => scenes.some((s) => s.id === id)),
          detail: 'All four scenes appear exactly once in the final cut.',
        },
        {
          name: 'Selective rebuild',
          passed:
            !previous ||
            previous.scenes
              .filter((s) => !impact.sceneIds.includes(s.id))
              .every((old) => scenes.find((s) => s.id === old.id)?.footageHash === old.footageHash),
          detail: 'Unrelated scenes keep their original file hashes.',
        },
        {
          name: 'Factual narration',
          passed: scenes
            .filter((s) => impact.sceneIds.includes(s.id))
            .every((s) => s.narration === drafts.find((d) => d.id === s.id)?.narration),
          detail: 'Prices and recommendation use the validated factual templates.',
        },
      ];
      if (checks.some((c) => !c.passed))
        throw new Error('Verification failed. The previous video is intact.');
      await emit({
        role: 'verifier',
        tool: 'verify_cut',
        title: 'All checks passed',
        detail: 'Arithmetic, scene coverage, preserved footage, and factual narration verified.',
        status: 'done',
        data: checks,
      });
      const id = 'v' + run.revision + '-' + run.id.slice(0, 8);
      await emit({
        role: 'renderer',
        tool: 'assemble_video',
        title: 'Assembling the new cut',
        detail: 'Joining verified scenes and exporting MP4 + SRT.',
        status: 'running',
      });
      const media = await assembleVideo(id, scenes);
      const stat = await fs.stat(fileForUrl(media.videoUrl));
      if (stat.size < 1000) throw new Error('Video export failed its file-size check.');
      const version: Version = {
        id,
        revision: run.revision,
        createdAt: new Date().toISOString(),
        evidence,
        calculation,
        sourceNote: note,
        scenes,
        ...media,
        changedFields: fields,
        affectedScenes: impact.sceneIds,
        mode: run.mode,
        runId: run.id,
        checks,
      };
      await this.store.finishRun(version);
      await emit({
        role: 'system',
        tool: 'complete',
        title: 'Your new cut is ready',
        detail:
          'Version ' + run.revision + ' saved with its source evidence, trace, MP4, and captions.',
        status: 'done',
        data: { versionId: id },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.store.failRun(run.id, message);
      await emit({
        role: 'system',
        tool: 'failed',
        title: 'The edit stopped safely',
        detail: message,
        status: 'error',
      });
    } finally {
      events.emit(run.id + ':end');
    }
  }
  async seed() {
    if (!(await this.store.latest()) && !(await this.store.activeRun()))
      await this.begin(
        ORIGINAL,
        0,
        'Original synthetic product sheets: Orbit Mini includes the required adapter. Forma One is ready to use.',
      );
  }
}
