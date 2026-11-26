import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { appError } from "./errors";
import { can, type Permission } from "./roles";
import { displayName } from "./validation";

export interface Caller {
  userId: string;
  name: string;
}

/**
 * The only place that reads the identity. `subject` is the stable id issued by
 * the auth provider; names are display-only and clamped.
 */
export async function requireCaller(ctx: Pick<QueryCtx, "auth">): Promise<Caller> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw appError("UNAUTHENTICATED", "Sign in to continue.");
  return {
    userId: identity.subject,
    name: displayName(identity.name ?? identity.nickname ?? identity.givenName),
  };
}

export interface RoomAccess {
  caller: Caller;
  room: Doc<"rooms">;
  member: Doc<"members">;
}

/**
 * Loads a room for a member. Non-members get NOT_FOUND, the same answer as for
 * a room that does not exist, so ids cannot be probed.
 */
export async function requireMembership(ctx: QueryCtx, roomId: Id<"rooms">): Promise<RoomAccess> {
  const caller = await requireCaller(ctx);
  const room = await ctx.db.get(roomId);
  const member = room
    ? await ctx.db
        .query("members")
        .withIndex("by_room_user", (q) => q.eq("roomId", roomId).eq("userId", caller.userId))
        .unique()
    : null;
  if (!room || !member) throw appError("NOT_FOUND", "Room not found.");
  return { caller, room, member };
}

export function requirePermission(access: RoomAccess, permission: Permission): void {
  if (!can(access.member.role, permission)) {
    throw appError("FORBIDDEN", "You do not have permission to do that in this room.");
  }
}

export function requireOpenRoom(room: Doc<"rooms">): void {
  if (room.status === "closed") throw appError("ROOM_CLOSED", "This room is closed.");
}
