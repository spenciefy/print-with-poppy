import { interopHost } from "./interop-network.js";
import { BlockList, isIP } from "node:net";

// Check at connection time, not in a preflight lookup: DNS rebinding must not
// change the destination between validation and the TLS connection.
const blocked = new BlockList();
for (const [ip, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const)
  blocked.addSubnet(ip, bits, "ipv4");
// Only global-unicast IPv6, excluding transition/documentation ranges.
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
blocked.addSubnet("2001::", 23, "ipv6");
blocked.addSubnet("2001:db8::", 32, "ipv6");
blocked.addSubnet("2002::", 16, "ipv6");
export function publicAddress(address: string) {
  const family = isIP(address);
  return family === 4
    ? !blocked.check(address, "ipv4")
    : family === 6 &&
        globalV6.check(address, "ipv6") &&
        !blocked.check(address, "ipv6");
}
export function protocolUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    throw new Error(
      "Protocol URLs must use HTTPS without credentials or fragments.",
    );
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    (isIP(host) && !publicAddress(host))
  )
    throw new Error("Private protocol destination.");
  return url;
}

const gridAddresses = new BlockList();
gridAddresses.addSubnet("10.0.0.0", 8, "ipv4");
gridAddresses.addSubnet("172.16.0.0", 12, "ipv4");
gridAddresses.addSubnet("192.168.0.0", 16, "ipv4");
gridAddresses.addSubnet("fc00::", 7, "ipv6");
export function protocolAddressAllowed(host: string, address: string, testHosts = false) {
  if (publicAddress(address)) return true;
  const family = isIP(address);
  return testHosts && interopHost(host) && Boolean(family) &&
    gridAddresses.check(address, family === 4 ? "ipv4" : "ipv6");
}
