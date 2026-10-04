# Safe execution engine (Prompt 6)

Only workers may call `executeTest`. API handlers must not import this package. Inputs are a validated immutable definition plus public variables and worker-memory secrets. Results contain classified errors, independent assertion outcomes, bounded redacted metadata and a JSON preview. No arbitrary JavaScript runs.

## Outbound policy

- Only HTTP(S), no URL credentials/fragments. Every DNS answer must be public; mixed public/private answers fail closed. IPv4 special ranges, mapped/transition IPv6 and non-global IPv6 are refused.
- A validated address is pinned through Node's custom lookup; the socket peer must match. No global agent, proxy environment support or second uncontrolled lookup. Every redirect is checked again. Cross-origin redirects are conservatively refused to avoid forwarding credentials or request bodies.
- TLS certificate and hostname validation stay enabled; no tenant or environment switch disables them. Total timeout includes DNS and response reading (100–30000 ms). External cancellation aborts the socket.
- Request body cap 256 KiB, request/response headers 16 KiB, response wire and decompressed body each 1 MiB. gzip/deflate/Brotli decode under the same bound. Preview cap 64 KiB. Unsupported encodings fail safely.

## Assertions and redaction

Status, latency, headers, JSON child/index paths, scalar JSON comparisons, text, linear-time RE2 regex and absolute child-element XPath are supported. Namespace prefixes are ignored for the limited SOAP XPath subset. Entity/DOCTYPE input is rejected; XML is never fetched. Full XPath expressions, JSONPath filters, regex backreferences/lookarounds and optional JSON Schema are not supported. Regex input is capped at 64 KiB and patterns at 500 characters. Invalid assertions fail independently. Required failure means DOWN; warning failure means DEGRADED. An unasserted HTTP 4xx/5xx fails by default.

Known secrets and encoded forms are scrubbed. Sensitive headers/JSON keys/path results are masked. Raw XML/text/binary previews are omitted rather than retaining unexpected credentials; assertions still operate on bounded response content in memory. Request bodies and query values are not stored in metadata. Never place credentials in ordinary definition fields or public variables.

## Verification and boundaries

`pnpm exec vitest run tests/unit/test-engine.test.ts tests/integration/engine-transport.integration.test.ts` checks address policy, DNS rebinding, normalization, assertions, redaction, redirects, cancellation, timeout and actual disposable HTTP sockets including oversized compressed responses and invalid TLS. The internal transport fixture maps a synthetic hostname to loopback solely through test code; production has no private-target bypass.

The engine is available but not wired to API run controls until Prompt 7. No deployment egress firewall or private-agent architecture is claimed. Infrastructure isolation remains a deployment requirement.

Implementation references: [Node HTTP request options](https://nodejs.org/docs/latest-v22.x/api/http.html#httprequesturl-options-callback), [ipaddr.js address classification](https://github.com/whitequark/ipaddr.js), [RE2 WASM](https://github.com/google/re2-wasm).
