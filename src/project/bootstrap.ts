import { Plugin } from "../plugin"
import { LSP } from "../lsp"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { Snapshot } from "../snapshot"
import { Instance } from "./instance"
import { Project } from "./project"
import { Bus } from "../bus"
import { Command } from "../command"
import { Log } from "@/util/log"

export async function InstanceBootstrap() {
  Log.Default.info("bootstrapping", { directory: Instance.directory })
  await Plugin.init()
  await LSP.init()
  File.init()
  FileWatcher.init()
  Snapshot.init()

  Bus.subscribe(Command.Event.Executed, async (payload) => {
    if (payload.properties.name === Command.Default.INIT) {
      Project.setInitialized(Instance.project.id)
    }
  })
}
