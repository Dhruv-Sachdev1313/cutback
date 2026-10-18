# Recording the working demo

Target length: two minutes, including clicks and a few seconds of playback. Use the built app at `http://localhost:4318` and a 1440×1000 browser window. The actual rendered films are downloadable MP4s with narration.

## Before recording

1. Configure OpenAI locally using the settings below, restart the API, and confirm the studio badge says **OpenAI agent**. Do not show the `.env` contents in the recording. Complete one real revision before filming; the badge alone does not verify model access.
2. If you already applied the correction, use **Restore original source values**, then **Rebuild affected scenes**. History is preserved. This is another agent run when OpenAI mode is enabled.
3. Open the restored original-price cut. Confirm Orbit is $79, Forma is $119, and the adapter is marked included. The demo products are fictional.
4. Open FalkorDB Browser in a second tab, connect, and prepare query 2 from [falkordb-browser.cypher](falkordb-browser.cypher). Complete login and graph layout before recording; connection details are below.
5. Rehearse with a stopwatch. Start rebuilding at about 30 seconds and show the database while the model and renderer work. If processing exceeds that segment, shorten the wait in the recording and label it. Keep the correction, tool results, and final playback from the same real run.
6. Mute the app while speaking. Briefly let the revised verdict play with sound so viewers can hear the changed narration.

## Two-minute script

Read only the quoted paragraphs. The timings allow room for the actions and short playback; adjust them after a real rehearsal.

### 0:00–0:15 — The problem

Show the studio with the original verdict selected.

> I built CUTBACK for a problem that appears after a video is finished: one of its facts changes. Now someone has to find every scene that relied on it.

### 0:15–0:32 — Make the correction

Show the prices, click **Load the correction**, then **Rebuild affected scenes**. The adapter price stays $49 while its inclusion switch turns off.

> This demo compares two fictional speakers. Orbit costs seventy-nine dollars; Forma costs one-nineteen. The original video recommends Orbit. But I discover that Orbit’s required forty-nine-dollar adapter is sold separately. I’ll apply that correction.

### 0:32–1:00 — Show FalkorDB doing the work

Switch to the prepared FalkorDB Browser tab. Run the query and point along the two branches to the cost and verdict scenes. Keep labels readable.

> Here’s FalkorDB Browser, connected to the same database. I model facts, calculations, claims, and scenes as artifacts, linked by directed FEEDS relationships. This Cypher query follows up to eight relationship hops from the corrected fact. It reaches the cost scene and the verdict, and returns the paths that explain why.

### 1:00–1:22 — Explain the agent

Return to CUTBACK and show its MCP tool trace. Point to the graph, calculation, scene-reading, and plan-submission calls. Calls may appear in a different order.

> Back in CUTBACK, the OpenAI agent uses MCP tools to inspect those dependencies, recalculate the costs, and read the affected scenes. My server checks its edit plan against the graph and the arithmetic before anything renders.

### 1:22–1:45 — Show the reversal

Open **Compare cuts**, compare the verdicts, then briefly play the revised verdict with audio. Show the two preserved scenes in the timeline.

> Orbit now costs one-twenty-eight. Forma stays at one-nineteen, so the recommendation reverses. The revised video has updated visuals, narration, and captions. The opening and closing reuse their original media files.

### 1:45–2:00 — Show the evidence and history

Close the comparison, open the verdict’s evidence, then **History**. End on the revised cut if there is time.

> I can still open the original cut and inspect the evidence behind each version. One corrected fact has changed the argument of a finished video, with a traceable reason for every edit.

## Model settings and a small demo budget

For the existing API-key integration, add these settings to the ignored `.env` file and restart the API:

```dotenv
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-6.1-sol
AGENT_MODE=openai
TTS_PROVIDER=local
```

Start with a **$5 API budget** for rehearsal and recording. This is a suggested starting amount, not a measured cost or a guarantee of a particular number of runs. Local speech synthesis and FFmpeg do not incur OpenAI audio or video generation charges.

Prices checked October 18, 2026: [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol) costs $2 per million input tokens and $10 per million output tokens at standard short-context rates. CUTBACK currently defaults to [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra), at $10 input and $50 output per million tokens.

For illustration, a complete revision using 20,000 input tokens and 5,000 output tokens **summed across all model calls** would cost about **$0.09 on Sol** or **$0.45 on Astra**, before cache pricing differences. These token counts are assumptions; output includes billable reasoning. The loop permits up to 12 model turns with a 4,000-output-token cap per turn, so actual usage can exceed this example. Verify one successful run and its API usage before recording. Sol supports the required Responses tool calls, but this recommendation has not yet been verified with a live CUTBACK API run.

### Using a ChatGPT subscription

CUTBACK currently requires an API key for its OpenAI agent. A Codex login does not configure the application automatically.

OpenAI now documents [Sign in with ChatGPT for eligible Plus and Pro users in open-source apps](https://developers.openai.com/siwc/quickstart). That could support a subscription-backed integration. CUTBACK does not implement that OAuth flow, and its Responses request handling would also need changes for the [preview requirements](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations), including streaming and supported request fields. The API-key route is the smaller change for this recording.

## Technical points to understand before recording

- **The model:** the dependency nodes have the `Artifact` label. Their `kind` property distinguishes facts, calculations, claims, and scenes. `FEEDS` points from an input to something that depends on it. The prototype uses an authored graph; it does not automatically discover dependencies in arbitrary uploaded videos.
- **The query:** `*1..8` traverses between one and eight directed relationships. `RETURN p` returns the path, including its intermediate nodes, so the result explains the dependency. It is not a shortest-path query. In this model the adapter correction reaches two scenes through six unique nodes and five relationships.
- **The database’s role:** FalkorDB determines the affected scene set and stores version/provenance state. Arithmetic runs in application code using integer cents. The agent’s proposed scene set and verdict must pass server-side checks before rendering.
- **The agent’s role:** OpenAI discovers four tools through the in-process MCP client/server pair: `trace_impact`, `calculate_costs`, `read_scene`, and `submit_edit_plan`. The tools query or validate real state. The renderer uses verified figures in narration and visual templates.
- **The client:** FalkorDB Browser is the database UI shown in the recording. The backend separately uses the `falkordb` JavaScript package in [server/store.ts](../server/store.ts): `FalkorDB.connect`, `selectGraph`, and parameterized `query` calls. Keep that file open as a backup if a judge asks about integration; it need not consume the two-minute demo.
- **The saved media:** unchanged scenes reuse the same files. Changed scenes are rendered again, then assembled into a new MP4. A failed run leaves the previous published cut active.

## Repeatable screen recording

With the built app running on port 4318 and Chrome installed:

```sh
npm exec playwright install ffmpeg
npm run demo:record
```

The recorder restores the original source values, performs the correction through the actual browser interface, and creates real revisions. It saves:

- `artifacts/cutback-walkthrough.mp4`: a silent screen recording for your voiceover.
- `artifacts/original-cut.mp4`: the original film with synthetic narration.
- `artifacts/revised-cut.mp4`: the revised film with synthetic narration.

The recording keeps the app's visible mode label. Without an API key it demonstrates **Local rules mode**; record again with OpenAI enabled for the agent submission. Generated recordings and media are ignored by Git. Use `CUTBACK_URL` to select a different running server.

## A useful live challenge

Change the adapter price to **$40** while it is excluded: both products cost $119, and the result must be a tie. Change it to **$20**: Orbit is still cheaper. These inputs show that the conclusion is calculated, not a scripted switch to Forma.

## Showing the database in FalkorDB Browser

Add a short database segment after the correction preview, or record it separately for the article:

1. Run `docker compose up -d falkordb` if needed, then open **http://localhost:6388**.
2. In **Manual Configuration**, enter host `localhost` and port `6379`. Leave username and password empty for this local Compose setup, then select **Log in**. The Browser and database share a container; native clients outside it use port `6387`.
3. Skip the tutorial if it appears, and select the **cutback** graph. The optional full Docker application uses **cutback_docker** instead.
4. Run query 2 from [falkordb-browser.cypher](falkordb-browser.cypher). Show the two paths through the calculation and claims to the cost and verdict scenes.
5. Run query 3 and select **Table** to show `02 · The real cost` and `03 · The verdict` with their dependency paths.

Suggested narration: “This is the same database the editing tools query. Starting at the corrected fact reaches these two scenes. The opening and closing have no dependency on that price.”

The current model returns six unique nodes and five relationships for this correction. Choose **Tree → Left → Right** from the layout selector and use **Zoom in** to make the graph labels readable. These display choices do not change the graph model.

Query 1 shows all 16 authored artifacts, and query 4 shows the stored video versions. All four queries are read-only. A reproducible screenshot capture is available with `node scripts/falkordb-screenshots.mjs`.

## Submission material

- Track: **Agents That Act on Connected Data (Track 1)**.
- Public repository: publish this Git repository to your chosen host.
- README includes setup and scope; `docs/graph-model.md` describes the data model.
- `docs/queries.cypher` contains the essential Cypher queries.
- Record the actual agent-backed browser flow and include the video link.
- Complete local deployment is supported with Docker Compose, so a hosted service is optional.
