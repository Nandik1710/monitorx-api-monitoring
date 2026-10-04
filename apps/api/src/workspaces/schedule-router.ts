import { Router, type Request, type Response } from "express";
import { ScheduleService, type TenantAccess } from "@monitorx/db";
import { resourceIdSchema, type TenantContext } from "@monitorx/contracts";
export function scheduleRouter(
  access: TenantAccess,
  context: (req: Request, res: Response) => TenantContext,
): Router {
  const router = Router(),
    service = new ScheduleService(access);
  router.get("/tests/:id/schedule", async (req, res) => {
    res.json(
      await service.get(
        context(req, res),
        resourceIdSchema.parse(req.params["id"]),
      ),
    );
  });
  router.post("/schedules", async (req, res) => {
    res.status(201).json(await service.create(context(req, res), req.body));
  });
  router.patch("/schedules/:id", async (req, res) => {
    res.json(
      await service.update(
        context(req, res),
        resourceIdSchema.parse(req.params["id"]),
        req.body,
      ),
    );
  });
  return router;
}
