import { analyzeSession } from "../generation/analyze";
import { generateWorkProduct } from "../generation/generate";
import { registerJobHandler } from "./queue";

const sessionIdOf = (payload: Record<string, unknown>) => {
  const id = payload.sessionId;
  if (typeof id !== "string") throw new Error("job payload is missing sessionId");
  return id;
};

registerJobHandler("analyze", (db, job) => analyzeSession(db, sessionIdOf(job.payload), job.id));
registerJobHandler("generate", (db, job) => generateWorkProduct(db, sessionIdOf(job.payload), "draft", { jobId: job.id }));
registerJobHandler("rerender", (db, job) => generateWorkProduct(db, sessionIdOf(job.payload), "rerender", { jobId: job.id }));

export const HANDLERS_REGISTERED = true;
