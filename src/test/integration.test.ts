import { describe, test, expect } from "bun:test"
import path from "path"
import os from "os"
import fs from "fs/promises"
import { BusEvent } from "../bus/bus-event"
import z from "zod"

describe("Instance + Project + Bus integration", () => {
  test("Instance.provide bootstraps project context from a git directory", async () => {
    const { Instance } = await import("../project/instance")

    // /workspace/lite-agent-m itself is not a git repo, use /workspace/opencode which is
    const dir = "/workspace/opencode"
    let projectId: string | undefined

    await Instance.provide({
      directory: dir,
      fn: () => {
        projectId = Instance.project.id
        expect(Instance.directory).toBe(dir)
      },
    })

    expect(projectId).toBeDefined()
  })

  test("Bus.publish/subscribe works within Instance context", async () => {
    const { Instance } = await import("../project/instance")
    const { Bus } = await import("../bus/index")

    const TestEvent = BusEvent.define("test.ping", z.object({ msg: z.string() }))
    const received: string[] = []

    await Instance.provide({
      directory: "/workspace/opencode",
      fn: async () => {
        const unsub = Bus.subscribe(TestEvent, (event) => {
          received.push(event.properties.msg)
        })

        await Bus.publish(TestEvent, { msg: "hello" })
        await Bus.publish(TestEvent, { msg: "world" })
        unsub()
        // after unsubscribe, this should not be received
        await Bus.publish(TestEvent, { msg: "ignored" })
      },
    })

    expect(received).toEqual(["hello", "world"])
  })

  test("Instance.dispose cleans up state and emits event", async () => {
    const { Instance } = await import("../project/instance")
    const { GlobalBus } = await import("../bus/global")

    const disposed: string[] = []
    GlobalBus.on("event", (e: any) => {
      if (e.payload?.type === "server.instance.disposed") {
        disposed.push(e.payload.properties.directory)
      }
    })

    // Use a non-git tmp dir so it doesn't collide with the git test above
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lite-agent-test-"))
    try {
      await Instance.provide({
        directory: tmp,
        fn: async () => {
          await Instance.dispose()
        },
      })
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }

    expect(disposed.some((d) => d === tmp)).toBe(true)
  })

  test("two Instance contexts are isolated (separate Bus subscriptions)", async () => {
    const { Instance } = await import("../project/instance")
    const { Bus } = await import("../bus/index")

    const PingEvent = BusEvent.define("test.ping2", z.object({ src: z.string() }))
    const log: string[] = []

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lite-agent-a-"))
    try {
      await Instance.provide({
        directory: "/workspace/opencode",
        fn: async () => {
          Bus.subscribe(PingEvent, (e) => log.push("opencode:" + e.properties.src))
        },
      })

      await Instance.provide({
        directory: tmp,
        fn: async () => {
          Bus.subscribe(PingEvent, (e) => log.push("tmp:" + e.properties.src))
        },
      })

      // publish in opencode context — only opencode listener fires
      await Instance.provide({
        directory: "/workspace/opencode",
        fn: async () => {
          await Bus.publish(PingEvent, { src: "opencode" })
        },
      })

      // publish in tmp context — only tmp listener fires
      await Instance.provide({
        directory: tmp,
        fn: async () => {
          await Bus.publish(PingEvent, { src: "tmp" })
        },
      })
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }

    expect(log).toContain("opencode:opencode")
    expect(log).toContain("tmp:tmp")
    expect(log).not.toContain("opencode:tmp")
    expect(log).not.toContain("tmp:opencode")
  })
})
