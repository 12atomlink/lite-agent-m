import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { streamSSE } from "hono/streaming"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { AsyncQueue } from "@/util/queue"
import { lazy } from "@/util/lazy"
import { Log } from "@/util/log"
import z from "zod"

const log = Log.create({ service: "server" })

export const EventRoutes = lazy(() =>
  new Hono().get(
    "/event",
    describeRoute({
      summary: "Subscribe to events",
      operationId: "event.subscribe",
      responses: {
        200: {
          description: "Event stream",
          content: { "text/event-stream": { schema: resolver(BusEvent.payloads()) } },
        },
      },
    }),
    validator("query", z.object({ cid: z.string().optional() })),
    async (c) => {
      const { cid } = c.req.valid("query")
      if (cid) {
        console.log("[EVENT CONNECTED] cid:", cid)
      }
      log.info("event connected")
      c.header("X-Accel-Buffering", "no")
      c.header("X-Content-Type-Options", "nosniff")
      return streamSSE(c, async (stream) => {
        const q = new AsyncQueue<string | null>()
        let done = false

        q.push(JSON.stringify({ type: "server.connected", properties: {} }))

        const heartbeat = setInterval(() => {
          q.push(JSON.stringify({ type: "server.heartbeat", properties: {} }))
        }, 10_000)

        const unsub = Bus.subscribeAll((event) => {
          q.push(JSON.stringify(event))
          if (event.type === Bus.InstanceDisposed.type) stop()
        })

        const stop = () => {
          if (done) return
          done = true
          clearInterval(heartbeat)
          unsub()
          q.push(null)
          log.info("event disconnected")
        }

        stream.onAbort(stop)

        try {
          for await (const data of q) {
            if (data === null) return
            await stream.writeSSE({ data })
          }
        } finally {
          stop()
        }
      })
    },
  ),
)
