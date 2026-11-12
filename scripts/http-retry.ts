/** Retry only explicit 429 rejections, with fresh request proofs each attempt. */
export async function retrying(
  send: () => Promise<Response>,
  options: { attempts?: number; sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
) {
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const attempts = options.attempts ?? 6;
  for (let attempt = 0; ; attempt++) {
    const response = await send();
    if (response.status !== 429 || attempt + 1 >= attempts) return response;
    const value = response.headers.get("retry-after") ?? "";
    const seconds = /^\d+$/.test(value) ? Number(value) : NaN;
    const date = Date.parse(value);
    const delay = Number.isFinite(seconds) ? seconds * 1000 : Number.isFinite(date) ? Math.max(0, date - now()) : 5000;
    await response.body?.cancel();
    // Chunk long waits to avoid timer overflow; never shorten Retry-After.
    for (let remaining = delay; remaining > 0; remaining -= Math.min(remaining, 60_000))
      await sleep(Math.min(remaining, 60_000));
  }
}
