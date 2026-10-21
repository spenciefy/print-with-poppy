import { runtime } from "../context.js";
export { syncProvider } from "../../server/job-actions.js";
export const tick = () => runtime().kick();
