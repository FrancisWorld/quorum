/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import schema from "../../convex/schema";

const modules = import.meta.glob("../../convex/**/*.*s");

export function createBackend() {
  return convexTest(schema, modules);
}

export type Backend = ReturnType<typeof createBackend>;

export interface Persona {
  userId: string;
  name: string;
}

export const ADA: Persona = { userId: "user_ada", name: "Ada" };
export const BEN: Persona = { userId: "user_ben", name: "Ben" };
export const CLEO: Persona = { userId: "user_cleo", name: "Cleo" };
export const DEV: Persona = { userId: "user_dev", name: "Dev" };

export function as(t: Backend, persona: Persona) {
  return t.withIdentity({
    subject: persona.userId,
    issuer: "https://clerk.local.test",
    name: persona.name,
  });
}

/** Convex errors carry their payload on `.data`; this matches it in `rejects.toMatchObject`. */
export const code = (c: string) => ({ data: { code: c } });
