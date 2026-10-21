# Social preview animation

Ten-second, silent 1200 × 630 H.264 loop. Uses the original `poppy-abstract-cluster.webp` artwork, preserving the actual orange flower silhouettes, green leaves and texture. Gentle low-frequency displacement and tiny breathing movement animate the complete print. Each poppy cycles independently through orange, yellow and red using phase-offset palette interpolation. Connected-petal masks preserve original texture and keep foliage, cream and border unchanged. Regenerate masks with `node make-masks.mjs` from this directory (uses the root project Sharp dependency). The white border stays still. A print line reveals the artwork from an already 32%-printed starting frame, then the finished photo gently feeds forward and settles. The finished print remains visible to the end with independent color movement. No exit animation or text. The video is a ten-second reveal, not a seamless loop.

From this directory:

```sh
npm ci
npm run render
npm run poster
```

The MP4 is served as `og:video`; a matching frame is the `og:image` fallback. Sharing-app support varies. The main app has no Remotion runtime dependency.
