import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Upload,
  ArrowRight,
  Check,
  FileText,
  Film,
  Network,
  Scissors,
  Download,
  Plus,
  X,
  Settings2,
  Loader2,
  ExternalLink,
  ChevronRight,
  Play,
  FolderOpen,
  Link2,
} from 'lucide-react';
import type { UploadProject, ImportedFact, GraphView, Provider } from '../shared/upload';
type Status = {
  session: string;
  apiConfigured: boolean;
  model: string;
  budget: { allowance: number; used: number; remaining: number };
  chatgpt: {
    connected: boolean;
    planEnabled: boolean;
    active?: string;
    accounts: { id: string; email: string; connected: boolean; planEnabled: boolean }[];
  };
  database: { connected: boolean; browser: string };
  maxSeconds: number;
};
const time = (n: number) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
const money = (n: number) => '$' + n.toFixed(2);
let token = '';
async function api<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch('/api' + url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Cutback-Session': token },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
const busyStatuses = ['extracting', 'planning', 'rendering'];
export function UploadApp() {
  const [status, setStatus] = useState<Status>();
  const [project, setProject] = useState<UploadProject>();
  const [projects, setProjects] = useState<
    { id: string; title: string; createdAt: string; status: string }[]
  >([]);
  const [showProjects, setShowProjects] = useState(false),
    [settings, setSettings] = useState(false);
  const [provider, setProvider] = useState<Provider>('api'),
    [model, setModel] = useState('gpt-6.1-sol');
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [video, setVideo] = useState<File>(),
    [sourceText, setSourceText] = useState(''),
    [factNotes, setFactNotes] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  useEffect(() => {
    if (!video) {
      setPreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(video);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [video]);
  const [sourceName, setSourceName] = useState(''),
    [error, setError] = useState(''),
    [working, setWorking] = useState(false);
  const [facts, setFacts] = useState<ImportedFact[]>([]),
    [reviewed, setReviewed] = useState(false),
    [graph, setGraph] = useState<GraphView>();
  const [selectedFact, setSelectedFact] = useState(''),
    [corrected, setCorrected] = useState(''),
    [reason, setReason] = useState('');
  const [section, setSection] = useState<'sources' | 'graph'>('sources');
  const [graphSelection, setGraphSelection] = useState('');
  const [viewStep, setViewStep] = useState(0);
  const [selectedRevision, setSelectedRevision] = useState('');
  const originalPlayer = useRef<HTMLVideoElement>(null);
  const comparisonOriginal = useRef<HTMLVideoElement>(null);
  const comparisonRevised = useRef<HTMLVideoElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [viewStep]);
  const pending = working || (!!project && busyStatuses.includes(project.status));
  const refreshStatus = useCallback(async () => {
    const s = await api<Status>('/status');
    token = s.session;
    setStatus(s);
    return s;
  }, []);
  useEffect(() => {
    void refreshStatus().catch((e) => setError(e.message));
    const params = new URLSearchParams(location.search);
    if (params.has('chatgpt_error')) {
      setError(params.get('chatgpt_error')!);
      setSettings(true);
    }
    if (params.has('chatgpt')) {
      setProvider('chatgpt');
      setSettings(true);
    }
    if (params.has('chatgpt') || params.has('chatgpt_error'))
      history.replaceState(null, '', location.pathname);
  }, [refreshStatus]);
  useEffect(() => {
    if (!project || !busyStatuses.includes(project.status)) return;
    const interval = setInterval(() => {
      void api<UploadProject>('/projects/' + project.id)
        .then((p) => {
          setProject(p);
          if (p.status === 'review') {
            setFacts(p.facts);
            setViewStep(1);
            setReviewed(false);
            void api<GraphView>('/projects/' + p.id + '/graph').then(setGraph);
          }
          if (p.status === 'plan') setViewStep(2);
          if (p.status === 'complete') {
            setViewStep(3);
            setSelectedRevision(p.revisions.at(-1)?.id || '');
          }
          if (p.status === 'failed') setError(p.error || 'This job failed.');
          if (!busyStatuses.includes(p.status)) void refreshStatus();
        })
        .catch((e) => setError(e.message));
    }, 1500);
    return () => clearInterval(interval);
  }, [project?.id, project?.status, refreshStatus]);
  useEffect(() => {
    if (provider === 'chatgpt' && status?.chatgpt.planEnabled)
      void api<{ id: string; name: string }[]>('/auth/models')
        .then((ms) => {
          setModels(ms);
          if (ms.length && !ms.some((m) => m.id === model)) setModel(ms[0].id);
        })
        .catch((e) => setError(e.message));
  }, [provider, status?.chatgpt.active, status?.chatgpt.planEnabled]);
  async function act(fn: () => Promise<void>) {
    setError('');
    setWorking(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
  async function chooseProvider(next: Provider) {
    if (project) {
      const chosenModel = next === 'api' ? 'gpt-6.1-sol' : model;
      setProject(
        await api<UploadProject>('/projects/' + project.id + '/provider', {
          provider: next,
          model: chosenModel,
        }),
      );
    }
    setProvider(next);
  }
  async function uploadAndAnalyse() {
    await act(async () => {
      let p = project;
      if (!p) {
        if (!video) throw new Error('Choose a video first.');
        if (video.size > 100 * 1024 * 1024) throw new Error('Choose a video smaller than 100 MB.');
        const r = await fetch('/api/projects', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Filename': encodeURIComponent(video.name),
            'X-Cutback-Session': token,
          },
          body: video,
        });
        const body = await r.json();
        if (!r.ok) throw new Error(body.error);
        p = body as UploadProject;
        setProject(p);
      }
      const sources = [
        sourceText ? `${sourceName || 'Supplied source material'}\n${sourceText}` : '',
        factNotes ? `Facts supplied by the uploader\n${factNotes}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      const next = await api<UploadProject>('/projects/' + p.id + '/analyse', {
        provider,
        model: provider === 'api' ? 'gpt-6.1-sol' : model,
        sourceText: sources,
      });
      setProject(next);
    });
  }
  function fresh() {
    setProject(undefined);
    setVideo(undefined);
    setSourceText('');
    setFactNotes('');
    setSourceName('');
    setFacts([]);
    setGraph(undefined);
    setCorrected('');
    setReason('');
    setSelectedFact('');
    setError('');
    setViewStep(0);
    setSelectedRevision('');
    setShowProjects(false);
    setReviewed(false);
    setSection('sources');
    setGraphSelection('');
  }
  async function openProject(id: string) {
    await act(async () => {
      const p = await api<UploadProject>('/projects/' + id);
      setProject(p);
      setProvider(p.provider);
      setModel(p.model);
      setFacts(p.facts);
      setViewStep(p.revisions.length ? 3 : p.approved ? 2 : p.facts.length ? 1 : 0);
      setSourceText(p.sourceText);
      setSelectedFact(p.correction?.factId || p.facts[0]?.id || '');
      setGraphSelection(p.correction?.factId || p.facts[0]?.id || '');
      setCorrected(p.correction?.text || '');
      setReason(p.correction?.source || '');
      setReviewed(p.approved);
      setSection('sources');
      setSelectedRevision(p.revisions.at(-1)?.id || '');
      setGraph(await api<GraphView>('/projects/' + id + '/graph'));
      setShowProjects(false);
    });
  }
  async function connect(accountId?: string) {
    await act(async () => {
      const { url } = await api<{ url: string }>('/auth/start', accountId ? { accountId } : {});
      location.assign(url);
    });
  }
  async function approve() {
    await act(async () => {
      const p = await api<UploadProject>('/projects/' + project!.id + '/approve', { facts });
      setProject(p);
      setSelectedFact(p.facts[0].id);
      setViewStep(2);
      setGraph(await api<GraphView>('/projects/' + p.id + '/graph'));
    });
  }
  async function plan() {
    await act(async () => {
      setProject(
        await api<UploadProject>('/projects/' + project!.id + '/plan', {
          factId: selectedFact,
          text: corrected,
          source: reason,
        }),
      );
    });
  }
  const selected = project?.facts.find((f) => f.id === selectedFact);
  const revision =
    project?.revisions.find((r) => r.id === selectedRevision) || project?.revisions.at(-1);
  const providerReady = provider === 'api' ? status?.apiConfigured : status?.chatgpt.planEnabled;
  const planMatchesForm =
    project?.correction?.factId === selectedFact &&
    project?.correction?.text === corrected &&
    project?.correction?.source === reason;
  const firstChanged = project?.scenes.find((s) => revision?.affectedIds.includes(s.id));
  const originalPoster = project?.scenes[0]?.frameUrl;
  const revisedPoster =
    revision?.posterUrl ||
    (revision && firstChanged
      ? `/uploads/${project!.id}/${revision.id}/${firstChanged.id}/card-0.png`
      : originalPoster);
  return (
    <div className="intake-app">
      <header className="intake-header">
        <a className="intake-brand" href="/">
          CUTBACK<span>THE EDIT BEGINS WITH EVIDENCE</span>
        </a>
        <div className="header-tools">
          <span className="connection-dot">
            <i />
            {status ? 'FalkorDB connected' : 'Connecting…'}
          </span>
          <button
            onClick={() => {
              setShowProjects(true);
              void api<typeof projects>('/projects')
                .then(setProjects)
                .catch((e) => setError(e.message));
            }}
          >
            <FolderOpen size={16} /> Projects
          </button>
          <button onClick={() => setSettings(true)}>
            <Settings2 size={16} />
            {provider === 'chatgpt'
              ? 'ChatGPT plan'
              : 'API · ' + money(status?.budget.remaining || 0) + ' left'}
          </button>
          <button className="new-project" disabled={pending} onClick={fresh}>
            <Plus size={16} /> New project
          </button>
        </div>
      </header>
      <div className="intake-container">
        <nav className="workflow" aria-label="Workflow steps">
          {['Upload & sources', 'Review the graph', 'Make a correction', 'Compare & export'].map(
            (label, i) => (
              <button
                key={label}
                className={i === viewStep ? 'current' : i < viewStep ? 'past' : ''}
                disabled={
                  pending ||
                  (i === 1 && !project?.facts.length) ||
                  (i === 2 && !project?.approved) ||
                  (i === 3 && !project?.revisions.length)
                }
                onClick={() => setViewStep(i)}
              >
                <span>{i < viewStep ? <Check size={15} /> : String(i + 1).padStart(2, '0')}</span>
                {label}
                <ChevronRight size={15} />
              </button>
            ),
          )}
        </nav>
        {error && (
          <div className="intake-error" role="alert">
            <div>
              <strong>That step couldn’t finish.</strong>
              <p>{error}</p>
            </div>
            <button aria-label="Dismiss error" onClick={() => setError('')}>
              <X size={18} />
            </button>
          </div>
        )}
        {viewStep === 0 && (
          <>
            <div className="page-heading">
              <div className="eyebrow">
                {project ? 'VIDEO RECEIVED' : 'NEW PROJECT · NO HISTORY YET'}
              </div>
              <h1>Start with the footage.</h1>
              <p>
                Upload your video and the material behind its claims. CUTBACK will connect the
                evidence to the scenes that depend on it.
              </p>
            </div>
            <div className="intake-columns">
              <section className="upload-panel">
                <div
                  className={'drop-area ' + (video || project ? 'has-file' : '')}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (!project && !pending) setVideo(e.dataTransfer.files[0]);
                  }}
                >
                  <input
                    ref={input}
                    type="file"
                    accept="video/mp4,video/quicktime,video/webm,.m4v"
                    aria-label="Choose video file"
                    disabled={pending || !!project}
                    onChange={(e) => setVideo(e.target.files?.[0])}
                  />
                  {project ? (
                    <video src={project.originalUrl} controls preload="metadata" />
                  ) : video ? (
                    <video src={previewUrl} controls preload="metadata" />
                  ) : (
                    <>
                      <div className="upload-icon">
                        <Upload size={32} />
                      </div>
                      <h2>Your video goes here</h2>
                      <p>Drag a file here, or choose it from your computer.</p>
                    </>
                  )}
                  <button
                    className="button-secondary"
                    disabled={pending || !!project}
                    onClick={() => input.current?.click()}
                  >
                    {video ? video.name : project ? project.filename : 'Choose video'}
                    {!video && !project && <ArrowRight size={16} />}
                  </button>
                  <small>MP4, MOV or WebM · up to 2 minutes · 100 MB</small>
                </div>
                <div className="what-happens">
                  <h3>What happens after upload</h3>
                  <ol>
                    <li>
                      <span>01</span>Transcribe speech locally and capture timestamped frames.
                    </li>
                    <li>
                      <span>02</span>Extract claims with links to the passages and frames.
                    </li>
                    <li>
                      <span>03</span>Build a FalkorDB graph for your review.
                    </li>
                  </ol>
                </div>
              </section>
              <section className="source-input-panel">
                <div className="panel-kicker">
                  <FileText size={18} /> THE MATERIAL BEHIND THE VIDEO
                </div>
                <h2>Where do the facts come from?</h2>
                <p>
                  Add the script, product sheet, research excerpt, or other source text you used.
                  Each extracted fact will show its origin.
                </p>
                <label>
                  Source material <span>optional</span>
                  <textarea
                    rows={6}
                    placeholder="Paste the source text here. Include a title or URL for attribution if you have one."
                    value={sourceText}
                    disabled={pending}
                    onChange={(e) => setSourceText(e.target.value)}
                    maxLength={15000}
                  />
                </label>
                <label className="attach-source">
                  <FileText size={15} />
                  {sourceName || 'Or attach a text, Markdown or CSV source'}
                  <input
                    type="file"
                    accept=".txt,.md,.csv"
                    disabled={pending}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f)
                        void act(async () => {
                          if (f.size > 50000)
                            throw new Error('Use a source file smaller than 50 KB.');
                          setSourceText((await f.text()).slice(0, 15000));
                          setSourceName(f.name);
                        });
                    }}
                  />
                </label>
                <label>
                  Facts stated in the video <span>optional</span>
                  <textarea
                    rows={3}
                    value={factNotes}
                    disabled={pending}
                    maxLength={4000}
                    onChange={(e) => setFactNotes(e.target.value)}
                    placeholder="For example: Orbit costs $79. Its required adapter is included. Forma costs $119."
                  />
                </label>
                <div className="source-explanation">
                  <Link2 size={18} />
                  <p>
                    Without supplied sources, evidence comes from the video’s own speech and frames.
                    Extraction shows what the video claims; you review whether those claims are
                    correct.
                  </p>
                </div>
                <div className="provider-choice">
                  <span>Use for analysis</span>
                  <select
                    aria-label="Analysis provider"
                    value={provider}
                    disabled={pending}
                    onChange={(e) => void act(() => chooseProvider(e.target.value as Provider))}
                  >
                    <option value="api">OpenAI API credit</option>
                    <option value="chatgpt">ChatGPT plan</option>
                  </select>
                  {provider === 'chatgpt' && status?.chatgpt.planEnabled && (
                    <select
                      aria-label="ChatGPT model"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                    >
                      {models.length ? (
                        models.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))
                      ) : (
                        <option value={model}>{model}</option>
                      )}
                    </select>
                  )}
                </div>
                {!providerReady ? (
                  <button className="button-primary" onClick={() => setSettings(true)}>
                    Connect {provider === 'chatgpt' ? 'ChatGPT' : 'OpenAI'}
                    <ArrowRight size={17} />
                  </button>
                ) : (
                  <button
                    className="button-primary"
                    disabled={pending || (!video && !project)}
                    onClick={() => void uploadAndAnalyse()}
                  >
                    {pending ? (
                      <>
                        <Loader2 size={17} className="spin" />
                        Preparing your project…
                      </>
                    ) : (
                      <>
                        Upload & analyse video
                        <ArrowRight size={17} />
                      </>
                    )}
                  </button>
                )}
                <p className="cost-note">
                  Speech transcription runs locally.{' '}
                  {provider === 'api'
                    ? `Analysis uses API credit, with ${money(status?.budget.remaining || 0)} remaining in this branch’s allowance.`
                    : 'Analysis uses your selected ChatGPT plan. No API-credit fallback.'}
                </p>
              </section>
            </div>
          </>
        )}
        {viewStep === 1 && project && (
          <>
            <div className="page-heading">
              <div className="eyebrow">SOURCE REVIEW · {project.filename}</div>
              <h1>Every claim has a starting point.</h1>
              <p>
                Check the extracted facts against their sources. These connections will decide which
                scenes change later.
              </p>
            </div>
            <div className="review-toolbar">
              <div>
                <button
                  className={section === 'sources' ? 'active' : ''}
                  onClick={() => setSection('sources')}
                >
                  <FileText size={16} /> Sources & facts
                </button>
                <button
                  className={section === 'graph' ? 'active' : ''}
                  onClick={() => setSection('graph')}
                >
                  <Network size={16} /> Dependency graph
                </button>
              </div>
              <span>
                {facts.length} facts · {project.claims.length} claims · {project.scenes.length}{' '}
                scenes
              </span>
            </div>
            {section === 'sources' ? (
              <div className="review-grid">
                <div className="fact-list">
                  {facts.map((f, i) => {
                    const e = project.evidence.find((e) => e.id === f.evidenceId)!;
                    return (
                      <article className="fact-review" key={f.id}>
                        <div className="fact-number">
                          {String(i + 1).padStart(2, '0')}
                          <span>
                            {e.kind === 'document'
                              ? 'YOUR SOURCE'
                              : e.kind === 'speech'
                                ? 'VIDEO TRANSCRIPT'
                                : 'VIDEO FRAME'}
                          </span>
                        </div>
                        <textarea
                          aria-label={'Fact ' + (i + 1)}
                          disabled={project.approved}
                          value={f.text}
                          onChange={(ev) =>
                            setFacts((old) =>
                              old.map((x) => (x.id === f.id ? { ...x, text: ev.target.value } : x)),
                            )
                          }
                        />
                        <blockquote>“{f.quote}”</blockquote>
                        <button
                          className="source-time"
                          onClick={() => {
                            if (originalPlayer.current) {
                              originalPlayer.current.currentTime = e.start;
                              void originalPlayer.current.play();
                            }
                          }}
                        >
                          {e.kind === 'document' ? <FileText size={14} /> : <Play size={14} />}{' '}
                          {e.kind === 'document'
                            ? e.sourceName
                            : `${time(e.start)} · ${e.sourceName}`}
                        </button>
                        {e.imageUrl && (
                          <a href={e.imageUrl} target="_blank" rel="noreferrer">
                            <img
                              className="source-frame"
                              src={e.imageUrl}
                              alt={'Evidence for fact ' + (i + 1)}
                            />
                          </a>
                        )}
                      </article>
                    );
                  })}
                </div>
                <aside className="review-video">
                  <video
                    ref={originalPlayer}
                    src={project.originalUrl}
                    poster={originalPoster}
                    controls
                    preload="metadata"
                  />
                  <h3>Original upload</h3>
                  <p>
                    {project.filename} · {time(project.duration)}
                  </p>
                  <details>
                    <summary>Read the timestamped transcript</summary>
                    {project.evidence
                      .filter((e) => e.kind === 'speech')
                      .map((e) => (
                        <p key={e.id}>
                          <button
                            className="source-time"
                            onClick={() => {
                              if (originalPlayer.current)
                                originalPlayer.current.currentTime = e.start;
                            }}
                          >
                            {time(e.start)}
                          </button>{' '}
                          {e.text}
                        </p>
                      ))}
                  </details>
                  {project.sourceText && (
                    <details>
                      <summary>Read supplied source material</summary>
                      <pre>{project.sourceText}</pre>
                    </details>
                  )}
                  <h3>Proposed claim connections</h3>
                  {project.claims.map((c) => (
                    <div className="claim-detail" key={c.id}>
                      <p>{c.text}</p>
                      <small>
                        {c.factIds.join(', ')} →{' '}
                        {c.sceneIds
                          .map((id) => project.scenes.find((s) => s.id === id)?.title)
                          .join(', ')}
                      </small>
                    </div>
                  ))}
                </aside>
              </div>
            ) : (
              <>
                <Graph graph={graph} selected={graphSelection} onSelect={setGraphSelection} />
                <details>
                  <summary>Inspect this project in FalkorDB Browser</summary>
                  <p>
                    Select graph <code>{'cutback_import_' + project.id.replaceAll('-', '')}</code>{' '}
                    in{' '}
                    <a href="http://localhost:6398" target="_blank" rel="noreferrer">
                      FalkorDB Browser
                    </a>
                    .
                  </p>
                  <pre>
                    {
                      'MATCH p=(s:Source)-[:CONTAINS|SUPPORTS|APPEARS_IN*1..6]->(scene:Scene)\nRETURN p'
                    }
                  </pre>
                </details>
              </>
            )}
            <div className="approve-bar">
              <label>
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                />{' '}
                I reviewed the sources and the scene connections.
              </label>
              <button
                className="button-primary"
                disabled={!reviewed || pending || project.approved}
                onClick={() => void approve()}
              >
                {project.approved ? 'Graph approved' : 'Approve graph & continue'}
                <ArrowRight size={17} />
              </button>
            </div>
          </>
        )}
        {viewStep === 2 && project && (
          <>
            <div className="page-heading">
              <div className="eyebrow">{project.title} · CORRECTION DESK</div>
              <h1>Change a fact. Follow the consequences.</h1>
              <p>
                The agent queries your graph before proposing an edit. You review its narration
                before anything is rendered.
              </p>
            </div>
            <div className="correction-layout">
              <section className="correction-form">
                <label>
                  Which fact changed?
                  <select
                    aria-label="Fact to correct"
                    value={selectedFact}
                    onChange={(e) => {
                      setSelectedFact(e.target.value);
                      setCorrected('');
                    }}
                    disabled={pending}
                  >
                    {project.facts.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.text}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="old-fact">
                  <small>IN THE ORIGINAL VIDEO</small>
                  <p>{selected?.text}</p>
                </div>
                <label>
                  Corrected fact
                  <textarea
                    rows={3}
                    placeholder="Write the accurate replacement fact."
                    value={corrected}
                    disabled={pending}
                    onChange={(e) => setCorrected(e.target.value)}
                    maxLength={450}
                  />
                </label>
                <label>
                  Source for this correction
                  <textarea
                    rows={3}
                    placeholder="Paste the supporting excerpt and say where it came from."
                    value={reason}
                    disabled={pending}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={2000}
                  />
                </label>
                <button
                  className="button-primary"
                  disabled={pending || !corrected.trim() || reason.trim().length < 8}
                  onClick={() => void plan()}
                >
                  {project.status === 'planning' ? (
                    <>
                      <Loader2 size={17} className="spin" />
                      Agent is tracing the graph…
                    </>
                  ) : (
                    <>
                      Trace impact & propose edits
                      <ArrowRight size={17} />
                    </>
                  )}
                </button>
                <p className="cost-note">
                  Uses {project.provider === 'api' ? 'API credit' : 'your ChatGPT plan'}. Each
                  export applies one correction to the original upload.
                </p>
              </section>
              <section className="impact-pane">
                {project.impact ? (
                  <>
                    <div className="panel-kicker">
                      <Network size={17} /> FALKORDB IMPACT RESULT
                    </div>
                    <h2>
                      {project.impact.sceneIds.length} of {project.scenes.length} scenes affected
                    </h2>
                    {project.impact.paths.map((p, i) => (
                      <div className="dependency-path" key={i}>
                        {p.map((part, j) => (
                          <span key={j}>
                            {j > 0 && <ArrowRight size={13} />} {part}
                          </span>
                        ))}
                      </div>
                    ))}
                    <details>
                      <summary>Inspect the Cypher query</summary>
                      <pre>{project.impact.query}</pre>
                    </details>
                  </>
                ) : (
                  <div className="awaiting-impact">
                    <Network size={40} />
                    <h2>Your graph sets the edit scope.</h2>
                    <p>
                      Select a fact and enter its correction. FalkorDB will trace the affected
                      claims and scenes.
                    </p>
                  </div>
                )}
                {project.status === 'plan' && project.edits && (
                  <div className="edit-plan">
                    <h2>Review the proposed replacements</h2>
                    {project.edits.map((e) => (
                      <article key={e.sceneId}>
                        <small>
                          {project.scenes.find((s) => s.id === e.sceneId)?.title} · VIDEO SCENE
                        </small>
                        <h3>{e.title}</h3>
                        <p>{e.narration}</p>
                        <p className="edit-reason">{e.reason}</p>
                      </article>
                    ))}
                    <p className="cost-note">
                      {project.renderProfile
                        ? 'The chart, illustration and narration use this film’s editable layouts. The opening and closing footage stay in place when they are outside the affected set.'
                        : 'Affected segments become editorial scenes with local synthetic narration. Other segments retain their uploaded footage and audio.'}
                    </p>
                    <button
                      className="button-primary"
                      disabled={pending || !planMatchesForm}
                      onClick={() =>
                        void act(async () =>
                          setProject(await api('/projects/' + project.id + '/render', {})),
                        )
                      }
                    >
                      <Scissors size={17} /> Approve plan & render video
                    </button>
                    {!planMatchesForm && (
                      <p className="cost-note">
                        The correction form has changed. Trace impact again to update this plan
                        before rendering.
                      </p>
                    )}
                  </div>
                )}
              </section>
            </div>
          </>
        )}
        {viewStep === 3 && project && revision && (
          <>
            <div className="page-heading">
              <div className="eyebrow">EXPORT READY · {project.filename}</div>
              <h1>A new cut, with a reason for every edit.</h1>
              <p>
                {revision.affectedIds.length} segments revised. {revision.preservedIds.length}{' '}
                segments keep the original footage. Your original upload is preserved.
              </p>
            </div>
            <div className="comparison-grid">
              <section>
                <div className="video-label">
                  ORIGINAL UPLOAD<span>{project.filename}</span>
                </div>
                <video
                  ref={comparisonOriginal}
                  src={project.originalUrl}
                  poster={originalPoster}
                  controls
                  preload="metadata"
                />
              </section>
              <section>
                <div className="video-label revised">
                  REVISED CUT
                  <span>
                    {revision.presentation === 'integrated'
                      ? 'Updated scenes + original footage'
                      : 'Earlier card export'}
                  </span>
                </div>
                <video
                  key={revision.id}
                  ref={comparisonRevised}
                  src={revision.videoUrl}
                  poster={revisedPoster}
                  controls
                  preload="metadata"
                />
              </section>
            </div>
            <div className="export-row">
              {firstChanged && (
                <button
                  className="button-secondary"
                  onClick={() => {
                    // Before the first changed segment, both cuts contain the same footage.
                    if (comparisonOriginal.current)
                      comparisonOriginal.current.currentTime = firstChanged.start + 0.1;
                    if (comparisonRevised.current)
                      comparisonRevised.current.currentTime = firstChanged.start + 0.1;
                  }}
                >
                  <Scissors size={17} /> Jump to first edit
                </button>
              )}
              <a className="button-primary" href={revision.videoUrl} download="cutback-revised.mp4">
                <Download size={17} /> Download revised MP4
              </a>
              <a
                className="button-secondary"
                href={revision.captionsUrl}
                download="cutback-captions.srt"
              >
                Download captions
              </a>
              <button
                className="button-secondary"
                onClick={() => {
                  setViewStep(2);
                  setCorrected('');
                  setReason('');
                }}
              >
                Make another correction
              </button>
            </div>
            {!project.renderProfile && revision.presentation !== 'integrated' && (
              <div className="receipt">
                <div>
                  <h2>Use the film’s own scenes</h2>
                  <p>
                    For the supplied speaker film, rebuild the chart and verdict in their original
                    style. This reuses your saved analysis in a separate project and costs no API
                    credit.
                  </p>
                </div>
                <button
                  className="button-primary"
                  disabled={pending}
                  onClick={() =>
                    void act(async () => {
                      const next = await api<UploadProject>(
                        '/projects/' + project.id + '/integrated',
                        {},
                      );
                      setProject(next);
                      setFacts(next.facts);
                      setSelectedFact(next.correction!.factId);
                      setCorrected(next.correction!.text);
                      setReason(next.correction!.source);
                      setGraphSelection(next.correction!.factId);
                      setReviewed(true);
                      setSelectedRevision('');
                      setViewStep(2);
                      setGraph(await api<GraphView>('/projects/' + next.id + '/graph'));
                    })
                  }
                >
                  Create in-video edit
                </button>
              </div>
            )}
            <div className="receipt">
              <div>
                <span className="eyebrow">CORRECTION RECEIPT</span>
                <h2>{revision.correction.text}</h2>
                <blockquote>{revision.correction.source}</blockquote>
              </div>
              <div>
                {project.scenes.map((s) => (
                  <p key={s.id}>
                    <span className={revision.affectedIds.includes(s.id) ? 'updated' : 'preserved'}>
                      {revision.affectedIds.includes(s.id) ? 'REVISED' : 'PRESERVED'}
                    </span>
                    {time(s.start)}–{time(s.end)} · {s.title}
                  </p>
                ))}
              </div>
            </div>
            {project.revisions.length > 1 && (
              <details className="revision-history">
                <summary>Earlier exports in this project ({project.revisions.length})</summary>
                {project.revisions.map((r, i) => (
                  <button key={r.id} onClick={() => setSelectedRevision(r.id)}>
                    Cut {i + 1} · {r.correction.text}
                  </button>
                ))}
              </details>
            )}
          </>
        )}
        {project && project.events.length > 0 && (
          <details className="activity-log" open={pending}>
            <summary>
              <span>
                {pending ? <Loader2 size={16} className="spin" /> : <Check size={16} />}{' '}
                {pending ? 'Working on your video' : 'Project activity'}
              </span>
              <small>{project.events.length} events</small>
            </summary>
            <ol>
              {project.events.map((e, i) => (
                <li key={i}>
                  <time>{new Date(e.at).toLocaleTimeString()}</time>
                  <code>{e.tool}</code>
                  <span>{e.detail}</span>
                </li>
              ))}
            </ol>
          </details>
        )}
        <footer className="intake-footer">
          <span>CUTBACK / VIDEO INTAKE</span>
          <span>Each project has its own graph and revision history.</span>
          <a href="http://localhost:6398" target="_blank" rel="noreferrer">
            Open FalkorDB Browser
            <ExternalLink size={13} />
          </a>
        </footer>
      </div>
      {settings && (
        <div className="modal-shade">
          <section
            className="connection-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Model connection"
          >
            <button
              className="dialog-close"
              aria-label="Close settings"
              onClick={() => setSettings(false)}
            >
              <X />
            </button>
            <div className="eyebrow">MODEL CONNECTION</div>
            <h2>Choose how to run the agent.</h2>
            {error && (
              <div className="intake-error" role="alert">
                {error}
              </div>
            )}
            <p>
              Video transcription and rendering happen locally. The model extracts claims and plans
              corrections.
            </p>
            <div className="connection-card">
              <h3>ChatGPT plan</h3>
              <p>
                Connect an eligible account using the official sign-in flow. Your tokens stay on
                this computer.
              </p>
              {status?.chatgpt.accounts.map((a) => (
                <div className="account-row" key={a.id}>
                  <div>
                    <strong>{a.email}</strong>
                    <small>
                      {a.id.slice(-8)} ·{' '}
                      {a.connected
                        ? a.planEnabled
                          ? 'Plan usage enabled'
                          : 'Plan usage not enabled'
                        : 'Signed out'}
                    </small>
                  </div>
                  <button
                    disabled={working}
                    onClick={() =>
                      a.connected
                        ? void act(async () => {
                            await api('/auth/select', { accountId: a.id });
                            await chooseProvider('chatgpt');
                            await refreshStatus();
                          })
                        : void connect(a.id)
                    }
                  >
                    {a.id === status.chatgpt.active && a.connected ? 'Selected' : 'Use account'}
                  </button>
                  {a.connected && !a.planEnabled && (
                    <button onClick={() => void connect(a.id)}>Enable plan usage</button>
                  )}
                </div>
              ))}
              <button className="chatgpt-button" disabled={working} onClick={() => void connect()}>
                Continue with ChatGPT
                <ArrowRight size={16} />
              </button>
              {status?.chatgpt.connected && (
                <button
                  className="text-action"
                  onClick={() =>
                    void act(async () => {
                      const r = await api<{ revoked: boolean }>('/auth/disconnect', {});
                      await refreshStatus();
                      if (!r.revoked)
                        setError(
                          'Signed out locally. Remote revocation was not confirmed; disconnect CUTBACK in ChatGPT settings.',
                        );
                    })
                  }
                >
                  Disconnect selected account
                </button>
              )}
              <a
                className="text-action"
                href="https://chatgpt.com/settings/usage"
                target="_blank"
                rel="noreferrer"
              >
                Manage ChatGPT app usage
              </a>
            </div>
            <div className="connection-card">
              <h3>OpenAI API credit</h3>
              <p>
                {status?.apiConfigured
                  ? 'Your API key is configured on the server.'
                  : 'Add OPENAI_API_KEY to .env.upload and restart this branch.'}
              </p>
              <div className="budget-row">
                <strong>{money(status?.budget.remaining || 0)}</strong>
                <span>
                  remaining of {money(status?.budget.allowance || 0)} local allowance
                  <br />
                  Conservative usage estimate; provider billing is authoritative.
                </span>
              </div>
              <button
                className="button-secondary"
                disabled={!status?.apiConfigured || pending}
                onClick={() =>
                  void act(async () => {
                    await chooseProvider('api');
                    setSettings(false);
                  })
                }
              >
                Use API credit · GPT-6.1 Sol
              </button>
            </div>
            <p className="cost-note">
              A ChatGPT failure will not switch to paid API requests automatically.
            </p>
          </section>
        </div>
      )}
      {showProjects && (
        <div className="modal-shade">
          <section
            className="connection-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Projects"
          >
            <button
              className="dialog-close"
              aria-label="Close projects"
              onClick={() => setShowProjects(false)}
            >
              <X />
            </button>
            <div className="eyebrow">YOUR UPLOADS</div>
            <h2>Projects</h2>
            <button className="button-primary" disabled={pending} onClick={fresh}>
              <Plus size={16} /> Start a new project
            </button>
            {projects.length ? (
              projects.map((p) => (
                <button className="project-row" key={p.id} onClick={() => void openProject(p.id)}>
                  <Film size={20} />
                  <span>
                    <strong>{p.title}</strong>
                    <small>
                      {new Date(p.createdAt).toLocaleString()} · {p.status}
                    </small>
                  </span>
                  <ArrowRight size={16} />
                </button>
              ))
            ) : (
              <p>No uploaded projects yet. Your first upload starts with an empty history.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function Graph({
  graph,
  selected,
  onSelect,
}: {
  graph?: GraphView;
  selected: string;
  onSelect: (id: string) => void;
}) {
  if (!graph) return <p>Loading the graph from FalkorDB…</p>;
  const kinds = ['source', 'evidence', 'fact', 'claim', 'scene'];
  const positions = new Map<string, { x: number; y: number }>();
  let rows = 1;
  for (const [column, kind] of kinds.entries()) {
    const nodes = graph.nodes
      .filter((n) => n.kind === kind)
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    rows = Math.max(rows, nodes.length);
    nodes.forEach((n, i) => positions.set(n.id, { x: column * 240 + 10, y: 80 + i * 85 }));
  }
  const height = Math.max(410, rows * 85 + 110);
  const reach = (backward: boolean) => {
    const visited = new Set<string>(selected ? [selected] : []);
    let added = true;
    while (added) {
      added = false;
      for (const edge of graph.edges) {
        const from = backward ? edge.to : edge.from;
        const to = backward ? edge.from : edge.to;
        if (visited.has(from) && !visited.has(to)) {
          visited.add(to);
          added = true;
        }
      }
    }
    return visited;
  };
  const ancestors = reach(true),
    descendants = reach(false);
  return (
    <div className="graph-scroll">
      <svg
        viewBox={`0 0 1200 ${height}`}
        role="img"
        aria-label="Uploaded sources connect to timestamped evidence, facts, claims and scenes"
      >
        <defs>
          <marker id="graph-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0 0L6 3L0 6" fill="#999e90" />
          </marker>
        </defs>
        {kinds.map((k, i) => (
          <text className="column-label" key={k} x={i * 240 + 10} y={35}>
            {k.toUpperCase()}
          </text>
        ))}
        {graph.edges.map((e, i) => {
          const a = positions.get(e.from),
            b = positions.get(e.to);
          return a && b ? (
            <path
              key={i}
              d={`M ${a.x + 206} ${a.y + 27} C ${a.x + 225} ${a.y + 27}, ${b.x - 22} ${b.y + 27}, ${b.x - 7} ${b.y + 27}`}
              className={
                descendants.has(e.from) || ancestors.has(e.to)
                  ? 'graph-edge highlighted'
                  : 'graph-edge'
              }
              markerEnd="url(#graph-arrow)"
            />
          ) : null;
        })}
        {graph.nodes.map((n) => {
          const p = positions.get(n.id);
          if (!p) return null;
          const title = n.title.length > 62 ? n.title.slice(0, 59) + '…' : n.title;
          const words = title.split(' ');
          let lines = [''];
          for (const word of words) {
            if ((lines.at(-1)! + ' ' + word).length > 29) lines.push('');
            lines[lines.length - 1] += (lines.at(-1) ? ' ' : '') + word;
          }
          return (
            <g
              key={n.id}
              tabIndex={0}
              role="button"
              aria-label={n.kind + ': ' + n.title}
              onClick={() => onSelect(n.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSelect(n.id);
              }}
              className={'graph-node ' + n.kind + (selected === n.id ? ' selected' : '')}
            >
              <title>{n.title}</title>
              <rect x={p.x} y={p.y} width={206} height={64} rx={3} />
              {lines.slice(0, 3).map((l, i) => (
                <text key={i} x={p.x + 10} y={p.y + 18 + i * 17}>
                  {l}
                </text>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
