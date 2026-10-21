import { request } from "node:https";
import { lookup } from "node:dns";
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
export function protocolJson(value: string): Promise<any> {
  const url = protocolUrl(value);
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "GET",
        agent: false,
        signal: AbortSignal.timeout(5000),
        lookup: (hostname, options, callback) => {
          lookup(
            hostname,
            { all: true, verbatim: true },
            (error, addresses) => {
              if (error) return callback(error, [] as any);
              if (
                !addresses.length ||
                addresses.some((a) => !publicAddress(a.address))
              )
                return callback(
                  new Error("Private protocol destination."),
                  [] as any,
                );
              if (options.all) callback(null, addresses as any);
              else callback(null, addresses[0].address, addresses[0].family);
            },
          );
        },
      },
      (res) => {
        // Never follow redirects, including to another public host.
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          res.destroy();
          reject(new Error("Protocol metadata request failed."));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 65536)
            res.destroy(new Error("Protocol metadata too large."));
          else chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}
