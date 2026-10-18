# Article screenshots

These PNGs are captures of the working local application. They contain synthetic product data.

- `studio.png`: the redesigned studio with the standard adapter correction applied.
- `dependency-map.png`: a preview of changing the adapter-inclusion fact, showing the affected graph paths. No revision is submitted during this capture.
- `compare-verdicts.png`: decoded frames from the original and revised MP4s.
- `studio-before-redesign.png`: the earlier interface, retained for the development story.

To refresh the first three images, apply the standard correction in the running app, then run:

```sh
node scripts/article-screenshots.mjs
```

The capture uses installed Chrome by default. Set `CUTBACK_URL` or `PLAYWRIGHT_CHANNEL` when needed. The mode label reflects the running backend. The original captures show Local rules mode; an OpenAI recording requires an API key and a verified agent run.

The images are referenced relatively from `../building-cutback.md`, so keep this folder alongside the article when copying it to another Markdown-based publishing workflow.
