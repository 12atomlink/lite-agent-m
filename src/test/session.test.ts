import { describe, test, expect } from "bun:test"

describe("Session CRUD", () => {
  test("create and get session", async () => {
    const { Instance } = await import("../project/instance")
    const { Session } = await import("../session/index")

    await Instance.provide({
      directory: "/workspace/opencode",
      fn: async () => {
        const session = await Session.create()
        expect(session.id).toBeDefined()
        expect(session.slug).toBeDefined()
        expect(session.projectID).toBe(Instance.project.id)
        expect(session.title).toMatch(/^New session - /)

        const fetched = await Session.get(session.id)
        expect(fetched.id).toBe(session.id)
        expect(fetched.title).toBe(session.title)
      },
    })
  })

  test("list sessions for project", async () => {
    const { Instance } = await import("../project/instance")
    const { Session } = await import("../session/index")

    await Instance.provide({
      directory: "/workspace/opencode",
      fn: async () => {
        const s1 = await Session.create({ title: "alpha" })
        const s2 = await Session.create({ title: "beta" })

        const sessions = [...Session.list()]
        const ids = sessions.map((s) => s.id)
        expect(ids).toContain(s1.id)
        expect(ids).toContain(s2.id)
      },
    })
  })

  test("setTitle updates session title", async () => {
    const { Instance } = await import("../project/instance")
    const { Session } = await import("../session/index")

    await Instance.provide({
      directory: "/workspace/opencode",
      fn: async () => {
        const session = await Session.create()
        const updated = await Session.setTitle({ sessionID: session.id, title: "my new title" })
        expect(updated.title).toBe("my new title")

        const fetched = await Session.get(session.id)
        expect(fetched.title).toBe("my new title")
      },
    })
  })

  test("remove session", async () => {
    const { Instance } = await import("../project/instance")
    const { Session } = await import("../session/index")
    const { NotFoundError } = await import("../storage/db")

    await Instance.provide({
      directory: "/workspace/opencode",
      fn: async () => {
        const session = await Session.create({ title: "to-be-deleted" })
        await Session.remove(session.id)

        await expect(Session.get(session.id)).rejects.toThrow()
      },
    })
  })
})
