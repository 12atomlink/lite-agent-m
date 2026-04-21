import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Permission } from "@/permission"
import { PermissionID } from "@/permission/schema"
import { errors } from "@/server/error"
import { lazy } from "@/util/lazy"

export const PermissionRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List pending permissions",
        operationId: "permission.list",
        responses: {
          200: {
            description: "List of pending permissions",
            content: { "application/json": { schema: resolver(Permission.Request.array()) } },
          },
        },
      }),
      async (c) => c.json(await Permission.list()),
    )
    .post(
      "/:requestID/reply",
      describeRoute({
        summary: "Respond to permission request",
        operationId: "permission.reply",
        responses: {
          200: {
            description: "Permission processed",
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ requestID: PermissionID.zod })),
      validator("json", z.object({ reply: Permission.Reply, message: z.string().optional() })),
      async (c) => {
        await Permission.reply({
          requestID: c.req.valid("param").requestID,
          reply: c.req.valid("json").reply,
          message: c.req.valid("json").message,
        })
        return c.json(true)
      },
    ),
)
