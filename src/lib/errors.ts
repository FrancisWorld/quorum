import { errorDataOf } from "../../convex/lib/errors";
import type { AppFailure } from "../backend/contract";

/** Converts anything thrown by a backend into something the UI can show. */
export function toFailure(error: unknown): AppFailure {
  const data = errorDataOf(error);
  if (data) {
    return data.retryAfterMs === undefined
      ? { code: data.code, message: data.message }
      : { code: data.code, message: data.message, retryAfterMs: data.retryAfterMs };
  }
  console.error(error);
  return { code: "UNKNOWN", message: "Something went wrong. Please try again." };
}

export function describeFailure(failure: AppFailure): string {
  if (failure.code === "RATE_LIMITED" && failure.retryAfterMs !== undefined) {
    return `${failure.message} Try again in ${Math.max(1, Math.ceil(failure.retryAfterMs / 1000))}s.`;
  }
  return failure.message;
}
