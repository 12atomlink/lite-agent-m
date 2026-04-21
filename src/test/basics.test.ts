import { describe, test, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"

describe("Global", () => {
  test("paths are initialized and directories exist", async () => {
    const { Global } = await import("../global/index")
    expect(Global.Path.data).toContain("lite-agent-m")
    expect(Global.Path.log).toContain("lite-agent-m")
    const stat = await fs.stat(Global.Path.log)
    expect(stat.isDirectory()).toBe(true)
  })
})

describe("Filesystem", () => {
  test("write and readText roundtrip", async () => {
    const { Filesystem } = await import("../util/filesystem")
    const { Global } = await import("../global/index")
    const p = path.join(Global.Path.cache, "test-fs.txt")
    await Filesystem.write(p, "hello lite-agent")
    const content = await Filesystem.readText(p)
    expect(content).toBe("hello lite-agent")
    await fs.unlink(p)
  })

  test("exists returns false for missing file", async () => {
    const { Filesystem } = await import("../util/filesystem")
    expect(await Filesystem.exists("/tmp/__no_such_file__")).toBe(false)
  })
})

describe("Glob", () => {
  test("scan finds files matching pattern", async () => {
    const { Glob } = await import("../util/glob")
    const files = await Glob.scan("**/*.ts", { cwd: "/workspace/lite-agent-m/src/util", absolute: true, include: "file" })
    expect(files.length).toBeGreaterThan(0)
    expect(files.every((f) => f.endsWith(".ts"))).toBe(true)
  })
})

describe("Log", () => {
  test("logger can be created and logs without throwing", async () => {
    const { Log } = await import("../util/log")
    await Log.init({ print: true })
    const log = Log.create({ service: "test" })
    expect(() => log.info("test message", { key: "val" })).not.toThrow()
    expect(() => log.debug("debug msg")).not.toThrow()
    expect(() => log.warn("warn msg")).not.toThrow()
    expect(() => log.error("error msg")).not.toThrow()
  })
})

describe("Identifier", () => {
  test("ascending IDs have correct prefix", async () => {
    const { Identifier } = await import("../id/id")
    const id = Identifier.ascending("session")
    expect(id.startsWith("ses_")).toBe(true)
  })

  test("descending IDs have correct prefix", async () => {
    const { Identifier } = await import("../id/id")
    const id = Identifier.descending("message")
    expect(id.startsWith("msg_")).toBe(true)
  })

  test("ascending IDs are monotonically increasing", async () => {
    const { Identifier } = await import("../id/id")
    const ids = Array.from({ length: 5 }, () => Identifier.ascending("session"))
    const sorted = [...ids].sort()
    expect(ids).toEqual(sorted)
  })

  test("timestamp preserves relative ordering (used for cutoff comparisons)", async () => {
    const { Identifier } = await import("../id/id")
    const id1 = Identifier.ascending("session")
    await new Promise((r) => setTimeout(r, 5))
    const id2 = Identifier.ascending("session")
    expect(Identifier.timestamp(id1)).toBeLessThan(Identifier.timestamp(id2))
  })
})
