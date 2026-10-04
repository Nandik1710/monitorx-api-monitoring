import { useEffect, useState, type AnchorHTMLAttributes } from "react";
import { Link, useInRouterContext, useLocation } from "react-router-dom";
import { RiMoonLine, RiSunLine } from "@remixicon/react";
import { Button } from "@monitorx/ui";
export function AppLink({
  href = "/",
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const routed = useInRouterContext();
  return routed && href.startsWith("/") ? (
    <ScopedRouterLink href={href} {...props} />
  ) : (
    <a href={href} {...props} />
  );
}
function ScopedRouterLink({
  href,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const location = useLocation();
  const current = new URLSearchParams(location.search);
  const target = new URL(href, window.location.origin);
  const projectId =
    /^\/app\/projects\/([^/]+)/.exec(location.pathname)?.[1] ??
    current.get("projectId");
  if (
    /^\/app\/(tests|collections|executions)\//.test(target.pathname) &&
    projectId &&
    target.searchParams.get("organizationId") ===
      current.get("organizationId") &&
    !target.searchParams.has("projectId")
  )
    target.searchParams.set("projectId", projectId);
  return <Link to={target.pathname + target.search + target.hash} {...props} />;
}
export function ThemeToggle() {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("monitorx.theme.v1", dark ? "dark" : "light");
    } catch {
      /* Theme still works without browser storage. */
    }
  }, [dark]);
  return (
    <Button
      variant="ghost"
      className="theme-toggle"
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => setDark((v) => !v)}
    >
      {dark ? <RiSunLine size={18} /> : <RiMoonLine size={18} />}
      <span>{dark ? "Light mode" : "Dark mode"}</span>
    </Button>
  );
}
export function scopedLink(
  path: string,
  organizationId: string,
  projectId?: string,
) {
  const query = new URLSearchParams({ organizationId });
  if (projectId) query.set("projectId", projectId);
  return `${path}?${query}`;
}
