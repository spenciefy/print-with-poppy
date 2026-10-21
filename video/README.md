# Social preview animation

Eight-second, silent 1200 × 630 H.264 loop using hand-shaped vector flowers inspired by the poppy print artwork. The complete floral pattern is visible from the first frame, inside a white photo-print border with a subtle paper shadow. Flowers gently sway in a seamless periodic loop; nothing falls, enters or exits. No text or logos. All animation is frame-driven.

From this directory:

```sh
npm ci
npm run render
npm run poster
```

The MP4 is served as `og:video`; the settled frame is the `og:image` fallback. Support/autoplay varies by sharing app; these tags do not guarantee an animated X card. Keep `twitter:card=summary_large_image` as a static fallback. No runtime video dependency is added to the application.
