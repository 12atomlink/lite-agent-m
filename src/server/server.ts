import { Log } from "@/util/log"
import { join } from "path"
import { lazy } from "@/util/lazy"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { basicAuth } from "hono/basic-auth"
import z from "zod"
import { NamedError } from "@opencode-ai/util/error"
import { Flag } from "@/flag/flag"
import { Instance } from "@/project/instance"
import { Global } from "@/global"
import { Agent } from "@/agent/agent"
import { Skill } from "@/skill"
import { Command } from "@/command"
import { Filesystem } from "@/util/filesystem"
import { NotFoundError } from "@/storage/db"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { HTTPException } from "hono/http-exception"
import { Provider } from "@/provider/provider"
import { InstanceBootstrap } from "@/project/bootstrap"
import { GlobalRoutes } from "./routes/global"
import { SessionRoutes } from "./routes/session"
import { PermissionRoutes } from "./routes/permission"
import { QuestionRoutes } from "./routes/question"
import { ProviderRoutes } from "./routes/provider"
import { ConfigRoutes } from "./routes/config"
import { McpRoutes } from "./routes/mcp"
import { FileRoutes } from "./routes/file"
import { EventRoutes } from "./routes/event"
import { errors } from "./error"
import { describeRoute, resolver, openAPIRouteHandler } from "hono-openapi"

// @ts-ignore
globalThis.AI_SDK_LOG_WARNINGS = false

export namespace Server {
  const log = Log.create({ service: "server" })

  export const createApp = (opts: { cors?: string[] }): Hono => {
    const app = new Hono()
    return app
      .onError((err, c) => {
        log.error("failed", { error: err })
        if (err instanceof NamedError) {
          let status: ContentfulStatusCode
          if (err instanceof NotFoundError) status = 404
          else if (err instanceof Provider.ModelNotFoundError) status = 400
          else status = 500
          return c.json(err.toObject(), { status })
        }
        if (err instanceof HTTPException) return err.getResponse()
        const message = err instanceof Error && err.stack ? err.stack : err.toString()
        return c.json(new NamedError.Unknown({ message }).toObject(), { status: 500 })
      })
      .use((c, next) => {
        if (c.req.method === "OPTIONS") return next()
        const password = Flag.OPENCODE_SERVER_PASSWORD
        if (!password) return next()
        const username = Flag.OPENCODE_SERVER_USERNAME ?? "opencode"
        return basicAuth({ username, password })(c, next)
      })
      .use(async (c, next) => {
        if (c.req.path !== "/log") {
          log.info("request", { method: c.req.method, path: c.req.path })
        }
        await next()
      })
      .use(cors({
        origin(input) {
          if (!input) return
          if (input.startsWith("http://localhost:")) return input
          if (input.startsWith("http://127.0.0.1:")) return input
          if (opts?.cors?.includes(input)) return input
          return
        },
      }))
      .route("/global", GlobalRoutes())
      .use(async (c, next) => {
        if (c.req.path === "/log") return next()
        const raw = c.req.query("directory") || c.req.header("x-opencode-directory") || process.cwd()
        const directory = Filesystem.resolve((() => { try { return decodeURIComponent(raw) } catch { return raw } })())
        return Instance.provide({ directory, init: InstanceBootstrap, async fn() { return next() } })
      })
      .route("/session", SessionRoutes())
      .route("/permission", PermissionRoutes())
      .route("/question", QuestionRoutes())
      .route("/provider", ProviderRoutes())
      .route("/config", ConfigRoutes())
      .route("/mcp", McpRoutes())
      .route("/", FileRoutes())
      .route("/", EventRoutes())
      .get("/web", (c) => {
        const file = Bun.file(join(import.meta.dir, "../../web/index.html"))
        return new Response(file, { headers: { "Content-Type": "text/html" } })
      })
      .get("/web/:file", (c) => {
        const name = c.req.param("file")
        const ext = name.split(".").pop() ?? ""
        const mime: Record<string, string> = { js: "application/javascript", css: "text/css", html: "text/html" }
        const file = Bun.file(join(import.meta.dir, "../../web", name))
        return new Response(file, { headers: { "Content-Type": mime[ext] ?? "application/octet-stream" } })
      })
      .post(
        "/instance/dispose",
        describeRoute({
          summary: "Dispose instance",
          operationId: "instance.dispose",
          responses: { 200: { description: "Disposed", content: { "application/json": { schema: resolver(z.boolean()) } } } },
        }),
        async (c) => { await Instance.dispose(); return c.json(true) },
      )
      .get(
        "/path",
        describeRoute({
          summary: "Get paths",
          operationId: "path.get",
          responses: {
            200: {
              description: "Paths",
              content: {
                "application/json": {
                  schema: resolver(z.object({ home: z.string(), state: z.string(), config: z.string(), worktree: z.string(), directory: z.string() }).meta({ ref: "Path" })),
                },
              },
            },
          },
        }),
        async (c) => c.json({ home: Global.Path.home, state: Global.Path.state, config: Global.Path.config, worktree: Instance.worktree, directory: Instance.directory }),
      )
      .get(
        "/command",
        describeRoute({
          summary: "List commands",
          operationId: "command.list",
          responses: { 200: { description: "Commands", content: { "application/json": { schema: resolver(Command.Info.array()) } } } },
        }),
        async (c) => c.json(await Command.list()),
      )
      .get(
        "/agent",
        describeRoute({
          summary: "List agents",
          operationId: "app.agents",
          responses: { 200: { description: "Agents", content: { "application/json": { schema: resolver(Agent.Info.array()) } } } },
        }),
        async (c) => c.json(await Agent.list()),
      )
      .get(
        "/skill",
        describeRoute({
          summary: "List skills",
          operationId: "app.skills",
          responses: { 200: { description: "Skills", content: { "application/json": { schema: resolver(Skill.Info.array()) } } } },
        }),
        async (c) => c.json(await Skill.all()),
      )
      .post(
        "/log",
        async (c) => {
          const body = await c.req.json()
          const logger = Log.create({ service: body.service ?? "client" })
          const level = body.level ?? "info"
          if (level === "debug") logger.debug(body.message, body.extra)
          else if (level === "error") logger.error(body.message, body.extra)
          else if (level === "warn") logger.warn(body.message, body.extra)
          else logger.info(body.message, body.extra)
          return c.json(true)
        },
      )
      .get("/openapi.json", openAPIRouteHandler(app, {
        documentation: {
          info: { title: "lite-agent-m API", version: "0.0.1", description: "lite-agent-m 智能助手后端接口" },
        },
      }))
      .get("/docs", (c) => c.html(`<!DOCTYPE html>
<html>
<head>
  <title>lite-agent-m API Docs</title>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist/swagger-ui.css">
</head>
<body>
<div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist/swagger-ui-bundle.js"></script>
<script>
  SwaggerUIBundle({ url: "/openapi.json", dom_id: "#swagger-ui", presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset] })
</script>
</body>
</html>`))
  }

  export let url: URL | undefined

  const _app = lazy(() => createApp({}))
  export function Default() {
    const app = _app()
    return {
      ...app,
      fetch: (input: RequestInfo | URL, init?: RequestInit) => app.fetch(new Request(input, init)),
    }
  }

  export function listen(opts: { port: number; hostname: string; cors?: string[] }) {
    const app = createApp(opts)
    const tryServe = (port: number) => {
      try { return Bun.serve({ hostname: opts.hostname, idleTimeout: 0, fetch: app.fetch, port }) } catch { return undefined }
    }
    const server = opts.port === 0 ? (tryServe(4096) ?? tryServe(0)) : tryServe(opts.port)
    if (!server) throw new Error(`Failed to start server on port ${opts.port}`)
    url = new URL(`http://${opts.hostname}:${server.port}`)
    return server
  }
}
