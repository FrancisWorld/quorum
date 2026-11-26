import { ClerkProvider, SignIn, UserButton, useAuth, useUser } from "@clerk/react";
import { ConvexReactClient, useConvexAuth } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useMemo, type ReactNode } from "react";
import { ConvexBackend } from "../backend/convexBackend";
import { EnvironmentProvider, type AppEnvironment } from "../backend/react";

function LiveEnvironment({ client, children }: { client: ConvexReactClient; children: ReactNode }) {
  const convexAuth = useConvexAuth();
  const { user } = useUser();
  const backend = useMemo(() => new ConvexBackend(client, client), [client]);

  const value = useMemo<AppEnvironment>(() => {
    const status = convexAuth.isLoading ? "loading" : convexAuth.isAuthenticated ? "signedIn" : "signedOut";
    return {
      mode: "live",
      backend,
      auth: {
        status,
        user: status === "signedIn" && user ? { id: user.id, name: user.fullName ?? user.username ?? "Guest" } : null,
      },
      banner: null,
      signIn: (
        <div className="card auth-card">
          <SignIn routing="hash" />
        </div>
      ),
      accountMenu: <UserButton />,
    };
  }, [backend, convexAuth.isAuthenticated, convexAuth.isLoading, user]);

  return <EnvironmentProvider value={value}>{children}</EnvironmentProvider>;
}

/**
 * Production wiring: Clerk authenticates the user, Convex validates the Clerk
 * JWT. This is the only file (with convexBackend.ts) that knows either vendor.
 */
export function LiveProvider({
  convexUrl,
  publishableKey,
  children,
}: {
  convexUrl: string;
  publishableKey: string;
  children: ReactNode;
}) {
  const client = useMemo(() => new ConvexReactClient(convexUrl), [convexUrl]);
  return (
    <ClerkProvider publishableKey={publishableKey}>
      <ConvexProviderWithClerk client={client} useAuth={useAuth}>
        <LiveEnvironment client={client}>{children}</LiveEnvironment>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
