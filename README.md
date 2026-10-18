# CUTBACK

Upload a video and its source material. When a fact changes, CUTBACK follows an evidence graph to find the scenes that depend on it, proposes replacement narration, and exports a corrected video.

**Graph Hacks track: Agents That Act on Connected Data (Track 1).**

Branch `feat/video-intake-chatgpt` opens on an empty project. There is no preloaded graph or generated video. Previous uploads live behind **Projects**, with separate graphs and histories. The [earlier authored demo](docs/authored-demo.md) remains available separately.

## Run locally

Requirements: Node.js 22.12+, Docker, [uv](https://docs.astral.sh/uv/), and local speech synthesis (`say` on macOS or `espeak-ng` on Linux). FFmpeg and FFprobe come with npm dependencies. The upload setup has been tested natively on macOS; it does not use the older app's Docker image.

```sh
npm ci
cp .env.upload.example .env.upload
npm run upload:db
npm run upload:setup-transcription
npm run upload:build
npm run upload:start
```

Open **http://127.0.0.1:4328**. Set `OPENAI_API_KEY` in `.env.upload` before starting for API mode, or use **Continue with ChatGPT** in connection settings. The first transcription downloads Whisper `base.en`; later uploads reuse the local model.

| Component        | Upload branch      | Original authored demo |
| ---------------- | ------------------ | ---------------------- |
| App              | 4328               | 4318                   |
| FalkorDB         | 6397               | 6387                   |
| FalkorDB Browser | 6398               | 6388                   |
| Compose project  | `cutback-upload`   | `cutback`              |
| Local data       | `.cutback-upload/` | `.cutback/`            |
| Environment file | `.env.upload`      | `.env`                 |

The upload app refuses the original demo's app and database ports. It has its own Docker volume. Starting it does not require stopping the original demo.

## Try a complete project

1. Choose **New project** and upload [`demo-kit/speaker-comparison.mp4`](demo-kit/speaker-comparison.mp4).
2. Attach [`demo-kit/original-sources.txt`](demo-kit/original-sources.txt). These synthetic product sheets match the original film. Do not supply the correction yet.
3. Choose **Upload & analyse video**. Local transcription produces timestamps; the model receives speech, sampled frames, and your source text. It proposes facts and dependencies.
4. Check the quoted passages and scene connections. Open **Dependency graph**, then approve the graph after reviewing it.
5. Select the fact saying Orbit's required adapter is included. Enter: **Orbit Mini's required power adapter is not included in its $79 speaker price. It must be bought separately for $49.** Paste [`demo-kit/correction-source.txt`](demo-kit/correction-source.txt) into the correction source field.
6. Choose **Trace impact & propose edits**. Check the graph paths and narration: Orbit now costs $128; Forma remains $119, making it $9 cheaper on upfront cost.
7. Choose **Approve plan & render video**, then **Jump to first correction**. Compare the cuts and download the MP4 and SRT captions.

The checked live run extracted six facts, six claims, and three segments. It revised two segments and preserved one. Fresh model runs can produce different wording and counts; review the actual result.

Affected segments become labelled **correction cards with synthetic narration**. Unaffected segments retain their uploaded footage and audio, normalized for export. CUTBACK does not alter a filmed speaker's lips or voice. Each export applies one correction to the original upload; corrections are not cumulative.

[Detailed walkthrough, FalkorDB Browser queries, and two-minute recording script](docs/upload-workflow.md).

## FalkorDB and the agent

```text
Source ─CONTAINS→ Evidence ─SUPPORTS→ Fact ─SUPPORTS→ Claim ─APPEARS_IN→ Scene
Correction ─CORRECTS→ Fact
Revision ─APPLIES→ Correction
Revision ─REBUILDS→ Scene
```

Every upload has its own graph: `cutback_import_<project UUID without hyphens>`. The `cutback_upload_index` graph lists projects. Project records, evidence, dependencies, corrections, and export receipts persist in FalkorDB. The filesystem holds media, the spending estimate, and private sign-in credentials.

The agent's `trace_impact` tool runs a parameterized traversal:

```cypher
MATCH p=(f:Fact {id:$factId})-[:SUPPORTS|APPEARS_IN*1..4]->(s:Scene)
RETURN s.id AS id, [n IN nodes(p) | n.title] AS path
```

The returned scene IDs are the allowed edit scope. The server rejects plans that omit an affected scene or add an unrelated one. It queries the graph again before rendering. Changing an edge changes the permitted edit set; the graph is not a display of an independently chosen list.

The agent discovers `trace_impact`, `read_affected_scenes`, `calculate`, and `submit_edit_plan` through a real MCP client/server connection with in-process transport. Numeric comparisons use the calculator. Arbitrary replacement prose still needs human review; this branch does not claim the earlier template's deterministic factual compiler for arbitrary uploads.

Sources come from timestamped speech, sampled frames, and supplied text. Speech and document quotations must match an actual passage. Frame readings and dependency links need human review. A citation establishes where a claim came from, not whether it is true. TXT, Markdown, and CSV files are supported. URLs are attribution only; the app does not fetch them or ingest PDFs. Use public, synthetic, or your own permitted material. The included film and product sheets are fictional demo assets.

## API credit and ChatGPT

API mode uses GPT-6.1 Sol, a 6,000-output-token limit per request, and at most five model turns for a correction plan. Transcription, narration, and rendering run locally. There are no automatic model retries. Only analysis and planning call the model; browsing, approval, playback, and rendering do not.

`UPLOAD_API_BUDGET_USD=1.00` sets a local allowance, persisted across restarts. The app reserves a conservative estimate before a request, then accounts for reported usage. Failed requests retain their reservation when usage is unknown. This is an application guard, not an account balance or guaranteed billing cap. Provider billing is authoritative. The verified upload and correction test recorded an estimate of about **$0.04**; other inputs can cost more.

The ChatGPT option implements the official [Sign in with ChatGPT flow for open-source apps](https://developers.openai.com/siwc/token-sharing-open-source/sign-in): loopback OAuth, PKCE, state and signed ID-token checks, saved registrations, serialized token refresh, model discovery, and streaming Responses requests. Tokens stay in `.cutback-upload/chatgpt-credentials.json` with owner-only permissions. They are never sent to the frontend or committed.

An eligible account must grant plan usage. A subscription error stops the job and never falls back to API credit. OAuth and request handling have automated fixture tests. Live subscription inference still requires the user's sign-in and account eligibility; the completed end-to-end demo was verified using API credit.

## Verification

```sh
npm test                          # Unit tests; model and OAuth responses mocked
npm run test:upload-integration    # Real isolated FalkorDB + MCP; no paid inference
npm run upload:build              # TypeScript + production frontend
npm run test:upload-browser        # Running upload app; read-only UI checks
```

The integration test is restricted to port 6397 and deletes only its uniquely named fixtures. The browser check opens an existing completed project if available, then verifies that **New project** clears the interface. It never starts analysis or rendering. The older `test:browser` script creates revisions in the authored demo; use `test:upload-browser` here.

| Files                                            | Responsibility                                     |
| ------------------------------------------------ | -------------------------------------------------- |
| `server/upload/index.ts`, `config.ts`            | Isolated local API, upload limits, request checks  |
| `server/upload/store.ts`                         | Graph creation, impact traversal, receipts         |
| `server/upload/pipeline.ts`, `schema.ts`         | Extraction review, MCP loop, edit scope validation |
| `server/upload/media.ts`                         | Segments, frames, speech, MP4 and captions         |
| `server/upload/auth.ts`, `model.ts`, `budget.ts` | OAuth, model requests, spending allowance          |
| `src/UploadApp.tsx`, `src/upload.css`            | Upload, evidence review, correction and comparison |
| `scripts/transcribe-local.py`                    | Local English transcription                        |
| `demo-kit/`                                      | Synthetic film and source sheets                   |

Current scope: local single-user app, English speech, videos of 2–120 seconds and at most 100 MB. Scene boundaries and dependency extraction are approximate. Caption timing is estimated within segments. There is no frame-perfect editing. A restart interrupts active jobs and preserves completed exports. Refresh the page afterwards; restart ChatGPT sign-in if it was interrupted.
