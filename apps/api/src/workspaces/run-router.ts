import { Router, type Request, type Response } from "express";
import { RunService, type TenantAccess } from "@monitorx/db";
import {
  emptyInputSchema,
  resourceIdSchema,
  type TenantContext,
} from "@monitorx/contracts";
export function runRouter(
  access: TenantAccess,
  context: (req: Request, res: Response) => TenantContext,
): Router {
  const router = Router();
  const service = new RunService(access);
  const id = (req: Request) => resourceIdSchema.parse(req.params["id"]);
  router.post("/tests/:id/run", async (req, res) => {
    res
      .status(202)
      .json(await service.submit(context(req, res), id(req), req.body));
  });
  router.post("/collections/:id/run", async (req, res) => {
    res
      .status(202)
      .json(
        await service.submitCollection(context(req, res), id(req), req.body),
      );
  });
  router.get("/runs/:id", async (req, res) => {
    res.json(await service.get(context(req, res), id(req)));
  });
  router.get("/collection-runs/:id", async (req, res) => {
    res.json(await service.group(context(req, res), id(req)));
  });
  router.post("/runs/:id/cancel", async (req, res) => {
    emptyInputSchema.parse(req.body);
    res.json(await service.cancel(context(req, res), id(req)));
  });
  router.post("/collection-runs/:id/cancel", async (req, res) => {
    emptyInputSchema.parse(req.body);
    res.json(await service.cancel(context(req, res), id(req), true));
  });
  return router;
}
