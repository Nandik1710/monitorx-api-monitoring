import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { EngineError } from "./types.js";
export type Address = { address: string; family: number };
export type Resolver = (hostname: string) => Promise<Address[]>;
export const resolveAddresses: Resolver = (hostname) =>
  lookup(hostname, { all: true, verbatim: true });
export function isPublicAddress(value: string): boolean {
  if (!isIP(value) || value.includes("%")) return false;
  const parsed = ipaddr.parse(value);
  if (parsed.range() !== "unicast") return false;
  // Public IPv6 is restricted to global unicast; exclude transition/special allocations.
  if (parsed.kind() === "ipv6") {
    const bytes = parsed.toByteArray();
    if ((bytes[0]! & 0xe0) !== 0x20) return false;
    for (const cidr of [
      "2001::/23",
      "2001:db8::/32",
      "2002::/16",
      "3fff::/20",
    ]) {
      const [network, bits] = ipaddr.parseCIDR(cidr);
      if (parsed.match(network, bits)) return false;
    }
  }
  return true;
}
export function validateUrl(url: URL): void {
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    url.href.length > 2048 ||
    url.hostname.includes("%")
  )
    throw new EngineError("configuration_error");
}
export async function validateDestination(
  url: URL,
  resolver: Resolver = resolveAddresses,
): Promise<Address> {
  validateUrl(url);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const records = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await resolver(host);
  if (
    !records.length ||
    records.length > 64 ||
    records.some(
      (record) =>
        !isPublicAddress(record.address) ||
        isIP(record.address) !== record.family,
    )
  )
    throw new EngineError("configuration_error");
  return records[0]!;
}
