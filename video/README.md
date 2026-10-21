# Social preview animation

Eight-second, silent 1200 × 630 H.264 loop using hand-shaped vector flowers inspired by the poppy print artwork. Individual orange, yellow and red flowers with olive leaves fall from above, settle into a full-bleed pattern, hold, and drop away before the loop restarts. No text, logos or photo borders. All animation is frame-driven.

From this directory:

```sh
npm ci
npm run render
npm run poster
```

The MP4 is served as `og:video`; the settled frame is the `og:image` fallback. Support/autoplay varies by sharing app; these tags do not guarantee an animated X card. Keep `twitter:card=summary_large_image` as a static fallback. No runtime video dependency is added to the application.
