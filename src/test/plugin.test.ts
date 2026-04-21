import { afterEach, test, expect } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"
import { Plugin } from "../plugin"
import { tmpdir } from "./fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

test("plugin receives non-undefined client and correct serverUrl", async () => {
  await using tmp = await tmpdir({ git: true })

  const captureFile = path.join(tmp.path, "plugin-capture.json")
  const pluginFile = path.join(tmp.path, "test-plugin.mjs")

  await Filesystem.write(
    pluginFile,
    `import { writeFileSync } from "fs"
export default async function plugin(input) {
  writeFileSync(${JSON.stringify(captureFile)}, JSON.stringify({
    hasClient: input.client != null,
    serverUrl: input.serverUrl?.href ?? null,
  }))
  return {}
}
`,
  )

  await Filesystem.write(
    path.join(tmp.path, "lite-agent-m.json"),
    JSON.stringify({ plugin: [pathToFileURL(pluginFile).href] }),
  )

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Plugin.init()
      const captured = JSON.parse(await Bun.file(captureFile).text())
      expect(captured.hasClient).toBe(true)
      expect(captured.serverUrl).toMatch(/^http:\/\/localhost/)
    },
  })
})
