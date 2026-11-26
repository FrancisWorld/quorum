/* eslint-disable */
  /**
   * Generated `api` utility.
   *
   * THIS CODE IS AUTOMATICALLY GENERATED.
   *
   * To regenerate, run `npx convex dev`.
   * @module
   */
  
  import type { ApiFromModules, FilterApi, FunctionReference } from "convex/server";
  import type * as crons from "../crons.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_joinCode from "../lib/joinCode.js";
import type * as lib_moderation from "../lib/moderation.js";
import type * as lib_pollTally from "../lib/pollTally.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_rateLimitDb from "../lib/rateLimitDb.js";
import type * as lib_roles from "../lib/roles.js";
import type * as lib_validation from "../lib/validation.js";
import type * as lib_views from "../lib/views.js";
import type * as maintenance from "../maintenance.js";
import type * as polls from "../polls.js";
import type * as presence from "../presence.js";
import type * as questions from "../questions.js";
import type * as rooms from "../rooms.js";

  /**
   * A utility for referencing Convex functions in your app's API.
   *
   * Usage:
   * ```js
   * const myFunctionReference = api.myModule.myFunction;
   * ```
   */
  declare const fullApi: ApiFromModules<{
    "crons": typeof crons,
"lib/access": typeof lib_access,
"lib/errors": typeof lib_errors,
"lib/joinCode": typeof lib_joinCode,
"lib/moderation": typeof lib_moderation,
"lib/pollTally": typeof lib_pollTally,
"lib/rateLimit": typeof lib_rateLimit,
"lib/rateLimitDb": typeof lib_rateLimitDb,
"lib/roles": typeof lib_roles,
"lib/validation": typeof lib_validation,
"lib/views": typeof lib_views,
"maintenance": typeof maintenance,
"polls": typeof polls,
"presence": typeof presence,
"questions": typeof questions,
"rooms": typeof rooms,
  }>;
  export declare const api: FilterApi<typeof fullApi, FunctionReference<any, "public">>;
  export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, "internal">>;
  