import { Hono } from "hono"
import { stream } from "hono/streaming"
import { describeRoute, validator, resolver } from "hono-openapi"
import { SessionID, MessageID, PartID } from "@/session/schema"
import z from "zod"
import { Session } from "@/session"
import { MessageV2 } from "@/session/message-v2"
import { SessionPrompt } from "@/session/prompt"
import { SessionCompaction } from "@/session/compaction"
import { SessionRevert } from "@/session/revert"
import { SessionSummary } from "@/session/summary"
import { Todo } from "@/session/todo"
import { Agent } from "@/agent/agent"
import { Snapshot } from "@/snapshot"
import { ModelID, ProviderID } from "@/provider/schema"
import { errors } from "@/server/error"
import { lazy } from "@/util/lazy"

export const SessionRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List sessions",
        operationId: "session.list",
        responses: {
          200: { description: "Sessions", content: { "application/json": { schema: resolver(Session.Info.array()) } } },
        },
      }),
      validator("query", z.object({
        directory: z.string().optional(),
        roots: z.coerce.boolean().optional(),
        start: z.coerce.number().optional(),
        search: z.string().optional(),
        limit: z.coerce.number().optional(),
      })),
      async (c) => {
        const query = c.req.valid("query")
        const sessions: Session.Info[] = []
        for await (const session of Session.list(query)) sessions.push(session)
        return c.json(sessions)
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Create session",
        operationId: "session.create",
        responses: {
          200: { description: "Session", content: { "application/json": { schema: resolver(Session.Info) } } },
          ...errors(400),
        },
      }),
      validator("json", Session.create.schema.optional()),
      async (c) => c.json(await Session.create(c.req.valid("json") ?? {})),
    )
    .get(
      "/:sessionID",
      describeRoute({
        summary: "Get session",
        operationId: "session.get",
        responses: {
          200: { description: "Session", content: { "application/json": { schema: resolver(Session.Info) } } },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: Session.get.schema })),
      async (c) => c.json(await Session.get(c.req.valid("param").sessionID)),
    )
    .delete(
      "/:sessionID",
      describeRoute({
        summary: "Delete session",
        operationId: "session.delete",
        responses: {
          200: { description: "Deleted", content: { "application/json": { schema: resolver(z.boolean()) } } },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: Session.remove.schema })),
      async (c) => {
        await Session.remove(c.req.valid("param").sessionID)
        return c.json(true)
      },
    )
    .patch(
      "/:sessionID",
      describeRoute({
        summary: "Update session",
        operationId: "session.update",
        responses: {
          200: { description: "Session", content: { "application/json": { schema: resolver(Session.Info) } } },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      validator("json", z.object({ title: z.string().optional(), time: z.object({ archived: z.number().optional() }).optional() })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const updates = c.req.valid("json")
        let session = await Session.get(sessionID)
        if (updates.title !== undefined) session = await Session.setTitle({ sessionID, title: updates.title })
        if (updates.time?.archived !== undefined) session = await Session.setArchived({ sessionID, time: updates.time.archived })
        return c.json(session)
      },
    )
    .get(
      "/:sessionID/children",
      describeRoute({
        summary: "Get session children",
        operationId: "session.children",
        responses: {
          200: { description: "Children", content: { "application/json": { schema: resolver(Session.Info.array()) } } },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: Session.children.schema })),
      async (c) => c.json(await Session.children(c.req.valid("param").sessionID)),
    )
    .get(
      "/:sessionID/todo",
      describeRoute({
        summary: "Get session todos",
        operationId: "session.todo",
        responses: {
          200: { description: "Todos", content: { "application/json": { schema: resolver(Todo.Info.array()) } } },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      async (c) => c.json(await Todo.get(c.req.valid("param").sessionID)),
    )
    .post(
      "/:sessionID/fork",
      describeRoute({
        summary: "Fork session",
        operationId: "session.fork",
        responses: {
          200: { description: "Forked session", content: { "application/json": { schema: resolver(Session.Info) } } },
        },
      }),
      validator("param", z.object({ sessionID: Session.fork.schema.shape.sessionID })),
      validator("json", Session.fork.schema.omit({ sessionID: true })),
      async (c) => c.json(await Session.fork({ ...c.req.valid("json"), sessionID: c.req.valid("param").sessionID })),
    )
    .post(
      "/:sessionID/abort",
      describeRoute({
        summary: "Abort session",
        operationId: "session.abort",
        responses: {
          200: { description: "Aborted", content: { "application/json": { schema: resolver(z.boolean()) } } },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      async (c) => {
        SessionPrompt.cancel(c.req.valid("param").sessionID)
        return c.json(true)
      },
    )
    .get(
      "/:sessionID/diff",
      describeRoute({
        summary: "Get session diff",
        operationId: "session.diff",
        responses: {
          200: { description: "Diff", content: { "application/json": { schema: resolver(Snapshot.FileDiff.array()) } } },
        },
      }),
      validator("param", z.object({ sessionID: SessionSummary.diff.schema.shape.sessionID })),
      validator("query", z.object({ messageID: SessionSummary.diff.schema.shape.messageID })),
      async (c) => {
        const result = await SessionSummary.diff({
          sessionID: c.req.valid("param").sessionID,
          messageID: c.req.valid("query").messageID,
        })
        return c.json(result)
      },
    )
    .post(
      "/:sessionID/summarize",
      describeRoute({
        summary: "Summarize session",
        operationId: "session.summarize",
        responses: {
          200: { description: "OK", content: { "application/json": { schema: resolver(z.boolean()) } } },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      validator("json", z.object({ providerID: ProviderID.zod, modelID: ModelID.zod, auto: z.boolean().optional().default(false) })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const session = await Session.get(sessionID)
        await SessionRevert.cleanup(session)
        const msgs = await Session.messages({ sessionID })
        let currentAgent = await Agent.defaultAgent()
        for (let i = msgs.length - 1; i >= 0; i--) {
          const info = msgs[i].info
          if (info.role === "user") { currentAgent = info.agent || (await Agent.defaultAgent()); break }
        }
        await SessionCompaction.create({ sessionID, agent: currentAgent, model: { providerID: body.providerID, modelID: body.modelID }, auto: body.auto })
        await SessionPrompt.loop({ sessionID })
        return c.json(true)
      },
    )
    .post(
      "/:sessionID/revert",
      describeRoute({
        summary: "Revert session",
        operationId: "session.revert",
        responses: {
          200: { description: "Session", content: { "application/json": { schema: resolver(Session.Info) } } },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      validator("json", z.object({ messageID: MessageID.zod })),
      async (c) => {
        const result = await SessionRevert.revert({ sessionID: c.req.valid("param").sessionID, messageID: c.req.valid("json").messageID })
        return c.json(result)
      },
    )
    .post(
      "/:sessionID/unrevert",
      describeRoute({
        summary: "Unrevert session",
        operationId: "session.unrevert",
        responses: {
          200: { description: "Session", content: { "application/json": { schema: resolver(Session.Info) } } },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const result = await SessionRevert.unrevert({ sessionID })
        return c.json(result)
      },
    )
    .get(
      "/:sessionID/message",
      describeRoute({
        summary: "Get session messages",
        operationId: "session.messages",
        responses: {
          200: { description: "Messages", content: { "application/json": { schema: resolver(MessageV2.WithParts.array()) } } },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      validator("query", z.object({
        limit: z.coerce.number().int().min(0).optional(),
        before: z.string().optional().refine((v) => { if (!v) return true; try { MessageV2.cursor.decode(v); return true } catch { return false } }, { message: "Invalid cursor" }),
      }).refine((v) => !v.before || v.limit !== undefined, { message: "before requires limit", path: ["before"] })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const query = c.req.valid("query")
        if (query.limit === undefined || query.limit === 0) {
          await Session.get(sessionID)
          return c.json(await Session.messages({ sessionID }))
        }
        const page = await MessageV2.page({ sessionID, limit: query.limit, before: query.before })
        if (page.cursor) {
          const url = new URL(c.req.url)
          url.searchParams.set("limit", query.limit.toString())
          url.searchParams.set("before", page.cursor)
          c.header("Access-Control-Expose-Headers", "Link, X-Next-Cursor")
          c.header("Link", `<${url.toString()}>; rel="next"`)
          c.header("X-Next-Cursor", page.cursor)
        }
        return c.json(page.items)
      },
    )
    .get(
      "/:sessionID/message/:messageID",
      describeRoute({
        summary: "Get message",
        operationId: "session.message",
        responses: {
          200: { description: "Message", content: { "application/json": { schema: resolver(z.object({ info: MessageV2.Info, parts: MessageV2.Part.array() })) } } },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod, messageID: MessageID.zod })),
      async (c) => {
        const { sessionID, messageID } = c.req.valid("param")
        return c.json(await MessageV2.get({ sessionID, messageID }))
      },
    )
    .delete(
      "/:sessionID/message/:messageID",
      describeRoute({
        summary: "Delete message",
        operationId: "session.deleteMessage",
        responses: {
          200: { description: "Deleted", content: { "application/json": { schema: resolver(z.boolean()) } } },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod, messageID: MessageID.zod })),
      async (c) => {
        const { sessionID, messageID } = c.req.valid("param")
        SessionPrompt.assertNotBusy(sessionID)
        await Session.removeMessage({ sessionID, messageID })
        return c.json(true)
      },
    )
    .post(
      "/:sessionID/message",
      describeRoute({
        summary: "Send message",
        operationId: "session.prompt",
        responses: {
          200: { description: "Message", content: { "application/json": { schema: resolver(z.object({ info: MessageV2.Assistant, parts: MessageV2.Part.array() })) } } },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      validator("json", SessionPrompt.PromptInput.omit({ sessionID: true })),
      async (c) => {
        c.status(200)
        c.header("Content-Type", "application/json")
        return stream(c, async (s) => {
          const msg = await SessionPrompt.prompt({ ...c.req.valid("json"), sessionID: c.req.valid("param").sessionID })
          s.write(JSON.stringify(msg))
        })
      },
    )
    .post(
      "/:sessionID/prompt_async",
      describeRoute({
        summary: "Send async message",
        operationId: "session.prompt_async",
        responses: { 204: { description: "Accepted" }, ...errors(400, 404) },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      validator("json", SessionPrompt.PromptInput.omit({ sessionID: true })),
      async (c) => {
        c.status(204)
        c.header("Content-Type", "application/json")
        return stream(c, async () => {
          SessionPrompt.prompt({ ...c.req.valid("json"), sessionID: c.req.valid("param").sessionID })
        })
      },
    )
    .post(
      "/:sessionID/command",
      describeRoute({
        summary: "Send command",
        operationId: "session.command",
        responses: {
          200: { description: "Message", content: { "application/json": { schema: resolver(z.object({ info: MessageV2.Assistant, parts: MessageV2.Part.array() })) } } },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      validator("json", SessionPrompt.CommandInput.omit({ sessionID: true })),
      async (c) => {
        const msg = await SessionPrompt.command({ ...c.req.valid("json"), sessionID: c.req.valid("param").sessionID })
        return c.json(msg)
      },
    ),
)
