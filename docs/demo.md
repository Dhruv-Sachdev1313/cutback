# Recording the working demo

Suggested length: 75–100 seconds. Use the built app at `http://localhost:4318` and a 1440×1000 browser window. The actual rendered films are downloadable MP4s with narration.

## Before recording

1. Set `OPENAI_API_KEY` locally in `.env` and `AGENT_MODE=openai`; restart the API. Confirm the studio badge says **OpenAI agent**. Do not show the `.env` contents in the recording.
2. If you already applied the correction, use **Restore original source values**, then rebuild. History is preserved.
3. Open the original cut or the restored original-price cut. The demo products are explicitly fictional.

## Storyboard

| Time   | On screen                                                                                          | Suggested narration                                                                                                        |
| ------ | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 0–10s  | Play the original verdict scene: Orbit is $40 cheaper.                                             | “This video has a conclusion. Every claim is connected to its evidence.”                                                   |
| 10–22s | Load the correction. Adapter inclusion turns off; its $49 price stays visible.                     | “One correction: the required adapter was never included. Which parts of the video are now wrong?”                         |
| 22–35s | Open Evidence. Follow the highlighted fact → total → claim → scene paths. Expand the Cypher query. | “FalkorDB identifies the affected scenes. The opening and closing do not depend on this fact.”                             |
| 35–55s | Rebuild. Show real MCP tool calls and the render progress.                                         | “The agent checks the graph, recalculates the prices, reads the affected scenes, and submits a verified edit plan.”        |
| 55–75s | Revised verdict: Forma is $9 cheaper. Open Compare cuts.                                           | “The conclusion reverses. The chart, narration, and captions change together. The original cut still exists.”              |
| 75–90s | Open the scene’s evidence receipt, then History.                                                   | “We can explain every change and inspect the sources for every version. This is CUTBACK: video that follows the evidence.” |

Rendering/model latency depends on hardware and API response time. If you shorten a long wait, label the cut in the recording; the workflow itself must be real.

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
