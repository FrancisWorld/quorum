import type { ConvexReactClient } from "convex/react";
import type { FunctionReference, FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type {
  Backend,
  MutationContract,
  MutationName,
  QueryContract,
  QueryName,
  Unsubscribe,
} from "./contract";

export const queries = {
  "rooms.get": api.rooms.get,
  "rooms.mine": api.rooms.mine,
  "rooms.members": api.rooms.members,
  "questions.list": api.questions.list,
  "polls.list": api.polls.list,
  "presence.list": api.presence.list,
} satisfies Record<QueryName, FunctionReference<"query">>;

export const mutations = {
  "rooms.create": api.rooms.create,
  "rooms.join": api.rooms.join,
  "rooms.update": api.rooms.update,
  "rooms.setSpotlight": api.rooms.setSpotlight,
  "rooms.setRole": api.rooms.setRole,
  "questions.submit": api.questions.submit,
  "questions.setVote": api.questions.setVote,
  "questions.moderate": api.questions.moderate,
  "polls.create": api.polls.create,
  "polls.setStatus": api.polls.setStatus,
  "polls.vote": api.polls.vote,
  "presence.heartbeat": api.presence.heartbeat,
  "presence.leave": api.presence.leave,
} satisfies Record<MutationName, FunctionReference<"mutation">>;

// Compile-time proof that the UI contract matches what the Convex functions return.
type Assignable<Actual extends Expected, Expected> = Actual;
export type ContractChecks = [
  Assignable<FunctionReturnType<typeof api.rooms.get>, QueryContract["rooms.get"]["result"]>,
  Assignable<FunctionReturnType<typeof api.rooms.mine>, QueryContract["rooms.mine"]["result"]>,
  Assignable<FunctionReturnType<typeof api.rooms.members>, QueryContract["rooms.members"]["result"]>,
  Assignable<FunctionReturnType<typeof api.questions.list>, QueryContract["questions.list"]["result"]>,
  Assignable<FunctionReturnType<typeof api.polls.list>, QueryContract["polls.list"]["result"]>,
  Assignable<FunctionReturnType<typeof api.presence.list>, QueryContract["presence.list"]["result"]>,
  Assignable<FunctionReturnType<typeof api.rooms.create>, MutationContract["rooms.create"]["result"]>,
  Assignable<FunctionReturnType<typeof api.rooms.join>, MutationContract["rooms.join"]["result"]>,
  Assignable<FunctionReturnType<typeof api.questions.submit>, MutationContract["questions.submit"]["result"]>,
  Assignable<FunctionReturnType<typeof api.questions.setVote>, MutationContract["questions.setVote"]["result"]>,
  Assignable<FunctionReturnType<typeof api.questions.moderate>, MutationContract["questions.moderate"]["result"]>,
  Assignable<FunctionReturnType<typeof api.polls.create>, MutationContract["polls.create"]["result"]>,
  Assignable<FunctionReturnType<typeof api.polls.vote>, MutationContract["polls.vote"]["result"]>,
  Assignable<FunctionReturnType<typeof api.presence.heartbeat>, MutationContract["presence.heartbeat"]["result"]>,
];

// The contract uses plain string ids; Convex wants branded ids. They are the same at runtime.
type LooseArgs = Record<string, unknown>;

/** Minimal slice of a Convex client, so tests can drive the same adapter with convex-test. */
export interface ConvexLike {
  query(ref: FunctionReference<"query">, args: LooseArgs): Promise<unknown>;
  mutation(ref: FunctionReference<"mutation">, args: LooseArgs): Promise<unknown>;
}

export class ConvexBackend implements Backend {
  constructor(
    private readonly client: ConvexLike,
    private readonly watcher: ConvexReactClient | null = null,
  ) {}

  async query<K extends QueryName>(name: K, args: QueryContract[K]["args"]): Promise<QueryContract[K]["result"]> {
    const result = await this.client.query(queries[name] as FunctionReference<"query">, args as LooseArgs);
    return result as QueryContract[K]["result"];
  }

  subscribe<K extends QueryName>(
    name: K,
    args: QueryContract[K]["args"],
    onData: (data: QueryContract[K]["result"]) => void,
    onError: (error: unknown) => void,
  ): Unsubscribe {
    if (!this.watcher) throw new Error("subscribe needs a ConvexReactClient");
    const watch = this.watcher.watchQuery(queries[name] as FunctionReference<"query">, args as LooseArgs);
    const emit = () => {
      try {
        const value = watch.localQueryResult();
        if (value !== undefined) onData(value as QueryContract[K]["result"]);
      } catch (error) {
        onError(error);
      }
    };
    const stop = watch.onUpdate(emit);
    emit();
    return stop;
  }

  async mutate<K extends MutationName>(
    name: K,
    args: MutationContract[K]["args"],
  ): Promise<MutationContract[K]["result"]> {
    const result = await this.client.mutation(mutations[name] as FunctionReference<"mutation">, args as LooseArgs);
    return result as MutationContract[K]["result"];
  }
}
