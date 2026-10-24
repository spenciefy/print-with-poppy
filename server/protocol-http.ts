import { request } from "node:https";
import { lookup } from "node:dns";
import { allowInteropTestHosts } from "./interop-network.js";
import { protocolAddressAllowed, protocolUrl } from "./protocol-url.js";
export { publicAddress, protocolUrl } from "./protocol-url.js";
export function protocolJson(value: string): Promise<any> {
  const url = protocolUrl(value);
  const testHosts = allowInteropTestHosts(process.env);
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
                addresses.some((a) => !protocolAddressAllowed(hostname, a.address, testHosts))
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
