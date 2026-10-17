# Architecture and technical decisions

```text
React studio
    │ source correction / SSE progress / video playback
Express API
    │ optimistic revision lock
FalkorDB ─── immutable source + edit + run history
    ↑
MCP tools ← OpenAI Responses editorial agent
    │ validated editorial plan
Factual script compiler → SVG scenes → speech → FFmpeg
    │ arithmetic / coverage / unchanged-scene verification
Content-addressed scene cache → MP4 + SRT → published graph version
```

## Agent behavior

With `OPENAI_API_KEY` configured, the OpenAI Responses agent receives a correction task and discovers four tools through an actual MCP client/server pair:

1. `trace_impact`: traverses FalkorDB from changed facts.
2. `calculate_costs`: re-reads the candidate facts from FalkorDB and computes prices.
3. `read_scene`: reads a scene and its provenance before an edit.
4. `submit_edit_plan`: selects the affected scenes, the narrative framing, and a transition.

The model chooses tool order and arguments. The server requires graph tracing, arithmetic, and reading every affected scene before accepting a plan. Attempts to alter unrelated scenes or select contradictory framing are rejected and returned as tool errors. Model calls have timeouts, bounded retries, and a maximum tool-loop length. OpenAI failures stop the run; they do not silently turn into a local-rules success.

MCP uses linked in-memory transports for the application agent. This still uses SDK discovery, JSON-RPC calls, and schema validation; it is not a renamed function wrapper. The separately runnable stdio server exposes project inspection, source-impact tracing, historical provenance, and starting corrections to external MCP clients.

## Why narration uses a factual compiler

The agent selects the editorial plan. Verified templates insert exact prices and the calculated lower-cost choice into both narration and visual titles. This bounded first version prevents a fluent model from adding unsupported claims about sound quality or product superiority.

The current application does **not** understand arbitrary uploaded movies, extract arbitrary documents, or perform unrestricted video editing. It operates on its authored speaker-comparison template and structured source fields. This is a deliberate, working end-to-end slice.

## Local execution mode

`AGENT_MODE=auto` selects OpenAI when a key exists. Otherwise the UI clearly reports **Local rules mode**. That runner invokes the same MCP tools and actual database/video pipeline but chooses a deterministic plan. It is useful for offline development and repeatable QA; it is not presented as an LLM agent.

For a submission recorded as an AI agent, configure a key and use `AGENT_MODE=openai`, which refuses to run without a key.

## Rendering

- Source figures use integer cents.
- SVG product illustrations and scene layouts are original project assets.
- `sharp` renders 1280×720 PNGs.
- Narration uses macOS `say`, Linux `espeak-ng`, or the configured OpenAI speech endpoint.
- Caption cue durations are estimated from text lengths within each audio segment; they are not forced-aligned word timestamps.
- FFmpeg produces H.264 / AAC MP4s with burned-in captions plus a separate SRT file.
- Scene fingerprints hash narration, relevant visual values, renderer version, and speech settings to locate cached assets. They are recipe hashes, not a checksum of the MP4 bytes; browser QA also records SHA-256 checksums of preserved media.
- Unaffected scenes reuse the exact previous files. Changed scenes also reuse content-identical cache entries.
- The final cut is published only after validation and successful assembly.

## Prototype boundaries

This is a local, single-project, single-API-process application. It has no hosted authentication or multi-user isolation. Graph storage and media persist across restarts. There is no automatic extraction from private documents or online product sites: every supplied product and source is synthetic.

The first cut is seeded from authored templates. Subsequent corrections use the configured editorial mode. Source history and tool traces persist, but this submission is positioned in **Track 1**, not as a general-purpose agent-memory platform.
