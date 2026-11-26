/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import type { FunctionReference } from "convex/server";
import schema from "../../convex/schema";
import { ConvexBackend } from "../../src/backend/convexBackend";
import type { Backend } from "../../src/backend/contract";
import { DemoBackend } from "../../src/backend/demoBackend";

const modules = import.meta.glob("../../convex/**/*.*s");

export interface Person {
  id: string;
  name: string;
}

export const ADA: Person = { id: "p_ada", name: "Ada" };
export const BEN: Person = { id: "p_ben", name: "Ben" };
export const CLEO: Person = { id: "p_cleo", name: "Cleo" };
export const DEV: Person = { id: "p_dev", name: "Dev" };

/** A backend implementation under test, with one handle per signed-in person. */
export interface World {
  name: string;
  as(person: Person | null): Backend;
}

type Loose = Record<string, unknown>;

/** The real Convex functions, executed by convex-test behind the production ConvexBackend adapter. */
export function convexWorld(): World {
  const t = convexTest(schema, modules);
  return {
    name: "convex functions (convex-test)",
    as(person) {
      const client = person
        ? t.withIdentity({ subject: person.id, name: person.name, issuer: "https://clerk.local.test" })
        : t;
      return new ConvexBackend({
        query: (ref: FunctionReference<"query">, args: Loose) => client.query(ref, args as never),
        mutation: (ref: FunctionReference<"mutation">, args: Loose) => client.mutation(ref, args as never),
      });
    },
  };
}

/** The in-memory backend behind offline demo mode, starting from an empty world. */
export function demoWorld(): World {
  const demo = new DemoBackend({ seed: false });
  return {
    name: "demo backend (in-memory)",
    as(person) {
      // Both methods run synchronously up to their first await, so setting the
      // identity right before the call is safe even under Promise.all.
      return {
        query: (name, args) => {
          demo.signInAs(person ? { ...person, blurb: "" } : null);
          return demo.query(name, args);
        },
        mutate: (name, args) => {
          demo.signInAs(person ? { ...person, blurb: "" } : null);
          return demo.mutate(name, args);
        },
        subscribe: (name, args, onData, onError) => demo.subscribe(name, args, onData, onError),
      };
    },
  };
}
