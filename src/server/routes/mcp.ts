import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { MCP } from "@/mcp"
import { lazy } from "@/util/lazy"

export const McpRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get MCP status",
        operationId: "mcp.status",
        responses: {
          200: { description: "MCP status", content: { "application/json": { schema: resolver(z.record(z.string(), MCP.Status)) } } },
        },
      }),
      async (c) => c.json(await MCP.status()),
    )
    .post(
      "/:name/connect",
      describeRoute({
        summary: "Connect MCP server",
        operationId: "mcp.connect",
        responses: {
          200: { description: "Connected", content: { "application/json": { schema: resolver(z.boolean()) } } },
        },
      }),
      validator("param", z.object({ name: z.string() })),
      async (c) => {
        await MCP.connect(c.req.valid("param").name)
        return c.json(true)
      },
    )
    .post(
      "/:name/disconnect",
      describeRoute({
        summary: "Disconnect MCP server",
        operationId: "mcp.disconnect",
        responses: {
          200: { description: "Disconnected", content: { "application/json": { schema: resolver(z.boolean()) } } },
        },
      }),
      validator("param", z.object({ name: z.string() })),
      async (c) => {
        await MCP.disconnect(c.req.valid("param").name)
        return c.json(true)
      },
    ),
)
