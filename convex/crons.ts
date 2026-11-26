import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("prune stale presence and idle rate-limit buckets", { minutes: 5 }, internal.maintenance.prune);

export default crons;
