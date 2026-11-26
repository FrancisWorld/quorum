import { appError } from "./errors";

export const LIMITS = {
  roomTitle: { min: 3, max: 100 },
  question: { min: 3, max: 500 },
  pollPrompt: { min: 3, max: 200 },
  pollOption: { min: 1, max: 80 },
  pollOptions: { min: 2, max: 8 },
  displayName: { max: 60 },
} as const;

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/** Strips control characters and collapses runs of whitespace. */
export function normalizeText(raw: string): string {
  return raw.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
}

function bounded(raw: string, label: string, { min, max }: { min: number; max: number }): string {
  const text = normalizeText(raw);
  if (text.length < min) throw appError("VALIDATION", `${label} must be at least ${min} characters.`);
  if (text.length > max) throw appError("VALIDATION", `${label} must be at most ${max} characters.`);
  return text;
}

export const validateRoomTitle = (raw: string) => bounded(raw, "Room title", LIMITS.roomTitle);
export const validateQuestion = (raw: string) => bounded(raw, "Question", LIMITS.question);
export const validatePollPrompt = (raw: string) => bounded(raw, "Poll prompt", LIMITS.pollPrompt);

export function validatePollOptions(raw: readonly string[]): string[] {
  const { min, max } = LIMITS.pollOptions;
  if (raw.length < min || raw.length > max) {
    throw appError("VALIDATION", `A poll needs between ${min} and ${max} options.`);
  }
  const options = raw.map((option) => bounded(option, "Poll option", LIMITS.pollOption));
  const seen = new Set<string>();
  for (const option of options) {
    const key = option.toLocaleLowerCase();
    if (seen.has(key)) throw appError("VALIDATION", `Duplicate poll option: "${option}".`);
    seen.add(key);
  }
  return options;
}

/** Identity names come from the auth provider; clamp them and never show an empty one. */
export function displayName(raw: string | undefined | null): string {
  const name = normalizeText(raw ?? "").slice(0, LIMITS.displayName.max);
  return name.length > 0 ? name : "Guest";
}

/** Case-insensitive key used to spot a user re-posting the same question. */
export const duplicateKey = (body: string) => normalizeText(body).toLocaleLowerCase();
