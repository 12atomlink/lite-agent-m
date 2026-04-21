import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { mapValues } from "remeda"
import { errors } from "@/server/error"
import { lazy } from "@/util/lazy"

export const ConfigRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get configuration",
        operationId: "config.get",
        responses: {
          200: { description: "Config", content: { "application/json": { schema: resolver(Config.Info) } } },
        },
      }),
      async (c) => c.json(await Config.get()),
    )
    .patch(
      "/",
      describeRoute({
        summary: "Update configuration",
        operationId: "config.update",
        responses: {
          200: { description: "Updated config", content: { "application/json": { schema: resolver(Config.Info) } } },
          ...errors(400),
        },
      }),
      validator("json", Config.Info),
      async (c) => {
        const config = c.req.valid("json")
        await Config.update(config)
        return c.json(config)
      },
    )
    .get(
      "/providers",
      describeRoute({
        summary: "List config providers",
        operationId: "config.providers",
        responses: {
          200: {
            description: "Providers",
            content: {
              "application/json": {
                schema: resolver(z.object({ providers: Provider.Info.array(), default: z.record(z.string(), z.string()) })),
              },
            },
          },
        },
      }),
      async (c) => {
        const providers = await Provider.list().then((x) => mapValues(x, (item) => item))
        return c.json({
          providers: Object.values(providers),
          default: mapValues(providers, (item) => Provider.sort(Object.values(item.models))[0].id),
        })
      },
    ),
)
