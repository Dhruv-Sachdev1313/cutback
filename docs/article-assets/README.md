# Article screenshots

These PNGs are captures of the working local application. They contain synthetic product data.

## Current upload article

The article in `docs/building-cutback.md` uses these images:

- `upload-cost-comparison.png`: actual original and revised MP4 frames showing the $79-to-$128 total change.
- `upload-start.png`: a fresh form with the bundled video and original source file selected, before analysis.
- `upload-facts.png`: the completed fresh upload's seven extracted facts and their evidence.
- `upload-falkordb.png`: the real adapter-impact query in FalkorDB Browser. This run uses fact `f3` and reaches three scenes through four paths. The article explains the extra closing-scene link.
- `upload-verdict-comparison.png`: original Orbit and revised Forma verdicts from the actual MP4s.

`upload-graph.png` is an additional screenshot of the graph inside CUTBACK.

To refresh the current images with the upload studio on port 4328 and Browser on 6398:

```sh
node scripts/upload-article-screenshots.mjs
```

The script selects the latest completed speaker-film project with an integrated export. Use `CUTBACK_PROJECT_ID` to choose a specific project. It fills the upload form without submitting it, opens a saved project, plays its existing exports, and executes a read-only Browser query. It blocks mutations to the application API and checks that the project and local spending estimate remain unchanged. No new analysis, agent plan, or render is requested.

The captures used for this revision came from a fresh upload with live OpenAI API and MCP activity. They are not from the earlier Local rules demo. If regenerating them from another run, check the article's fact ID, counts, and captions against that run.

## Earlier authored demo

The following images remain as records of the earlier interface and graph model. The current article does not use them.

- `studio.png`: the redesigned studio with the standard adapter correction applied.
- `dependency-map.png`: a preview of changing the adapter-inclusion fact, showing the affected graph paths. No revision is submitted during this capture.
- `compare-verdicts.png`: decoded frames from the original and revised MP4s.
- `studio-before-redesign.png`: the earlier interface, retained for the development story.
- `falkordb-browser.png`: the official FalkorDB Browser displaying the stored paths from the adapter-inclusion fact to the cost and verdict scenes.
- `falkordb-impact-table.png`: the same read-only traversal returned as scene names and dependency paths in the Browser's table view.

To refresh the first three images, apply the standard correction in the running app, then run:

```sh
node scripts/article-screenshots.mjs
```

The capture uses installed Chrome by default. Set `CUTBACK_URL` or `PLAYWRIGHT_CHANNEL` when needed. The mode label reflects the running backend. The original captures show Local rules mode; an OpenAI recording requires an API key and a verified agent run.

The images are referenced relatively from `../building-cutback.md`, so keep this folder alongside the article when copying it to another Markdown-based publishing workflow.

To refresh the two FalkorDB Browser screenshots with the local Docker database running:

```sh
node scripts/falkordb-screenshots.mjs
```

This uses the official Browser at `http://127.0.0.1:6388` and its internal `localhost:6379` database connection. It runs read-only queries against `cutback` and adjusts display settings in an isolated browser session. Override `FALKORDB_BROWSER_URL`, `FALKORDB_GRAPH`, or `PLAYWRIGHT_CHANNEL` if needed. The script expects the current authored 16-artifact model. These screenshots contain synthetic project data and no credentials.

For Medium, upload these PNGs at the corresponding image positions in the article and retain their captions. Relative image links do not upload files to Medium.
