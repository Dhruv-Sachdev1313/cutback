# CUTBACK

**A finished video that revises its argument when its evidence changes.**

Change a source fact. An agent follows the dependency graph, recalculates the comparison, identifies affected scenes, and produces a revised video with narration, charts, and captions. Every version keeps its original evidence and tool trace.

**Graph Hacks submission track: Agents That Act on Connected Data (Track 1).**

## The working demo

The film compares two fictional speakers. Orbit Mini originally costs **$79**, including its required adapter. Forma One costs **$119**, complete. The original video recommends Orbit on upfront cost.

Correct one fact: Orbit's adapter is actually sold separately for **$49**. Its complete cost becomes **$128**. The agent traces the consequences and revises the conclusion: Forma now costs **$9 less**.

Only the cost and verdict scenes change. The opening and closing reuse their exact original media files. The studio includes the source editor, interactive evidence map, live tool trace, before/after player, evidence receipts, immutable version history, MP4 export, and SRT captions.

Try an adapter price of **$40** for a tie or **$20** to keep Orbit cheaper. The result is calculated from your input.

## Run locally

Requirements: **Node.js 22.12+**, **Docker**, and speech support (`say` on macOS, `espeak-ng` on Linux). FFmpeg is installed with npm dependencies. Fonts and illustrations are bundled locally.

```sh
cp .env.example .env
npm ci
npm run db:up
npm run dev
```

Open **http://localhost:4317**. The first cut renders automatically. FalkorDB's browser is available at **http://localhost:6388**; the database port is **6387**.

To run the built app on a single port:

```sh
npm run build
npm start
```

Open **http://localhost:4318**.

### OpenAI agent

Add your key to the ignored `.env` file, then restart the API:

```dotenv
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-6-astra
AGENT_MODE=openai
```

The UI should say **OpenAI agent**. Model choice is configurable for your API account. The backend uses the Responses API; no key is sent to the browser. OpenAI errors are shown as failed runs and preserve the prior cut.

Default `AGENT_MODE=auto` uses OpenAI when a key exists; otherwise the UI explicitly reports **Local rules mode**. Local mode runs real MCP, FalkorDB queries, speech synthesis, and FFmpeg rendering with a deterministic editorial plan. It is not an LLM simulation. Use `AGENT_MODE=openai` for an AI-agent submission recording.

Speech is local by default. For OpenAI-generated narration:

```dotenv
TTS_PROVIDER=openai
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE=coral
```

Narration is synthetic in either mode.

### Entire application in Docker

```sh
cp .env.example .env
# Add your API key to .env if using OpenAI.
docker compose --profile full up --build -d
```

Open **http://localhost:4318**. The image includes FFmpeg, Linux speech synthesis, and fonts. The app and database retain their data in named volumes. This is also the recommended local setup on Windows. The containers bind to loopback on the host.

The Docker app uses a separate graph (`cutback_docker`) because its rendered media lives in a separate volume. Native and Docker runs each keep their own history. Override `CUTBACK_DOCKER_GRAPH` only with a matching media volume.

Stop without deleting history:

```sh
docker compose --profile full stop
```

## Why FalkorDB is central

```text
Source → Fact → Calculation → Claim → Scene → Rendered assets
```

The editorial tools read candidate facts and traverse dependency paths directly in FalkorDB. The graph determines the set of scenes allowed in the edit plan. The application cannot analyze or publish a revision without the graph; the media directory only caches generated assets.

The key traversal:

```cypher
MATCH p=(f:Artifact)-[:FEEDS*1..8]->(a:Artifact)
WHERE f.id IN $factIds
RETURN DISTINCT a.id AS id, a.kind AS kind,
  [n IN nodes(p) | n.id] AS pathIds,
  [n IN nodes(p) | n.title] AS pathTitles
```

- [Complete graph model](docs/graph-model.md)
- [Essential Cypher queries](docs/queries.cypher)
- [Queries for the FalkorDB Browser demonstration](docs/falkordb-browser.cypher)
- [Architecture and scope](docs/architecture.md)
- [Recording script and demo challenge](docs/demo.md)
- [Build story with screenshots and debugging notes](docs/building-cutback.md)

## Agent and MCP tools

The OpenAI agent discovers and calls `trace_impact`, `calculate_costs`, `read_scene`, and `submit_edit_plan` through an MCP client/server pair. Its plan must match both the graph traversal and deterministic arithmetic. A factual compiler fills the selected narration and visual templates with verified figures. The agent cannot introduce unsupported product-performance claims.

For an external MCP client, run:

```sh
npm run mcp
```

Stdio server configuration example (replace the absolute project path):

```json
{
  "mcpServers": {
    "cutback": {
      "command": "node",
      "args": ["--import", "tsx", "server/mcp.ts"],
      "cwd": "/absolute/path/to/cutback"
    }
  }
}
```

Exposed tools: `get_current_cut`, `trace_source_change`, `get_scene_provenance`, `apply_source_correction`. The application API must be running for the mutation tool.

## Verification

```sh
npm test                 # Arithmetic, tie handling, plan constraints, captions, real MCP transport
npm run test:integration # Real FalkorDB traversal, changed-edge behavior, concurrent revision locking
npm run build            # TypeScript + production frontend build
npm run test:browser     # Running app required; Chrome by default
```

Browser QA performs the real correction workflow and verifies the new winner, generated media hashes, comparison playback, history, and mobile layout. It saves screenshots and a JSON report to ignored `artifacts/`. It creates real revisions in the local demo project.

If Chrome is unavailable, install Playwright's Chromium and choose it using `PLAYWRIGHT_CHANNEL=chromium npm run test:browser`.

To record the real UI workflow and export both narrated films, see the [recording guide](docs/demo.md). The recorder creates actual revisions and labels the configured editorial mode.

## Project layout

```text
src/                    React studio and responsive UI
shared/                 Shared API types
server/agent.ts         OpenAI editorial tool loop
server/tool-session.ts  MCP discovery and per-revision tool transport
server/store.ts         FalkorDB queries, versioning, revision locks
server/graph-model.ts   Dependency topology and traversal queries
server/story.ts         Source validation, arithmetic, factual script compiler
server/visuals.ts       Original SVG scene illustrations
server/render.ts        Narration, content-addressed clips, MP4 + SRT export
server/pipeline.ts      Workflow, verification, progress events, publication
server/mcp.ts           External stdio MCP server
docs/                  Architecture, graph model, Cypher, recording guide
examples/               Synthetic source fixtures (USD cents)
tests/                  Unit and real-database tests
.cutback/media/         Generated files; ignored by Git
```

## Deliberate scope

This is a local, single-project prototype with one authored comparison template and structured evidence fields. It does not ingest arbitrary films or documents. The first cut is authored; corrections use the configured editorial mode. Caption timing is estimated per cue, not word-aligned. Unfinished runs are marked failed after a server restart; the last published cut remains available.

All products, source sheets, and prices are synthetic. Illustrations are original SVG assets. Fonts use their bundled open-source licenses. No personal, login-protected, or restricted source data is loaded.

The Git repository is local until you choose a remote and publish it. The hackathon submission also needs your working demo video link and your own review and understanding of the implementation.
