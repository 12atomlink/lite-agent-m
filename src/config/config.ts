import { Log } from "../util/log"
import path from "path"
import { pathToFileURL } from "url"
import { createRequire } from "module"
import os from "os"
import z from "zod"
import { ModelsDev } from "../provider/models"
import { mergeDeep, pipe } from "remeda"
import { Global } from "../global"
import fs from "fs/promises"
import { lazy } from "../util/lazy"
import { NamedError } from "@opencode-ai/util/error"
import { Flag } from "../flag/flag"
import { Auth } from "../auth"
import { applyEdits, modify, parse as parseJsonc, printParseErrorCode, type ParseError as JsoncParseError } from "jsonc-parser"
import { Instance } from "../project/instance"
import { existsSync } from "fs"
import { iife } from "@/util/iife"
import { ConfigPaths } from "./paths"
import { Filesystem } from "@/util/filesystem"

export namespace Config {
  const ModelId = z.string().meta({ $ref: "https://models.dev/model-schema.json#/$defs/Model" })

  const log = Log.create({ service: "config" })

  // Custom merge function that concatenates array fields instead of replacing them
  function mergeConfigConcatArrays(target: Info, source: Info): Info {
    const merged = mergeDeep(target, source)
    if (target.instructions && source.instructions) {
      merged.instructions = Array.from(new Set([...target.instructions, ...source.instructions]))
    }
    return merged
  }

  export const state = Instance.state(async () => {
    const auth = await Auth.all()

    // Config loading order (low -> high precedence):
    // 1) Remote .well-known/opencode (org defaults)
    // 2) Global config (~/.config/lite-agent-m/lite-agent-m.json{,c})
    // 3) Custom config (OPENCODE_CONFIG)
    // 4) Project config (lite-agent-m.json{,c})
    // 5) Inline config (OPENCODE_CONFIG_CONTENT)
    let result: Info = {}
    for (const [key, value] of Object.entries(auth)) {
      if (value.type === "wellknown") {
        const url = key.replace(/\/+$/, "")
        process.env[value.key] = value.token
        log.debug("fetching remote config", { url: `${url}/.well-known/opencode` })
        const response = await fetch(`${url}/.well-known/opencode`)
        if (!response.ok) {
          throw new Error(`failed to fetch remote config from ${url}: ${response.status}`)
        }
        const wellknown = (await response.json()) as any
        const remoteConfig = wellknown.config ?? {}
        if (!remoteConfig.$schema) remoteConfig.$schema = "https://opencode.ai/config.json"
        result = mergeConfigConcatArrays(
          result,
          await load(JSON.stringify(remoteConfig), {
            dir: path.dirname(`${url}/.well-known/opencode`),
            source: `${url}/.well-known/opencode`,
          }),
        )
        log.debug("loaded remote config from well-known", { url })
      }
    }

    // Global user config overrides remote config.
    result = mergeConfigConcatArrays(result, await global())

    // Custom config path overrides global config.
    if (Flag.OPENCODE_CONFIG) {
      result = mergeConfigConcatArrays(result, await loadFile(Flag.OPENCODE_CONFIG))
      log.debug("loaded custom config", { path: Flag.OPENCODE_CONFIG })
    }

    // Project config overrides global and remote config.
    if (!Flag.OPENCODE_DISABLE_PROJECT_CONFIG) {
      for (const file of await ConfigPaths.projectFiles("lite-agent-m", Instance.directory, Instance.worktree)) {
        result = mergeConfigConcatArrays(result, await loadFile(file))
      }
    }

    // Inline config content overrides all non-managed config sources.
    if (process.env.OPENCODE_CONFIG_CONTENT) {
      result = mergeConfigConcatArrays(
        result,
        await load(process.env.OPENCODE_CONFIG_CONTENT, {
          dir: Instance.directory,
          source: "OPENCODE_CONFIG_CONTENT",
        }),
      )
      log.debug("loaded custom config from OPENCODE_CONFIG_CONTENT")
    }

    if (!result.username) result.username = os.userInfo().username

    return {
      config: result,
    }
  })

  export const Provider = ModelsDev.Provider.partial()
    .extend({
      whitelist: z.array(z.string()).optional(),
      blacklist: z.array(z.string()).optional(),
      models: z
        .record(
          z.string(),
          ModelsDev.Model.partial().extend({
            variants: z
              .record(
                z.string(),
                z
                  .object({
                    disabled: z.boolean().optional().describe("Disable this variant for the model"),
                  })
                  .catchall(z.any()),
              )
              .optional()
              .describe("Variant-specific configuration"),
          }),
        )
        .optional(),
      options: z
        .object({
          apiKey: z.string().optional(),
          baseURL: z.string().optional(),
          timeout: z
            .union([
              z.number().int().positive(),
              z.literal(false),
            ])
            .optional()
            .describe("Timeout in milliseconds for requests to this provider. Set to false to disable."),
          chunkTimeout: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("Timeout in milliseconds between streamed SSE chunks for this provider."),
        })
        .catchall(z.any())
        .optional(),
    })
    .strict()
    .meta({
      ref: "ProviderConfig",
    })
  export type Provider = z.infer<typeof Provider>

  export const McpLocal = z
    .object({
      type: z.literal("local"),
      command: z.string().array(),
      environment: z.record(z.string(), z.string()).optional(),
      enabled: z.boolean().optional(),
      timeout: z.number().int().positive().optional(),
    })
    .strict()
    .meta({ ref: "McpLocalConfig" })

  export const McpOAuth = z
    .object({
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
      scope: z.string().optional(),
    })
    .strict()
    .meta({ ref: "McpOAuthConfig" })
  export type McpOAuth = z.infer<typeof McpOAuth>

  export const McpRemote = z
    .object({
      type: z.literal("remote"),
      url: z.string(),
      enabled: z.boolean().optional(),
      headers: z.record(z.string(), z.string()).optional(),
      oauth: z.union([McpOAuth, z.literal(false)]).optional(),
      timeout: z.number().int().positive().optional(),
    })
    .strict()
    .meta({ ref: "McpRemoteConfig" })

  export const Mcp = z.discriminatedUnion("type", [McpLocal, McpRemote])
  export type Mcp = z.infer<typeof Mcp>

  export const PermissionAction = z.enum(["ask", "allow", "deny"]).meta({ ref: "PermissionActionConfig" })
  export type PermissionAction = z.infer<typeof PermissionAction>

  export const PermissionObject = z.record(z.string(), PermissionAction).meta({ ref: "PermissionObjectConfig" })
  export type PermissionObject = z.infer<typeof PermissionObject>

  export const PermissionRule = z.union([PermissionAction, PermissionObject]).meta({ ref: "PermissionRuleConfig" })
  export type PermissionRule = z.infer<typeof PermissionRule>

  const permissionPreprocess = (val: unknown) => {
    if (typeof val === "object" && val !== null && !Array.isArray(val)) {
      return { __originalKeys: Object.keys(val), ...val }
    }
    return val
  }

  const permissionTransform = (x: unknown): Record<string, PermissionRule> => {
    if (typeof x === "string") return { "*": x as PermissionAction }
    const obj = x as { __originalKeys?: string[] } & Record<string, unknown>
    const { __originalKeys, ...rest } = obj
    if (!__originalKeys) return rest as Record<string, PermissionRule>
    const result: Record<string, PermissionRule> = {}
    for (const key of __originalKeys) {
      if (key in rest) result[key] = rest[key] as PermissionRule
    }
    return result
  }

  export const Permission = z
    .preprocess(
      permissionPreprocess,
      z
        .object({
          __originalKeys: z.string().array().optional(),
          read: PermissionRule.optional(),
          edit: PermissionRule.optional(),
          glob: PermissionRule.optional(),
          grep: PermissionRule.optional(),
          list: PermissionRule.optional(),
          bash: PermissionRule.optional(),
          task: PermissionRule.optional(),
          external_directory: PermissionRule.optional(),
          todowrite: PermissionAction.optional(),
          todoread: PermissionAction.optional(),
          question: PermissionAction.optional(),
          webfetch: PermissionAction.optional(),
          websearch: PermissionAction.optional(),
          codesearch: PermissionAction.optional(),
          lsp: PermissionRule.optional(),
          doom_loop: PermissionAction.optional(),
          skill: PermissionRule.optional(),
        })
        .catchall(PermissionRule)
        .or(PermissionAction),
    )
    .transform(permissionTransform)
    .meta({ ref: "PermissionConfig" })
  export type Permission = z.infer<typeof Permission>

  export const Agent = z
    .object({
      model: ModelId.optional(),
      variant: z.string().optional(),
      temperature: z.number().optional(),
      top_p: z.number().optional(),
      prompt: z.string().optional(),
      tools: z.record(z.string(), z.boolean()).optional(),
      disable: z.boolean().optional(),
      description: z.string().optional(),
      mode: z.enum(["subagent", "primary", "all"]).optional(),
      hidden: z.boolean().optional(),
      options: z.record(z.string(), z.any()).optional(),
      color: z.string().optional(),
      steps: z.number().int().positive().optional(),
      maxSteps: z.number().int().positive().optional(),
      permission: Permission.optional(),
    })
    .catchall(z.any())
    .transform((agent) => {
      const knownKeys = new Set(["name","model","variant","prompt","description","temperature","top_p","mode","hidden","color","steps","maxSteps","options","permission","disable","tools"])
      const options: Record<string, unknown> = { ...agent.options }
      for (const [key, value] of Object.entries(agent)) {
        if (!knownKeys.has(key)) options[key] = value
      }
      const permission: Permission = {}
      for (const [tool, enabled] of Object.entries(agent.tools ?? {})) {
        const action = enabled ? "allow" : "deny"
        if (tool === "write" || tool === "edit" || tool === "patch" || tool === "multiedit") {
          permission.edit = action
        } else {
          permission[tool] = action
        }
      }
      Object.assign(permission, agent.permission)
      const steps = agent.steps ?? agent.maxSteps
      return { ...agent, options, permission, steps } as typeof agent & {
        options?: Record<string, unknown>
        permission?: Permission
        steps?: number
      }
    })
    .meta({ ref: "AgentConfig" })
  export type Agent = z.infer<typeof Agent>

  export const Skills = z.object({
    paths: z.array(z.string()).optional(),
    urls: z.array(z.string()).optional(),
  })
  export type Skills = z.infer<typeof Skills>

  export const Command = z.object({
    template: z.string(),
    description: z.string().optional(),
    agent: z.string().optional(),
    model: ModelId.optional(),
    subtask: z.boolean().optional(),
  })
  export type Command = z.infer<typeof Command>

  export const Info = z
    .object({
      $schema: z.string().optional(),
      logLevel: Log.Level.optional(),
      disabled_providers: z.array(z.string()).optional(),
      enabled_providers: z.array(z.string()).optional(),
      model: ModelId.optional(),
      small_model: ModelId.optional(),
      default_agent: z.string().optional(),
      username: z.string().optional(),
      provider: z.record(z.string(), Provider).optional(),
      instructions: z.array(z.string()).optional(),
      plugin: z.string().array().optional(),
      command: z.record(z.string(), Command).optional(),
      skills: Skills.optional(),
      snapshot: z.boolean().optional().describe("Enable or disable snapshot tracking. When false, filesystem snapshots are not recorded and undoing or reverting will not undo/redo file changes. Defaults to true."),
      watcher: z.object({ ignore: z.array(z.string()).optional() }).optional(),
      mcp: z.record(z.string(), z.union([Mcp, z.object({ enabled: z.boolean() }).strict()])).optional(),
      permission: Permission.optional(),
      agent: z.object({
        plan: Agent.optional(),
        build: Agent.optional(),
        general: Agent.optional(),
        explore: Agent.optional(),
        title: Agent.optional(),
        summary: Agent.optional(),
        compaction: Agent.optional(),
      }).catchall(Agent).optional(),
      compaction: z.object({
        auto: z.boolean().optional(),
        prune: z.boolean().optional(),
        reserved: z.number().int().min(0).optional(),
      }).optional(),
      experimental: z.object({
        disable_paste_summary: z.boolean().optional(),
        batch_tool: z.boolean().optional(),
        openTelemetry: z.boolean().optional(),
        primary_tools: z.array(z.string()).optional(),
        continue_loop_on_deny: z.boolean().optional(),
        mcp_timeout: z.number().int().positive().optional(),
      }).optional(),
      formatter: z.union([
        z.literal(false),
        z.record(z.string(), z.object({
          disabled: z.boolean().optional(),
          command: z.array(z.string()).optional(),
          environment: z.record(z.string(), z.string()).optional(),
          extensions: z.array(z.string()).optional(),
        })),
      ]).optional(),
      lsp: z.union([
        z.literal(false),
        z.record(z.string(), z.union([
          z.object({ disabled: z.literal(true) }),
          z.object({
            command: z.array(z.string()),
            extensions: z.array(z.string()).optional(),
            disabled: z.boolean().optional(),
            env: z.record(z.string(), z.string()).optional(),
            initialization: z.record(z.string(), z.any()).optional(),
          }),
        ])),
      ]).optional(),
    })
    .strict()
    .meta({
      ref: "Config",
    })

  export type Info = z.output<typeof Info>

  export const global = lazy(async () => {
    let result: Info = pipe(
      {},
      mergeDeep(await loadFile(path.join(Global.Path.config, "config.json"))),
      mergeDeep(await loadFile(path.join(Global.Path.config, "lite-agent-m.json"))),
      mergeDeep(await loadFile(path.join(Global.Path.config, "lite-agent-m.jsonc"))),
    )

    const legacy = path.join(Global.Path.config, "config")
    if (existsSync(legacy)) {
      await import(pathToFileURL(legacy).href, {
        with: {
          type: "toml",
        },
      })
        .then(async (mod) => {
          const { provider, model, ...rest } = mod.default
          if (provider && model) result.model = `${provider}/${model}`
          result["$schema"] = "https://opencode.ai/config.json"
          result = mergeDeep(result, rest)
          await Filesystem.writeJson(path.join(Global.Path.config, "config.json"), result)
          await fs.unlink(legacy)
        })
        .catch(() => {})
    }

    return result
  })

  export const { readFile } = ConfigPaths

  async function loadFile(filepath: string): Promise<Info> {
    log.info("loading", { path: filepath })
    const text = await readFile(filepath)
    if (!text) return {}
    return load(text, { path: filepath })
  }

  async function load(text: string, options: { path: string } | { dir: string; source: string }) {
    const original = text
    const source = "path" in options ? options.path : options.source
    const isFile = "path" in options
    const data = await ConfigPaths.parseText(
      text,
      "path" in options ? options.path : { source: options.source, dir: options.dir },
    )

    const normalized = iife(() => {
      if (!data || typeof data !== "object" || Array.isArray(data)) return data
      const copy = { ...(data as Record<string, unknown>) }
      const hadLegacy = "theme" in copy || "keybinds" in copy || "tui" in copy
      if (!hadLegacy) return copy
      delete copy.theme
      delete copy.keybinds
      delete copy.tui
      log.warn("tui keys in opencode config are deprecated; move them to tui.json", { path: source })
      return copy
    })

    const parsed = Info.safeParse(normalized)
    if (parsed.success) {
      if (!parsed.data.$schema && isFile) {
        parsed.data.$schema = "https://opencode.ai/config.json"
        const updated = original.replace(/^\s*\{/, '{\n  "$schema": "https://opencode.ai/config.json",')
        await Filesystem.write(options.path, updated).catch(() => {})
      }
      const data = parsed.data
      if (data.plugin && isFile) {
        for (let i = 0; i < data.plugin.length; i++) {
          const plugin = data.plugin[i]
          try {
            data.plugin[i] = import.meta.resolve!(plugin, (options as { path: string }).path)
          } catch {
            try {
              const require = createRequire((options as { path: string }).path)
              data.plugin[i] = pathToFileURL(require.resolve(plugin)).href
            } catch {
              // plugin might be a generic string identifier
            }
          }
        }
      }
      return data
    }

    throw new InvalidError({
      path: source,
      issues: parsed.error.issues,
    })
  }

  export const { JsonError, InvalidError } = ConfigPaths

  export const ConfigDirectoryTypoError = NamedError.create(
    "ConfigDirectoryTypoError",
    z.object({
      path: z.string(),
      dir: z.string(),
      suggestion: z.string(),
    }),
  )

  export async function get() {
    return state().then((x) => x.config)
  }

  export async function getGlobal() {
    return global()
  }

  export async function update(config: Info) {
    const filepath = path.join(Instance.directory, "config.json")
    const existing = await loadFile(filepath)
    await Filesystem.writeJson(filepath, mergeDeep(existing, config))
    await Instance.dispose()
  }

  function globalConfigFile() {
    const candidates = ["lite-agent-m.jsonc", "lite-agent-m.json", "config.json"].map((file) =>
      path.join(Global.Path.config, file),
    )
    for (const file of candidates) {
      if (existsSync(file)) return file
    }
    return candidates[0]
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value)
  }

  function patchJsonc(input: string, patch: unknown, path: string[] = []): string {
    if (!isRecord(patch)) {
      const edits = modify(input, path, patch, {
        formattingOptions: {
          insertSpaces: true,
          tabSize: 2,
        },
      })
      return applyEdits(input, edits)
    }

    return Object.entries(patch).reduce((result, [key, value]) => {
      if (value === undefined) return result
      return patchJsonc(result, value, [...path, key])
    }, input)
  }

  function parseConfig(text: string, filepath: string): Info {
    const errors: JsoncParseError[] = []
    const data = parseJsonc(text, errors, { allowTrailingComma: true })
    if (errors.length) {
      const lines = text.split("\n")
      const errorDetails = errors
        .map((e) => {
          const beforeOffset = text.substring(0, e.offset).split("\n")
          const line = beforeOffset.length
          const column = beforeOffset[beforeOffset.length - 1].length + 1
          const problemLine = lines[line - 1]

          const error = `${printParseErrorCode(e.error)} at line ${line}, column ${column}`
          if (!problemLine) return error

          return `${error}\n   Line ${line}: ${problemLine}\n${"".padStart(column + 9)}^`
        })
        .join("\n")

      throw new JsonError({
        path: filepath,
        message: `\n--- JSONC Input ---\n${text}\n--- Errors ---\n${errorDetails}\n--- End ---`,
      })
    }

    const parsed = Info.safeParse(data)
    if (parsed.success) return parsed.data

    throw new InvalidError({
      path: filepath,
      issues: parsed.error.issues,
    })
  }

  export async function updateGlobal(config: Info) {
    const filepath = globalConfigFile()
    const before = await Filesystem.readText(filepath).catch((err: any) => {
      if (err.code === "ENOENT") return "{}"
      throw new JsonError({ path: filepath }, { cause: err })
    })

    const next = await (async () => {
      if (!filepath.endsWith(".jsonc")) {
        const existing = parseConfig(before, filepath)
        const merged = mergeDeep(existing, config)
        await Filesystem.writeJson(filepath, merged)
        return merged
      }

      const updated = patchJsonc(before, config)
      const merged = parseConfig(updated, filepath)
      await Filesystem.write(filepath, updated)
      return merged
    })()

    global.reset()
    void Instance.disposeAll().catch(() => undefined)

    return next
  }

  export async function directories(): Promise<string[]> {
    return ConfigPaths.directories(Instance.directory, Instance.worktree)
  }

  export async function waitForDependencies(): Promise<void> {
    // No-op: we have no npm-installed plugins/commands to wait for
  }
}
