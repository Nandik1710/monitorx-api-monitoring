import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { resourceIdSchema } from "@monitorx/contracts";
import type { AuthService } from "./auth/service.js";
import { cookieNames, type AuthConfig } from "./auth/config.js";

export function attachLiveEvents(
  server: Server,
  auth: AuthService,
  config: AuthConfig,
) {
  const gateway = new WebSocketServer({
    noServer: true,
    maxPayload: 1024,
    perMessageDeflate: false,
  });
  server.on("upgrade", (req, socket, head) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (
        url.pathname !== "/api/v1/events" ||
        req.headers.origin !== config.APP_BASE_URL ||
        gateway.clients.size >= 200
      )
        throw Error("Denied");
      const organizationId = resourceIdSchema.parse(
        url.searchParams.get("organizationId"),
      );
      const rawCursor = url.searchParams.get("after") ?? "0";
      if (!/^\d{1,19}$/.test(rawCursor)) throw Error("Denied");
      let cursor = BigInt(rawCursor);
      const token =
        req.headers.cookie
          ?.split(";")
          .map((v) => v.trim())
          .find((v) => v.startsWith(`${cookieNames.access}=`))
          ?.slice(cookieNames.access.length + 1) ?? "";
      const authorized = async () => {
        const user = await auth.authenticate(token);
        const membership = await auth.db.membership.findFirst({
          where: { organizationId, userId: user.id, status: "ACTIVE" },
          select: { id: true },
        });
        if (!membership) throw Error("Denied");
      };
      await authorized();
      gateway.handleUpgrade(req, socket, head, (ws) => {
        let busy = false;
        const poll = async () => {
          if (busy || ws.readyState !== WebSocket.OPEN) return;
          busy = true;
          try {
            await authorized();
            if (ws.bufferedAmount > 65536) {
              ws.close(1008, "Slow consumer");
              return;
            }
            const events = await auth.db.executionEvent.findMany({
              where: { organizationId, id: { gt: cursor } },
              orderBy: { id: "asc" },
              take: 100,
              include: {
                execution: {
                  select: {
                    testId: true,
                    status: true,
                    runKind: true,
                    latencyMs: true,
                    httpStatus: true,
                  },
                },
              },
            });
            for (const event of events) {
              ws.send(
                JSON.stringify({
                  id: String(event.id),
                  type: event.type,
                  executionId: event.executionId,
                  createdAt: event.createdAt,
                  ...event.execution,
                }),
              );
              cursor = event.id;
            }
          } catch {
            ws.close(1008, "Authentication or event stream unavailable");
          } finally {
            busy = false;
          }
        };
        const interval = setInterval(() => void poll(), 1000);
        ws.on("close", () => clearInterval(interval));
        ws.on("error", () => clearInterval(interval));
        ws.on("message", () => ws.close(1008, "Read-only stream"));
        void poll();
      });
    })().catch(() => {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
    });
  });
  return gateway;
}
