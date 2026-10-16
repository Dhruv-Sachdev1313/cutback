# CUTBACK

**A finished video that can revise its argument when its evidence changes.**

CUTBACK connects source versions, facts, calculations, claims, scenes, and rendered assets in FalkorDB. An editorial agent uses that graph to decide what must change, then renders a corrected video with narration and captions.

Built for **Graph Hacks — Track 1: Agents That Act on Connected Data**.

## Development

Requires Node.js 22.12+ and Docker. macOS narration uses the built-in `say` command; Linux uses `espeak-ng` (included in the app Docker image).

```sh
cp .env.example .env
npm install
npm run db:up
npm run dev
```

Studio: http://localhost:4317. Add your OpenAI API key to `.env` for the tool-using editorial agent. Without a key, the application identifies its deterministic local-rules mode explicitly. FalkorDB remains required in both modes.

All example products and sources are synthetic. No personal or restricted data is included.

Further architecture, graph queries, verification, and demo instructions are added alongside the implementation.
