import { ConvexError } from "convex/values";

export const ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION",
  "RATE_LIMITED",
  "ROOM_CLOSED",
  "CONFLICT",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type AppErrorData = {
  code: ErrorCode;
  message: string;
  retryAfterMs?: number;
};

/** Structured error that survives the Convex client boundary (`error.data.code`). */
export function appError(
  code: ErrorCode,
  message: string,
  extra: { retryAfterMs?: number } = {},
): ConvexError<AppErrorData> {
  return new ConvexError<AppErrorData>({ code, message, ...extra });
}

export function errorDataOf(error: unknown): AppErrorData | null {
  if (!(error instanceof ConvexError)) return null;
  const data = error.data as Partial<AppErrorData> | undefined;
  if (data && typeof data === "object" && ERROR_CODES.includes(data.code as ErrorCode)) {
    return data as AppErrorData;
  }
  return null;
}
