import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  authResponseSchema,
  authTokenSchema,
  resourceIdSchema,
  type PublicUser,
} from "@monitorx/contracts";
import { workspaceRequest as api } from "./workspace-api.js";
type LinkToken = {
  kind: "verify-email" | "reset-password" | "invitation";
  token: string;
  organizationId?: string;
};
export function readLinkToken(hash: string): LinkToken | undefined {
  const fields = new URLSearchParams(hash.replace(/^#/, ""));
  for (const kind of ["verify-email", "reset-password"] as const) {
    const token = fields.get(kind);
    if (authTokenSchema.safeParse(token).success)
      return { kind, token: token! };
  }
  const parts = (fields.get("invitation") ?? "").split(".");
  const [organizationId, token] = parts;
  if (
    parts.length === 2 &&
    resourceIdSchema.safeParse(organizationId).success &&
    authTokenSchema.safeParse(token).success
  )
    return {
      kind: "invitation",
      token: token!,
      organizationId: organizationId!,
    };
  return undefined;
}
interface Session {
  user: PublicUser | undefined;
  loading: boolean;
  setUser: (user: PublicUser | undefined) => void;
  link: LinkToken | undefined;
  clearLink: () => void;
}
const Context = createContext<Session | null>(null);
export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser>(),
    [loading, setLoading] = useState(true);
  const [link, setLink] = useState(() => readLinkToken(window.location.hash));
  useEffect(() => {
    let active = true;
    if (window.location.hash)
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + window.location.search,
      );
    void api("/auth/me")
      .then((raw) => {
        if (active) setUser(authResponseSchema.parse(raw).user);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    const expired = () => setUser(undefined);
    const hashChange = () => {
      const incoming = readLinkToken(window.location.hash);
      if (!incoming) return;
      setLink(incoming);
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + window.location.search,
      );
    };
    window.addEventListener("monitorx:session-expired", expired);
    window.addEventListener("hashchange", hashChange);
    return () => {
      active = false;
      window.removeEventListener("monitorx:session-expired", expired);
      window.removeEventListener("hashchange", hashChange);
    };
  }, []);
  return (
    <Context.Provider
      value={{
        user,
        loading,
        setUser,
        link,
        clearLink: () => setLink(undefined),
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useSession() {
  const value = useContext(Context);
  if (!value) throw Error("Session provider is missing");
  return value;
}
