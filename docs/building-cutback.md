# Building CUTBACK to revise videos when facts change

The video recommends the Orbit Mini. It costs $79; the Forma One costs $119. On upfront cost, Orbit wins by $40.

Then one source field changes. Orbit's required adapter is sold separately, and it costs $49. The complete price is now $128. The next cut recommends Forma, which is $9 cheaper.

The chart changes. The narrator reads the corrected prices. The verdict changes with them. The opening and closing clips stay exactly where they were, using the same media files.

That is the demo I wanted to build for the [FalkorDB hackathon](https://www.wemakedevs.org/hackathons/falkordb). I called it CUTBACK.

![CUTBACK's redesigned studio showing the corrected Forma verdict, source inspector, and four scene clips.](article-assets/studio.png)

_The working studio after the redesign. The source editor is on the right; the sequence shows which clips changed. Both products are fictional._

## Starting with a demo someone could understand

The first suggestions I got were familiar: an incident responder, a fraud investigator, a codebase assistant, shared agent memory, a company knowledge tool, and a cloud attack-path investigator. They solve real problems. I wanted a project whose result would be visible in a short recording, without needing a long explanation of the surrounding infrastructure.

A factual correction in a finished video gave me that result. Updating a source document is easy enough. Finding every sentence, graphic, caption, and recommendation that depended on the old fact is the annoying part. An editor has to remember those connections or check the whole film again.

CUTBACK makes those dependencies explicit. The experiment is whether an agent can use them to revise the right parts of a film and leave the rest alone.

I built this with Codex, which wrote much of the implementation and ran the automated checks. I chose the concept and OpenAI, pushed for a recordable demo, and rejected the first interface. The bugs below came out of that assisted build. Code review and a full understanding of the implementation are still on my list before submission.

## Giving the graph an editing job

The hackathon requires FalkorDB to support a central part of the product. For CUTBACK, the graph decides which scenes the editor is allowed to change.

The dependency model starts with two synthetic product sheets. They supply four facts: Orbit's base price, its adapter price, whether the adapter is included, and Forma's complete price. Those facts feed cost calculations. The calculations feed comparison claims, and the claims feed the cost and verdict scenes.

The opening asks the comparison question. The closing explains the scope and fictional data. Neither depends on the price figures, so a price correction does not reach them.

![The dependency map showing highlighted paths from the adapter inclusion fact through Orbit's total, comparison claims, and the cost and verdict scenes.](article-assets/dependency-map.png)

_Changing the adapter-inclusion fact reaches two scenes. The opening and closing sit outside those paths._

The traversal that drives the edit is short enough to inspect:

```cypher
MATCH p=(f:Artifact)-[:FEEDS*1..8]->(a:Artifact)
WHERE f.id IN $factIds
RETURN DISTINCT a.id AS id, a.kind AS kind,
  [n IN nodes(p) | n.id] AS pathIds,
  [n IN nodes(p) | n.title] AS pathTitles
```

The application starts at the changed facts and follows `FEEDS` edges. It returns both the affected artifacts and the paths explaining how it reached them. For the adapter correction, the edit plan must contain the cost and verdict scenes.

One integration test removes a dependency edge from the actual database and checks that the affected scene disappears from the result. That test mattered more than a screenshot of a graph: it checked whether changing the graph changed the application's decision.

This is an authored dependency model. The prototype does not discover the structure of an arbitrary uploaded film. Adding another kind of video would require another scene model and a way to connect its claims to evidence.

## What the agent can decide

The editorial agent has four tools: `trace_impact`, `calculate_costs`, `read_scene`, and `submit_edit_plan`.

An MCP client discovers those tools from an in-process MCP server. Their schemas are passed to the OpenAI Responses API, and requested function calls are dispatched through the MCP session. The model can inspect the graph, calculate the comparison, read the affected scenes, and submit an edit plan.

The server checks the plan before using it. The agent must have traced the impact, calculated the prices, and read every affected scene. It cannot add unrelated scenes or choose a verdict that contradicts the arithmetic.

Prices are stored as integer cents. A factual script compiler inserts the verified values into narration and visual templates. That keeps a cost comparison from casually growing an unsupported claim about which speaker sounds better. The agent chooses a constrained editorial plan; this version does not ask it to write unrestricted narration.

There is an important boundary in the current build: the OpenAI integration is implemented, but a live API run has not been verified because no key was configured during these checks. The screenshots show the explicitly labelled Local rules mode. That mode invokes the real MCP tools, graph queries, speech synthesis, and renderer, using a deterministic plan. It allowed the rest of the application to be tested without pretending an LLM was making the decisions.

When OpenAI mode is selected, API errors fail the revision and leave the last published cut available. There is no quiet fallback that turns an unsuccessful model call into a successful agent demo.

## Producing an actual video

The frontend is React and TypeScript, with an Express API behind it. FalkorDB stores source facts, revision state, citations, and run events. The rendering pipeline turns SVG scene layouts into PNGs with Sharp, synthesizes speech, and uses FFmpeg to produce H.264 video with AAC audio.

There was no system FFmpeg binary available on the development machine, so the native setup uses the binary supplied by `ffmpeg-static`. Speech uses macOS `say` locally. The Docker image supplies Linux speech through `espeak-ng` and installs FFmpeg itself. OpenAI speech is an optional configuration.

Captions are burned into the video, and an SRT file is exported separately. Their timing is estimated from the length of each caption cue within the audio segment. It is not word-level forced alignment.

Each scene has a fingerprint based on its rendering inputs. If an identical scene already exists, the renderer can use that cached clip. Unaffected scenes keep their previous file paths. The final film is assembled only after checks on the calculations, scene coverage, narration, and preservation of unrelated footage.

![The original and revised video verdicts displayed side by side, showing Orbit as $40 cheaper before the correction and Forma as $9 cheaper afterward.](article-assets/compare-verdicts.png)

_These are frames from the generated MP4s. The original cut remains available after the correction._

The render fingerprint needed a precise explanation in the documentation. It is a hash of the recipe for a scene, not a checksum of the MP4 bytes. Browser QA separately records SHA-256 checksums for the preserved media. Calling both things a file hash would have overstated what the internal identifier proved.

## Bugs that showed up after the first successful render

The most misleading bug was a status label. A repeated correction could produce the right video while the interface reported zero updated scenes and four preserved scenes.

The renderer's flag answered whether FFmpeg had produced a new file during that run. The interface used it to answer whether the scene had changed from the preceding cut. Those answers differ when an older cached clip replaces the current one.

The published scene status now compares its fingerprint with the previous version's fingerprint. A restored cached clip can therefore count as updated. The log separately explains that the renderer reused an existing asset. Browser checks assert the expected two-updated, two-preserved result.

Revision handling also needed more care than a render button suggests. Two requests can arrive with the same expected version. A compare-and-set query acquires a lock in FalkorDB; only one request can own the revision. The new version becomes active after rendering and verification succeed. Interrupted runs are marked failed when the API restarts, and the last published cut remains available. This is designed for one API process, not a distributed rendering farm.

Startup had its own failure case. If FalkorDB was unavailable, the database SDK could emit a connection error before the application had received a client instance to attach a listener to. The connection path now checks TCP availability first, and the API retries initialization while reporting that it is not ready. Starting the web server no longer assumes the database has already started.

Some friction came from the development environment. The first UI automation route was unavailable, so browser checks used an isolated Chrome session through Playwright. The `tsx` command also hit an IPC socket restriction in the automated environment. The test and production-start scripts were changed to invoke Node with `--import tsx`. Those were tooling fixes, separate from the application logic.

## Running out of disk during dependency updates

The Docker build reported seven dependency advisories, including two critical findings. The affected packages included the MCP SDK, Sharp, Playwright, Vite, and a development dependency chain through `concurrently`. Updating them brought npm's reported count to zero at the time of the check.

The update itself failed halfway through. The machine had about 122 MiB free, and npm reported `ENOSPC`. A second install hit `ENOTEMPTY` because the interrupted operation had left partially moved package directories. Docker's image store also started returning I/O errors.

Clearing npm's downloadable package cache recovered roughly 2.7 GB. The lockfile was updated, and a clean `npm ci` repaired the interrupted installation. Docker was restarted after checking that CUTBACK's database was the only running container. The build, graph tests, and browser flow were then run again with the patched dependencies.

The project files and database were kept. The space recovery came from regenerable package cache data.

## The database volume was in the wrong directory

A more consequential problem appeared when the database container was recreated. Earlier test revisions disappeared even though the Compose file declared a named volume and the container reported healthy.

The volume was mounted at `/data`. The selected FalkorDB image was actually writing its data under `/var/lib/falkordb/data`.

The fix was to mount the named volume at the directory FalkorDB really used. Before replacing the running container again, the current database files were copied into the volume. The API's current version ID and total version count were saved for comparison. After replacement, all six revisions present at that checkpoint were still there, with the same active cut.

The native application and the full Docker application also use separate graph names, because they have separate media directories. Sharing a graph while pointing at different media stores would leave valid version records referring to missing video files.

## Recording exposed another lifecycle bug

The first walkthrough recording reached the end of the browser interaction and then failed while saving the video. The script had closed the browser connection before calling Playwright's `video.saveAs`.

The order now closes the browser context to flush the recording, saves the video while the connection is available, and then closes the browser. FFmpeg converts that capture to MP4. The walkthrough is silent so it can take a human voiceover; the exported story films contain synthesized narration.

The comparison shot also needed work. Showing two poster images was a weak way to demonstrate generated video. The recorder now plays the real verdict sections side by side. The exported MP4s were decoded as part of checking the recording, and the browser checks verify playback.

## Replacing the first interface

The first studio had a cream background, sage cards, rounded controls, an oversized sidebar, and decorative copy about stories following facts. It worked, but I told Codex that it looked AI-made. The visual treatment was too close to a generic dashboard for a product that was supposed to edit a film.

![The first CUTBACK interface, with a pale background, large left sidebar, rounded cards, and green accents.](article-assets/studio-before-redesign.png)

_The earlier interface. Its sidebar repeated navigation already available above the player, while the source controls and timeline had less room._

The redesign uses charcoal panels, warm white text, and amber for actions and changed states. IBM Plex Sans handles the controls, IBM Plex Mono handles time and data labels, and Barlow Condensed gives the headings a different shape. The fonts are bundled with the application.

The sidebar and pretend workspace selector are gone. The player sits in a labelled program monitor. The sequence uses clip widths based on duration, and the source inspector remains beside the video on desktop. The copy names what a control does: source inspector, dependency map, saved cuts. Browser checks cover the correction flow and a narrow mobile layout after the change.

## What I would put in the submission

CUTBACK fits Track 1, Agents That Act on Connected Data. The graph selects an edit, the tools supply the evidence for that selection, and the action produces a revised video. Saved history supports the workflow, but I am not presenting it as a general agent-memory platform.

The repository includes setup instructions, the graph model, the Cypher queries, and a repeatable walkthrough recorder. The tested slice is one local project with fictional products and an authored comparison template. It does not ingest arbitrary videos or documents, and it does not yet offer a hosted multi-user editor.

Before recording the agent submission, I still need to configure my OpenAI key, verify its tool calls, and review the implementation well enough to explain it. The local test result is useful evidence about the graph and renderer; the submission needs an actual agent run too.

For the live demo, I would change the adapter price after showing the initial reversal. At $40, both products cost $119, so the verdict should be a tie. At $20, Orbit costs $99 and becomes cheaper again. Those inputs give someone watching a direct way to challenge the result.

The adapter is a small example. Keeping the edit tied to the reason it changed is the part I want to develop further.
