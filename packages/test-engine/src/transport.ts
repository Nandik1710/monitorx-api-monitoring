import http from "node:http";
import https from "node:https";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { Readable } from "node:stream";
import ipaddr from "ipaddr.js";
import type { Address } from "./policy.js";
import { EngineError, type NormalizedRequest } from "./types.js";
export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}
export type Transport = (
  request: NormalizedRequest,
  address: Address,
  signal: AbortSignal,
) => Promise<HttpResponse>;
export const RESPONSE_LIMIT = 1048576;
// Internal transport: caller must run validateDestination first. No proxy, pool or second DNS lookup.
export const boundedRequest: Transport = (input, address, signal) =>
  new Promise((resolve, reject) => {
    // A decoder may still be running after the socket has closed; abort must settle it too.
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
    const send = input.url.protocol === "https:" ? https.request : http.request;
    const req = send(
      input.url,
      {
        method: input.method,
        headers: input.headers,
        agent: false,
        signal,
        maxHeaderSize: 16384,
        rejectUnauthorized: true,
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, [address]);
          else callback(null, address.address, address.family);
        },
      },
      (res) => {
        const headers = Object.fromEntries(
          Object.entries(res.headers).map(([k, v]) => [
            k,
            Array.isArray(v) ? v.join(", ") : (v ?? ""),
          ]),
        );
        let rawSize = 0;
        let size = 0;
        const chunks: Buffer[] = [];
        const fail = (error: Error) => {
          res.destroy();
          req.destroy();
          reject(error);
        };
        res.on("data", (chunk: Buffer) => {
          rawSize += chunk.length;
          if (rawSize > RESPONSE_LIMIT) fail(new EngineError("response_error"));
        });
        res.on("error", () => reject(new EngineError("response_error")));
        const encoding = headers["content-encoding"]?.toLowerCase();
        let stream: Readable = res;
        if (encoding && encoding !== "identity") {
          const decoder =
            encoding === "gzip"
              ? createGunzip()
              : encoding === "deflate"
                ? createInflate()
                : encoding === "br"
                  ? createBrotliDecompress()
                  : null;
          if (!decoder) {
            fail(new EngineError("response_error"));
            return;
          }
          stream = res.pipe(decoder);
          signal.addEventListener("abort", () => decoder.destroy(), {
            once: true,
          });
        }
        stream.on("error", () => fail(new EngineError("response_error")));
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > RESPONSE_LIMIT) fail(new EngineError("response_error"));
          else chunks.push(chunk);
        });
        stream.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on("socket", (socket) => {
      socket.once("connect", () => {
        const remote = socket.remoteAddress;
        if (
          !remote ||
          ipaddr.process(remote).toString() !==
            ipaddr.process(address.address).toString()
        )
          req.destroy(new EngineError("configuration_error"));
      });
    });
    req.on("error", reject);
    req.end(input.body);
  });
