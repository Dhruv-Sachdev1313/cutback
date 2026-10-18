# Record CUTBACK from an empty project

Use **http://127.0.0.1:4328** on branch `feat/video-intake-chatgpt`. Your original demo stays at **http://localhost:4318**.

## Prepare the recording

Keep these files ready:

- `demo-kit/speaker-comparison.mp4` — the original 36-second film.
- `demo-kit/original-sources.txt` — the source sheets used by that film.
- `demo-kit/correction-source.txt` — the later correction, used only after graph review.

Leave **OpenAI API credit** selected for the tested path. To try subscription usage, open connection settings, choose **Continue with ChatGPT**, and check for **Plan usage enabled**. Do that before recording. If the account is ineligible, explicitly select API credit; CUTBACK does not switch automatically.

Click **New project**. Rehearsals remain behind **Projects** and do not appear in the fresh project's history. No database reset is needed.

## Upload and inspect the sources

Choose the MP4. Attach `original-sources.txt` under **Where do the facts come from?** Its contents appear in the box. The optional facts box can remain empty for this example.

Click **Upload & analyse video**. The activity panel shows local transcription, frame extraction, claim extraction, and graph creation. This step includes a model request. Prepare the local transcription model before recording so its initial download does not interrupt you.

On **Sources & facts**, point to a fact, its quoted passage, and its origin label: **YOUR SOURCE**, **VIDEO TRANSCRIPT**, or **VIDEO FRAME**. Speech timestamps seek the original film. Expand the supplied material to show the source file's contents.

Open **Dependency graph**. These nodes and edges are read from FalkorDB. Follow the adapter assumption through the cost comparison and recommendation to the relevant scenes. Review the evidence and connections, tick the checkbox, and approve the graph. If a connection is wrong, do not present it as correct. This prototype allows fact wording changes during review but does not yet offer an edge editor.

## Correct the fact

Select the adapter-included fact. Its wording and ID may vary between runs. Enter:

> Orbit Mini's required power adapter is not included in its $79 speaker price. It must be bought separately for $49.

Paste `correction-source.txt` into **Source for this correction**, then choose **Trace impact & propose edits**.

Show the dependency paths and expand **Inspect the Cypher query**. The activity log records MCP tool discovery, impact traversal, scene reads, arithmetic, and plan submission. Check the narration: **$79 + $49 = $128**, versus **$119**, making Forma **$9 cheaper** on upfront cost.

Approve the plan and render. This step uses local narration and FFmpeg with no model call. On **Compare & export**, click **Jump to first correction**. Play the original briefly, pause it, then play the revised cut. The replacement is a labelled correction card. The receipt lists changed and preserved segments; download the MP4 and captions.

## Show FalkorDB Browser

Open **http://localhost:6398**. If Browser asks for the database address inside the container, use `localhost:6379`. Clients running on your Mac connect to port **6397**.

In CUTBACK's **Dependency graph** tab, expand **Inspect this project in FalkorDB Browser** and copy the graph name. Select that graph in Browser. `cutback_upload_index` contains only the project list.

Show the source-to-scene paths:

```cypher
MATCH p=(s:Source)-[:CONTAINS|SUPPORTS|APPEARS_IN*1..6]->(scene:Scene)
RETURN p
```

Find the adapter fact's actual ID:

```cypher
MATCH (f:Fact)
RETURN f.id AS id, f.title AS fact
```

Replace `f2` below with that ID:

```cypher
MATCH p=(f:Fact {id:'f2'})-[:SUPPORTS|APPEARS_IN*1..4]->(s:Scene)
RETURN p
```

After rendering, show the receipt:

```cypher
MATCH p=(r:Revision)-[:APPLIES]->(:Correction)-[:CORRECTS]->(:Fact)
RETURN p
```

You can explain: “The JavaScript FalkorDB client executes a parameterized variable-length traversal. The returned scene IDs become the allowed edit set. The server rejects an extra or missing scene and queries the graph again before rendering.” The client code is in `server/upload/store.ts`; the MCP tools are in `server/upload/pipeline.ts`.

## Two-minute narration

Record the real workflow, then trim waiting periods for transcription, inference, and rendering. Label those cuts as processing time skipped.

**0:00–0:20 — Empty project and upload**

“I built CUTBACK for videos that become wrong after a source changes. Here I'm starting with an empty project. I'm uploading a speaker comparison and the source sheets used to make it. These products and prices are fictional.”

**0:20–0:45 — Evidence and graph**

“CUTBACK transcribes the speech locally, samples frames, and extracts claims. This fact came from the source file I uploaded; this one came from a timestamp in the video. I review the evidence before approving it. These connections are now stored in FalkorDB.”

**0:45–1:10 — Correction and Browser**

“The original video assumes Orbit's adapter is included. The corrected source says it costs another forty-nine dollars. In FalkorDB Browser, this path connects the fact to a claim and then to a scene. The agent calls that traversal through MCP. Those returned scene IDs determine what it can edit.”

**1:10–1:35 — Plan and render**

“The correction changes more than a price label. Seventy-nine plus forty-nine is one hundred and twenty-eight. Forma costs one hundred and nineteen, so the recommendation changes too. Here is the proposed narration. I check it, then approve the render.”

**1:35–2:00 — Compare and export**

“This is the uploaded version. This is the revised cut, with a correction card and new synthetic narration. Unaffected segments retain their footage. The receipt shows which source caused each change. I can export the MP4 and captions, while keeping the original video.”

## Spending and rehearsals

The completed test of this fixture recorded a conservative API estimate of about **$0.04**, including extraction and planning. It is not a quote for every run. The branch has a **$1 local allowance** across restarts. Reviewing, playback, and rendering do not spend model credit. Repeating analysis or planning does.

If a request fails, fix the reported problem before retrying. The completed rehearsal is available under **Projects** if you need its export without another model call. For an entirely fresh recording, choose **New project** again.
