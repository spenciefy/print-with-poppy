import { cp, mkdir } from 'node:fs/promises';
await mkdir('public/docs/vendor', { recursive: true });
await cp('node_modules/@scalar/api-reference/dist/browser', 'public/docs/vendor', {
  recursive: true,
  filter: (source) => !source.endsWith('.map'),
});
