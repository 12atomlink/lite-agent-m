import { describe, test, expect } from "bun:test"

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY ?? ""

// Config that enables only openrouter with a known model
const CONFIG_OPENROUTER = JSON.stringify({
  $schema: "https://opencode.ai/config.json",
  enabled_providers: ["openrouter"],
  provider: {
    openrouter: {
      options: { apiKey: OPENROUTER_KEY },
      models: {
        "qwen/qwen3.5-35b-a3b": {},
      },
    },
  },
})

describe("Provider", () => {
  test("parseModel splits provider/model correctly", async () => {
    const { Provider } = await import("../provider/provider")
    const result = Provider.parseModel("openrouter/qwen/qwen3.5-35b-a3b")
    expect(result.providerID).toBe("openrouter" as any)
    expect(result.modelID).toBe("qwen/qwen3.5-35b-a3b" as any)
  })

  test("list() discovers openrouter provider via config", async () => {
    const { Instance } = await import("../project/instance")
    await Instance.provide({
      directory: "/workspace/opencode",
      fn: async () => {
        process.env.OPENCODE_CONFIG_CONTENT = CONFIG_OPENROUTER
        try {
          const { Provider } = await import("../provider/provider")
          const providers = await Provider.list()
          expect(providers["openrouter" as any]).toBeDefined()
          expect(providers["openrouter" as any].source).toBe("config")
        } finally {
          delete process.env.OPENCODE_CONFIG_CONTENT
        }
      },
    })
  })

  test("getModel() returns model info for openrouter/qwen", async () => {
    const { Instance } = await import("../project/instance")
    await Instance.provide({
      directory: "/workspace/opencode",
      fn: async () => {
        process.env.OPENCODE_CONFIG_CONTENT = CONFIG_OPENROUTER
        try {
          const { Provider } = await import("../provider/provider")
          const { ProviderID, ModelID } = await import("../provider/schema")
          const model = await Provider.getModel(
            ProviderID.make("openrouter"),
            ModelID.make("qwen/qwen3.5-35b-a3b"),
          )
          expect(model.providerID).toBe("openrouter" as any)
          expect(model.api.npm).toBe("@openrouter/ai-sdk-provider")
        } finally {
          delete process.env.OPENCODE_CONFIG_CONTENT
        }
      },
    })
  })

  test("getLanguage() returns a LanguageModelV2 instance for openrouter/qwen", async () => {
    const { Instance } = await import("../project/instance")
    await Instance.provide({
      directory: "/workspace/opencode",
      fn: async () => {
        process.env.OPENCODE_CONFIG_CONTENT = CONFIG_OPENROUTER
        try {
          const { Provider } = await import("../provider/provider")
          const { ProviderID, ModelID } = await import("../provider/schema")
          const model = await Provider.getModel(
            ProviderID.make("openrouter"),
            ModelID.make("qwen/qwen3.5-35b-a3b"),
          )
          const lang = await Provider.getLanguage(model)
          expect(lang).toBeDefined()
          expect(typeof lang.doGenerate).toBe("function")
        } finally {
          delete process.env.OPENCODE_CONFIG_CONTENT
        }
      },
    })
  })

  test("ModelNotFoundError thrown for unknown provider", async () => {
    const { Instance } = await import("../project/instance")
    await Instance.provide({
      directory: "/workspace/opencode",
      fn: async () => {
        process.env.OPENCODE_CONFIG_CONTENT = CONFIG_OPENROUTER
        try {
          const { Provider } = await import("../provider/provider")
          const { ProviderID, ModelID } = await import("../provider/schema")
          await expect(
            Provider.getModel(ProviderID.make("nonexistent"), ModelID.make("some-model")),
          ).rejects.toMatchObject({ name: "ProviderModelNotFoundError" })
        } finally {
          delete process.env.OPENCODE_CONFIG_CONTENT
        }
      },
    })
  })
})
