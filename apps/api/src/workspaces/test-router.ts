import { Router, type Request, type Response } from "express";
import {
  CollectionService,
  TestDefinitionService,
  type TenantAccess,
} from "@monitorx/db";
import {
  resourceIdSchema,
  emptyInputSchema,
  type TenantContext,
} from "@monitorx/contracts";

// Mounted ONLY after the workspace authentication, CSRF and rate-limit middleware.
export function testRouter(
  access: TenantAccess,
  context: (req: Request, res: Response) => TenantContext,
): Router {
  const router = Router();
  const collections = new CollectionService(access);
  const tests = new TestDefinitionService(access);
  const id = (req: Request) => resourceIdSchema.parse(req.params["id"]);
  router.get("/collections", async (req, res) => {
    res.json(await collections.list(context(req, res), req.query));
  });
  router.post("/collections", async (req, res) => {
    res.status(201).json(await collections.create(context(req, res), req.body));
  });
  router.get("/collections/:id", async (req, res) => {
    res.json(await collections.get(context(req, res), id(req)));
  });
  router.patch("/collections/:id", async (req, res) => {
    res.json(await collections.update(context(req, res), id(req), req.body));
  });
  router.delete("/collections/:id", async (req, res) => {
    emptyInputSchema.parse(req.body);
    await collections.remove(context(req, res), id(req));
    res.status(204).end();
  });
  router.get("/tests", async (req, res) => {
    res.json(await tests.list(context(req, res), req.query));
  });
  router.post("/tests", async (req, res) => {
    res.status(201).json(await tests.create(context(req, res), req.body));
  });
  router.post("/tests/preview", async (req, res) => {
    res.json(await tests.preview(context(req, res), req.body));
  });
  router.get("/tests/:id", async (req, res) => {
    res.json(await tests.get(context(req, res), id(req)));
  });
  router.patch("/tests/:id", async (req, res) => {
    res.json(await tests.update(context(req, res), id(req), req.body));
  });
  router.delete("/tests/:id", async (req, res) => {
    await tests.remove(context(req, res), id(req), req.body);
    res.status(204).end();
  });
  return router;
}
