import { test, expect, afterEach } from "bun:test"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"
import { tmpdir } from "./fixture/fixture"
import path from "path"
import fs from "fs/promises"
import { pathToFileURL } from "url"

afterEach(async () => {
  await Instance.disposeAll()
})

test("rejects unknown top-level config fields", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Filesystem.write(
        path.join(dir, "lite-agent-m.json"),
        JSON.stringify({ $schema: "https://opencode.ai/config.json", unknownField: "value" }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Config.get()).rejects.toThrow()
    },
  })
})

test("resolves scoped npm plugins in config", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const pluginDir = path.join(dir, "node_modules", "@scope", "plugin")
      await fs.mkdir(pluginDir, { recursive: true })
      await Filesystem.write(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "config-fixture", version: "1.0.0", type: "module" }, null, 2),
      )
      await Filesystem.write(
        path.join(pluginDir, "package.json"),
        JSON.stringify({ name: "@scope/plugin", version: "1.0.0", type: "module", main: "./index.js" }, null, 2),
      )
      await Filesystem.write(path.join(pluginDir, "index.js"), "export default {}\n")
      await Filesystem.write(
        path.join(dir, "lite-agent-m.json"),
        JSON.stringify({ $schema: "https://opencode.ai/config.json", plugin: ["@scope/plugin"] }, null, 2),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      const pluginEntries = config.plugin ?? []
      const expected = pathToFileURL(path.join(tmp.path, "node_modules", "@scope", "plugin", "index.js")).href
      expect(pluginEntries.includes(expected)).toBe(true)
    },
  })
})

test("accepts lsp config field", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Filesystem.write(
        path.join(dir, "lite-agent-m.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          lsp: { typescript: { command: ["typescript-language-server", "--stdio"] } },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.lsp).toBeDefined()
    },
  })
})

test("accepts command config field", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Filesystem.write(
        path.join(dir, "lite-agent-m.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          command: { "fix-tests": { template: "Fix all failing tests" } },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.command?.["fix-tests"]?.template).toBe("Fix all failing tests")
    },
  })
})
