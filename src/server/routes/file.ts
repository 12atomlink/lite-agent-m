import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { File } from "@/file"
import { Ripgrep } from "@/file/ripgrep"
import { Instance } from "@/project/instance"
import { lazy } from "@/util/lazy"

export const FileRoutes = lazy(() =>
  new Hono()
    .get(
      "/find",
      describeRoute({
        summary: "Find text",
        operationId: "find.text",
        responses: {
          200: { description: "Matches", content: { "application/json": { schema: resolver(Ripgrep.Match.shape.data.array()) } } },
        },
      }),
      validator("query", z.object({ pattern: z.string() })),
      async (c) => {
        const result = await Ripgrep.search({ cwd: Instance.directory, pattern: c.req.valid("query").pattern, limit: 10 })
        return c.json(result)
      },
    )
    .get(
      "/find/file",
      describeRoute({
        summary: "Find files",
        operationId: "find.files",
        responses: {
          200: { description: "File paths", content: { "application/json": { schema: resolver(z.string().array()) } } },
        },
      }),
      validator("query", z.object({
        query: z.string(),
        dirs: z.enum(["true", "false"]).optional(),
        type: z.enum(["file", "directory"]).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      })),
      async (c) => {
        const q = c.req.valid("query")
        return c.json(await File.search({ query: q.query, limit: q.limit ?? 10, dirs: q.dirs !== "false", type: q.type }))
      },
    )
    .get(
      "/file",
      describeRoute({
        summary: "List files",
        operationId: "file.list",
        responses: {
          200: { description: "Files", content: { "application/json": { schema: resolver(File.Node.array()) } } },
        },
      }),
      validator("query", z.object({ path: z.string() })),
      async (c) => c.json(await File.list(c.req.valid("query").path)),
    )
    .get(
      "/file/content",
      describeRoute({
        summary: "Read file",
        operationId: "file.read",
        responses: {
          200: { description: "File content", content: { "application/json": { schema: resolver(File.Content) } } },
        },
      }),
      validator("query", z.object({ path: z.string() })),
      async (c) => c.json(await File.read(c.req.valid("query").path)),
    ),
)
