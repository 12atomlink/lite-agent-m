import { describe, test, expect, afterEach } from "bun:test"
import { Instance } from "../project/instance"
import { Server } from "../server/server"
import { tmpdir } from "./fixture/fixture"
import { Log } from "../util/log"

Log.init({ print: false })

describe("server routes", () => {
  afterEach(async () => {
    await Instance.disposeAll()
  })

  test("GET /global/health returns healthy", async () => {
    const app = Server.createApp({})
    const res = await app.fetch(new Request("http://localhost/global/health"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.healthy).toBe(true)
    expect(typeof body.version).toBe("string")
  })

  test("GET /session/ returns array", async () => {
    await using tmp = await tmpdir()
    const app = Server.createApp({})
    const res = await app.fetch(
      new Request(`http://localhost/session?directory=${encodeURIComponent(tmp.path)}`),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })

  test("POST /session/ creates a session", async () => {
    await using tmp = await tmpdir()
    const app = Server.createApp({})
    const res = await app.fetch(
      new Request(`http://localhost/session?directory=${encodeURIComponent(tmp.path)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.id).toBe("string")
  })

  test("GET /permission/ returns array", async () => {
    await using tmp = await tmpdir()
    const app = Server.createApp({})
    const res = await app.fetch(
      new Request(`http://localhost/permission?directory=${encodeURIComponent(tmp.path)}`),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })

  test("GET /question/ returns array", async () => {
    await using tmp = await tmpdir()
    const app = Server.createApp({})
    const res = await app.fetch(
      new Request(`http://localhost/question?directory=${encodeURIComponent(tmp.path)}`),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })

  test("GET /session/:id returns 404 for unknown session", async () => {
    await using tmp = await tmpdir()
    const app = Server.createApp({})
    const res = await app.fetch(
      new Request(`http://localhost/session/nonexistent?directory=${encodeURIComponent(tmp.path)}`),
    )
    expect(res.status === 400 || res.status === 404).toBe(true)
  })

  test("GET /path returns directory info", async () => {
    await using tmp = await tmpdir()
    const app = Server.createApp({})
    const res = await app.fetch(
      new Request(`http://localhost/path?directory=${encodeURIComponent(tmp.path)}`),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.directory).toBe(tmp.path)
  })

  test("GET /mcp/ returns object", async () => {
    await using tmp = await tmpdir()
    const app = Server.createApp({})
    const res = await app.fetch(
      new Request(`http://localhost/mcp?directory=${encodeURIComponent(tmp.path)}`),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body).toBe("object")
  })
})

