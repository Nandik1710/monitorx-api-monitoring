import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { boundedRequest } from "../../packages/test-engine/src/transport.js";
describe("worker bounded transport on disposable local fixture (no production policy bypass)", () => {
  const server = createServer((req, res) => {
    if (req.url === "/large") return res.end(Buffer.alloc(1048577, 120));
    if (req.url === "/compressed") {
      res.setHeader("Content-Encoding", "gzip");
      return res.end(gzipSync(Buffer.alloc(1048577, 120)));
    }
    if (req.url === "/slow") return;
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/fail") res.statusCode = 500;
    res.end('{"ok":true}');
  });
  let port: number;
  beforeAll(async () => {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const addr = server.address();
    if (!addr || typeof addr === "string") throw Error("Fixture unavailable");
    port = addr.port;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const run = (path: string, protocol = "http") =>
    boundedRequest(
      {
        url: new URL(`${protocol}://fixture.test:${port}${path}`),
        method: "GET",
        headers: {},
        body: null,
      },
      { address: "127.0.0.1", family: 4 },
      AbortSignal.timeout(path === "/slow" ? 150 : 2000),
    );
  it("reads healthy and failing HTTP responses without retry", async () => {
    expect((await run("/")).status).toBe(200);
    expect((await run("/fail")).status).toBe(500);
  });
  it.each(["/large", "/compressed"])(
    "caps wire/decoded response %s",
    async (path) => {
      await expect(run(path)).rejects.toThrow();
    },
  );
  it("aborts stalled sockets", async () => {
    await expect(run("/slow")).rejects.toThrow();
  });
  it("does not downgrade invalid TLS to plaintext", async () => {
    await expect(run("/", "https")).rejects.toThrow();
  });
});
