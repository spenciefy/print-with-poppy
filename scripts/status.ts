import { db } from "../server/store.js";
// Local operator view: identifiers and errors only. No photo/email/address payloads.
const jobs = db
  .prepare(
    "SELECT id,kind,record_id,state,attempts,error FROM jobs WHERE state!='done' ORDER BY rowid LIMIT 100",
  )
  .all();
console.table(jobs);
db.close();
