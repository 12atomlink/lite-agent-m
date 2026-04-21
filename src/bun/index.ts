// Stub: dynamic npm package installation not needed for bundled providers
export namespace BunProc {
  export function which() {
    return process.execPath
  }

  export async function run(): Promise<never> {
    throw new Error("BunProc.run not supported in lite-agent-m")
  }

  export async function install(_pkg: string, _version?: string): Promise<never> {
    throw new Error("BunProc.install not supported in lite-agent-m")
  }
}
