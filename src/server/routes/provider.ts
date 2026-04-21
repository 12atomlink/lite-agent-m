import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { ModelsDev } from "@/provider/models"
import { mapValues } from "remeda"
import { lazy } from "@/util/lazy"

export const ProviderRoutes = lazy(() =>
  new Hono().get(
    "/",
    describeRoute({
      summary: "List providers",
      operationId: "provider.list",
      responses: {
        200: {
          description: "Providers",
          content: {
            "application/json": {
              schema: resolver(z.object({
                all: ModelsDev.Provider.array(),
                default: z.record(z.string(), z.string()),
                connected: z.array(z.string()),
              })),
            },
          },
        },
      },
    }),
    async (c) => {
      const config = await Config.get()
      const disabled = new Set(config.disabled_providers ?? [])
      const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined

      const allProviders = await ModelsDev.get()
      const filteredProviders: Record<string, (typeof allProviders)[string]> = {}
      for (const [key, value] of Object.entries(allProviders)) {
        if ((enabled ? enabled.has(key) : true) && !disabled.has(key)) {
          filteredProviders[key] = value
        }
      }

      const connected = await Provider.list()
      const providers = Object.assign(
        mapValues(filteredProviders, (x) => Provider.fromModelsDevProvider(x)),
        connected,
      )
      return c.json({
        all: Object.values(providers),
        default: mapValues(providers, (item) => Provider.sort(Object.values(item.models))[0].id),
        connected: Object.keys(connected),
      })
    },
  ),
)
