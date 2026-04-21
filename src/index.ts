import { Server } from "./server/server"
import { Log } from "./util/log"

Log.init({ print: true })

const port = parseInt(process.env.PORT ?? "4096")
const hostname = process.env.HOST ?? "localhost"

const server = Server.listen({ port, hostname })
console.log(`lite-agent-m listening on http://${hostname}:${server.port}`)
