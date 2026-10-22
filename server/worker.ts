import { db } from "./store.js";
import { recordJobFailure } from "./job-failure.js";
let running = false;
export { runJob, syncProvider } from "./job-actions.js";
import { runJob } from "./job-actions.js";
export async function tick() {
  if (running) return;
  running = true;
  try {
    const jobs = db
      .prepare(
        "SELECT * FROM jobs WHERE state='pending' AND next_at<=? ORDER BY rowid LIMIT 20",
      )
      .all(Date.now());
    for (const job of jobs as any[]) {
      try {
        await runJob(job);
        db.prepare("UPDATE jobs SET state='done',error=NULL WHERE id=?").run(
          job.id,
        );
      } catch (e) {
        recordJobFailure(job, e);
      }
    }
  } finally {
    running = false;
  }
}
export { housekeeping } from "./retention.js";
