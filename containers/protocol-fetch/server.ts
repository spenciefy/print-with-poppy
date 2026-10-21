import { createServer } from "node:http";
import { protocolJson } from "../../server/protocol-http.js";
let active = 0;
createServer(async (req, res) => {
  if (req.url === "/health") {
    res.end("ok");
    return;
  }
  if (req.method !== "POST" || req.url !== "/json") {
    res.writeHead(404).end();
    return;
  }
  if (active >= 8) {
    res.writeHead(503).end();
    return;
  }
  active++;
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 8192) throw new Error();
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (typeof body.url !== "string" || body.url.length > 4096)
      throw new Error();
    const result = await protocolJson(body.url);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(result));
  } catch {
    res.writeHead(502).end('{"error":"metadata_unavailable"}');
  } finally {
    active--;
  }
}).listen(8080, "0.0.0.0");
