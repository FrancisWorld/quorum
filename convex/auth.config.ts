import type { AuthConfig } from "convex/server";

/**
 * Convex trusts JWTs issued by Clerk. Activate the Convex integration in the
 * Clerk dashboard and set CLERK_JWT_ISSUER_DOMAIN on the deployment
 * (see docs/SETUP.md).
 */
export default {
  providers: [
    {
      // Required at deploy time; Convex reports a clear error if it is unset.
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN as string,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
