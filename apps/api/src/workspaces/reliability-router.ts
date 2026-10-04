import { Router, type Request, type Response } from "express";
import { ReliabilityService, type TenantAccess } from "@monitorx/db";
import { resourceIdSchema, type TenantContext } from "@monitorx/contracts";
export function reliabilityRouter(
  access: TenantAccess,
  context: (req: Request, res: Response) => TenantContext,
): Router {
  const router = Router(),
    service = new ReliabilityService(access);
  for (const kind of ["projects", "collections", "tests"] as const) {
    router.get(`/${kind}/:id/executions`, async (req, res) => {
      res.json(
        await service.history(
          context(req, res),
          kind,
          resourceIdSchema.parse(req.params["id"]),
          req.query,
        ),
      );
    });
    router.get(`/${kind}/:id/dashboard`, async (req, res) => {
      res.json(
        await service.dashboard(
          context(req, res),
          kind,
          resourceIdSchema.parse(req.params["id"]),
          req.query,
        ),
      );
    });
  }
  router.get("/executions/:id", async (req, res) => {
    res.json(
      await service.detail(
        context(req, res),
        resourceIdSchema.parse(req.params["id"]),
      ),
    );
  });
  return router;
}
