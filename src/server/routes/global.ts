import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "@/config/config"
import { errors } from "@/server/error"
import { lazy } from "@/util/lazy"

export const GlobalRoutes = lazy(() =>
  new Hono()
    .get(
      "/health",
      describeRoute({
        summary: "Health check",
        operationId: "global.health",
        responses: {
          200: {
            description: "Health",
            content: { "application/json": { schema: resolver(z.object({ healthy: z.literal(true), version: z.string() })) } },
          },
        },
      }),
      async (c) => c.json({ healthy: true as const, version: "0.1.0" }),
    )
    .get(
      "/config",
      describeRoute({
        summary: "Get global config",
        operationId: "global.config.get",
        responses: {
          200: { description: "Global config", content: { "application/json": { schema: resolver(Config.Info) } } },
        },
      }),
      async (c) => c.json(await Config.getGlobal()),
    )
    .patch(
      "/config",
      describeRoute({
        summary: "Update global config",
        operationId: "global.config.update",
        responses: {
          200: { description: "Updated config", content: { "application/json": { schema: resolver(Config.Info) } } },
          ...errors(400),
        },
      }),
      validator("json", Config.Info),
      async (c) => {
        const next = await Config.updateGlobal(c.req.valid("json"))
        return c.json(next)
      },
    ),
)
