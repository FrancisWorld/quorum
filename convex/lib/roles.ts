export type Role = "host" | "moderator" | "participant";

export type Permission = "moderate" | "managePolls" | "manageRoom" | "present";

const GRANTS: Record<Role, readonly Permission[]> = {
  host: ["moderate", "managePolls", "manageRoom", "present"],
  moderator: ["moderate", "managePolls", "present"],
  participant: [],
};

export function can(role: Role, permission: Permission): boolean {
  return GRANTS[role].includes(permission);
}
