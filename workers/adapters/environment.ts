import { runtime } from "../context.js";
export const environment = () =>
  runtime().env as unknown as Record<string, string | undefined>;
