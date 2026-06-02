import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { MCP } from "@/mcp"
import { lazy } from "@/util/lazy"

export const McpRoutes = lazy(() =>
  new Hono()
    .get(
      "/ui-meta",
      describeRoute({
        summary: "Get MCP tools UI metadata",
        operationId: "mcp.uiMeta",
        responses: {
          200: { description: "Tools UI metadata", content: { "application/json": { schema: resolver(z.record(z.string(), z.object({ clientName: z.string(), resourceUri: z.string(), permissions: z.array(z.string()).optional(), csp: z.array(z.string()).optional() }))) } } },
        },
      }),
      async (c) => c.json(await MCP.toolsUiMeta()),
    )
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
    )
    .get(
      "/:name/ui-resource",
      describeRoute({
        summary: "Read MCP App UI resource",
        operationId: "mcp.uiResource",
        responses: {
          200: { description: "UI resource HTML and metadata", content: { "application/json": { schema: resolver(z.object({ html: z.string(), meta: z.object({ permissions: z.array(z.string()).optional(), csp: z.array(z.string()).optional() }) })) } } },
        },
      }),
      validator("param", z.object({ name: z.string() })),
      validator("query", z.object({ uri: z.string() })),
      async (c) => {
        const { name } = c.req.valid("param")
        const { uri } = c.req.valid("query")
        const result = await MCP.readUiResource(name, uri)
        return c.json(result)
      },
    )
    .post(
      "/:name/call-tool",
      describeRoute({
        summary: "Call a tool on an MCP server",
        operationId: "mcp.callTool",
        responses: {
          200: { description: "Tool result" },
        },
      }),
      validator("param", z.object({ name: z.string() })),
      validator("json", z.object({ toolName: z.string(), args: z.record(z.string(), z.unknown()).optional() })),
      async (c) => {
        const { name } = c.req.valid("param")
        const { toolName, args } = c.req.valid("json")
        const result = await MCP.callTool(name, toolName, args ?? {})
        return c.json(result)
      },
    ),
)
