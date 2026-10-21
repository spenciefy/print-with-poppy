# Social preview animation

Ten-second, silent 1200 × 630 H.264 loop. Uses the original `poppy-abstract-cluster.webp` artwork, preserving the actual orange flower silhouettes, green leaves and texture. Gentle low-frequency displacement and tiny breathing movement animate the complete print. Each poppy cycles independently through orange, yellow and red using phase-offset palette interpolation. Connected-petal masks preserve original texture and keep foliage, cream and border unchanged. Regenerate masks with `node make-masks.mjs` from this directory (uses the root project Sharp dependency). The white border stays still. No entrances, exits, fades, empty frames or text. Motion is periodic for a seamless loop.

From this directory:

```sh
npm ci
npm run render
npm run poster
```

The MP4 is served as `og:video`; a matching frame is the `og:image` fallback. Sharing-app support varies. The main app has no Remotion runtime dependency.
