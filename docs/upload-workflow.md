# Record CUTBACK from an empty project

Use **http://127.0.0.1:4328** on branch `feat/video-intake-chatgpt`. Your original demo stays at **http://localhost:4318**.

## Prepare the recording

Keep these files ready:

- `demo-kit/speaker-comparison.mp4` — the original 36-second film.
- `demo-kit/original-sources.txt` — the source sheets used by that film.
- `demo-kit/correction-source.txt` — the later correction, used only after graph review.

Use **OpenAI API credit** throughout this recording. Your organisation does not allow ChatGPT sign-in, so use the API setup already configured. Confirm the provider selector says **OpenAI API credit**. If needed, open connection settings and select **Use API credit · GPT-6.1 Sol**.

The API key is configured on the running server. Keep `.env.upload` closed while recording. The header's dollar amount is the remainder of CUTBACK's local estimated allowance, not your OpenAI account balance. Transcription and narration run locally; the API model extracts claims and plans edits.

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

Copy-and-paste queries are in [upload-demo.cypher](upload-demo.cypher). Run one at a time. They are read-only and do not call OpenAI. For two minutes, prioritise the connected graph, affected-scene result, and finished video; use the other queries for a longer technical explanation.

Open **http://localhost:6398**. On **Manual Configuration**, set **Host** to `localhost` and **Port** to `6379`. Leave username and password empty and TLS unchecked for this local demo, then click **Log in**. This connects to the database inside the Browser's container; it is not a ChatGPT login. Click **Skip Tutorial** if the introduction appears. These connection settings were checked against the running container.

The upload app's JavaScript client runs on your Mac and uses the host-mapped port **6397**. Browser reaches the same database from inside the container on **6379**.

In CUTBACK's **Dependency graph** tab, expand **Inspect this project in FalkorDB Browser** and copy the graph name. Click **Select Graph** in Browser and choose that exact graph. `cutback_upload_index` contains only the project list. A fresh upload creates a new graph, so do not keep the rehearsal graph selected for the recording.

Paste one query in the editor and click **RUN**. First find the adapter fact's actual ID:

```cypher
MATCH (f:Fact)
RETURN f.id AS id, f.title AS fact
ORDER BY id
```

Find the row saying that Orbit's required adapter is included in the $79 price. In the verified rehearsal that is `f2`. Replace `f2` below if your new extraction assigns another ID.

Show where that fact came from and which claims and scenes depend on it:

```cypher
MATCH p=(src:Source)-[:CONTAINS]->(:Evidence)-[:SUPPORTS]->(f:Fact {id:'f2'})
        -[:SUPPORTS]->(:Claim)-[:APPEARS_IN]->(:Scene)
RETURN p
```

`p` names the whole matched path. `RETURN p` lets Browser draw its nodes and relationships. This connects the uploaded source material all the way to the video segments. In the checked graph, this returns three paths because the adapter assumption supports both a cost claim and a recommendation.

Now show the affected-scene list, using the same traversal pattern as the agent:

```cypher
MATCH p=(f:Fact {id:'f2'})-[:SUPPORTS|APPEARS_IN*1..4]->(s:Scene)
RETURN DISTINCT s.id AS sceneId,
                s.title AS scene,
                s.start AS startsAt,
                s.end AS endsAt
ORDER BY startsAt
```

What this means:

- `(f:Fact {id:'f2'})` starts at the selected fact node.
- `->` follows the direction of the stored dependencies.
- `SUPPORTS|APPEARS_IN` allows those two relationship types.
- `*1..4` allows paths of one to four relationships. The current fact-to-claim-to-scene paths are two relationships long.
- `(s:Scene)` keeps video segments as the endpoints.
- `DISTINCT` returns each segment once even when several claims lead to it.

The verified rehearsal returns:

| Scene ID | Display name | Original start | Original end   |
| -------- | ------------ | -------------- | -------------- |
| `s1`     | Scene 2      | 11.32 seconds  | 24 seconds     |
| `s2`     | Scene 3      | 24 seconds     | 35.877 seconds |

There are three explanation paths but only two distinct affected scenes. Scene 1 (`s0`) has no dependency path from this adapter fact and is retained. These timestamps refer to the original upload; new narration can change the revised video's duration. Fresh extractions can assign different fact IDs and dependencies, so check the result before recording.

To see every explanation path as text:

```cypher
MATCH p=(f:Fact {id:'f2'})-[:SUPPORTS|APPEARS_IN*1..4]->(s:Scene)
RETURN s.id AS sceneId,
       [n IN nodes(p) | n.title] AS dependencyPath
```

The list expression reads the title of every node along a path, in order. That is how CUTBACK can show the reason a segment was included rather than just returning a scene ID.

After rendering, show the correction receipt:

```cypher
MATCH p=(f:Fact)<-[:CORRECTS]-(c:Correction)<-[:APPLIES]-(r:Revision)
        -[:REBUILDS]->(s:Scene)
RETURN p
```

This shows the original fact, the correction, the export that applied it, and the scenes that were rebuilt. The original fact still says the adapter was included because it describes the uploaded video. The correction is appended as a separate node. Its `source` property contains the revised source text you supplied. An empty receipt result before rendering is expected.

You can explain: “The JavaScript FalkorDB client executes a parameterized variable-length traversal. The returned scene IDs become the allowed edit set. The server rejects an extra or missing scene and queries the graph again before rendering.”

For a quick code view, show `server/upload/store.ts`: the query is near the top and `selectGraph(...).query(..., { params, TIMEOUT: 10000 })` executes it. The running app passes `$factId` separately as a query parameter. The Browser examples use a literal ID for easy pasting. In `server/upload/pipeline.ts`, the render branch calls `store.impact()` and then `validateEdits()` before FFmpeg runs.

## What each part demonstrates

| Part                           | What you are showing                                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| New project                    | A fresh upload has its own graph and no inherited exports.                                                                  |
| Video and original source file | The inputs used to produce the evidence, rather than an unexplained preloaded graph.                                        |
| Evidence                       | A timestamped speech passage, sampled frame, or supplied source passage.                                                    |
| Fact                           | An extracted underlying assertion, such as “the adapter is included.” It still needs review.                                |
| Claim                          | A conclusion relying on facts, such as “Orbit costs $40 less.”                                                              |
| Scene                          | A bounded interval of the uploaded film that expresses a claim.                                                             |
| Graph traversal                | Which scenes depend on the changed assertion, including later conclusions.                                                  |
| MCP activity                   | One model-driven agent discovering and calling tools. Four tools do not mean four agents.                                   |
| Calculator                     | Deterministic arithmetic; it is a tool result, not a separate calculation node in this upload graph.                        |
| Plan review                    | You check the proposed narrative before rendering. The server enforces scene scope, not universal truth of arbitrary prose. |
| Revised MP4                    | Real correction cards, synthetic narration, and retained source footage stitched into a playable file.                      |
| Receipt                        | The source correction and the specific export and scenes associated with it.                                                |

The useful distinction is between a changed input and the conclusions that depend on it. The adapter correction changes the total cost, the saving, and the recommendation. The source-to-scene relationships make those consequences explicit.

FalkorDB is required by this implementation: it stores the dependencies, provides the edit scope, and is queried again before publication. If that query cannot run, the pipeline cannot validate and publish the revision. This does not imply that a graph database verifies the truth of the source; you still review the evidence and extracted connections.

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
