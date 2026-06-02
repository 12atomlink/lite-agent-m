// MCP App Bridge — host-side bridge for rendering MCP Apps in sandboxed iframes
// Communicates with apps via postMessage using JSON-RPC 2.0
//
// Double-iframe sandbox pattern:
//   Host page (localhost:4096)
//     └── Outer iframe: src="/web/sandbox.html"   ← allow-scripts allow-same-origin (trusted relay)
//           └── Inner iframe: srcdoc (MCP App)    ← sandboxed WITHOUT allow-same-origin
//
// Handshake protocol (per @modelcontextprotocol/ext-apps spec):
//   App  → Host:  ui/initialize REQUEST (with id)
//   Host → App:   JSON-RPC response { protocolVersion, hostInfo, hostCapabilities, hostContext }
//   App  → Host:  ui/notifications/initialized NOTIFICATION

function makeResponse(id, result) {
  return { jsonrpc: '2.0', id, result }
}
function makeError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}
function makeNotification(method, params) {
  return { jsonrpc: '2.0', method, params }
}

class AppBridge {
  constructor(containerEl, options) {
    this._container = containerEl
    this._options = Object.assign({ theme: 'dark', sessionId: null, toolName: null, toolInput: null, onToolCall: async () => {}, toolResult: null }, options)
    this._iframe = null
    this._handler = null
  }

  // Wraps outgoing JSON-RPC messages for the relay (outer iframe)
  _send(msg) {
    if (!this._iframe || !this._iframe.contentWindow) return
    this._iframe.contentWindow.postMessage({ type: 'mcp-sandbox-relay-in', payload: msg }, '*')
  }

  async load(html, meta) {
    if (this._iframe) throw new Error('AppBridge.load() called twice; call destroy() first')
    meta = meta || {}

    // Create outer (relay) iframe pointing to sandbox.html
    const iframe = document.createElement('iframe')
    iframe.src = '/web/sandbox.html'
    iframe.sandbox = 'allow-scripts allow-same-origin allow-forms allow-popups'
    iframe.style.cssText = 'width:100%;border:none;height:300px;min-height:200px;'
    if (meta.permissions && meta.permissions.length > 0) {
      iframe.allow = meta.permissions.join('; ')
    }
    this._container.appendChild(iframe)

    // Wait for outer iframe page to load
    await new Promise((resolve) => {
      iframe.addEventListener('load', resolve, { once: true })
    })

    this._iframe = iframe

    // Set up permanent message handler
    this._handler = (event) => this._handleMessage(event)
    window.addEventListener('message', this._handler)

    // Bootstrap: send HTML to sandbox, wait for ready signal
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        window.removeEventListener('message', onReady)
        reject(new Error('Timeout waiting for mcp-sandbox-proxy-ready'))
      }, 10000)

      const onReady = (event) => {
        if (event.source !== this._iframe.contentWindow) return
        if (event.data && event.data.type === 'ui/notifications/sandbox-proxy-ready') {
          clearTimeout(timeout)
          window.removeEventListener('message', onReady)
          resolve()
        }
      }
      window.addEventListener('message', onReady)
      iframe.contentWindow.postMessage({ type: 'mcp-sandbox-init', html }, '*')
    })

    // Wait for app to send ui/initialize REQUEST, respond, then wait for ui/notifications/initialized
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        window.removeEventListener('message', onInit)
        reject(new Error('Timeout waiting for ui/initialized from MCP App'))
      }, 20000)

      let initHandled = false

      const onInit = (event) => {
        if (event.source !== this._iframe.contentWindow) return
        const msg = event.data
        if (!msg || msg.jsonrpc !== '2.0') return

        // Step 1: app sends ui/initialize REQUEST → respond with host context
        if (msg.method === 'ui/initialize' && msg.id !== undefined && !initHandled) {
          initHandled = true
          this._send(makeResponse(msg.id, {
            protocolVersion: '2026-01-26',
            hostInfo: { name: 'lite-agent-m', version: '0.0.1' },
            hostCapabilities: { tools: { listChanged: true } },
            hostContext: {
              theme: this._options.theme,
              platform: 'web',
              ...(this._options.toolName != null && {
                toolInfo: { tool: { name: this._options.toolName, inputSchema: { type: 'object' } } },
              }),
            },
          }))
          return
        }

        // Step 2: app sends ui/notifications/initialized → handshake complete
        if (msg.method === 'ui/notifications/initialized') {
          clearTimeout(timeout)
          window.removeEventListener('message', onInit)
          resolve()
        }
      }
      window.addEventListener('message', onInit)
    })

    // Send tool-input then tool-result so the app can identify the tool and render its initial state
    if (this._options.toolResult) {
      const args = this._options.toolInput || {}
      this._send(makeNotification('ui/notifications/tool-input', { arguments: args }))
      this._send(makeNotification('ui/notifications/tool-result', this._options.toolResult))
    }
  }

  _handleMessage(event) {
    const iframe = this._iframe
    if (!iframe) return

    const msg = event.data
    if (!msg || msg.jsonrpc !== '2.0') return
    if (event.source !== iframe.contentWindow) return

    // Tool call request from app → forward to server via onToolCall
    if (msg.method === 'tools/call' && msg.id !== undefined) {
      const { name, arguments: args } = msg.params || {}
      const handler = this._options.onToolCall || (async () => ({}))
      handler(name, args || {})
        .then((result) => this._send(makeResponse(msg.id, result)))
        .catch((err) => this._send(makeError(msg.id, -32000, err.message)))
    }

    // Open link request from app
    if (msg.method === 'ui/open-link' && msg.id !== undefined) {
      window.open(msg.params?.url, '_blank', 'noopener')
      this._send(makeResponse(msg.id, {}))
    }

    // Size change notification from app
    if (msg.method === 'ui/notifications/size-changed') {
      const h = msg.params?.height
      if (h && h > 0) {
        const px = Math.min(h, 800) + 'px'
        iframe.style.height = px
        iframe.style.minHeight = px
      }
    }

    // Teardown request from app
    if (msg.method === 'ui/notifications/request-teardown') {
      this.destroy()
    }
  }

  destroy() {
    if (!this._handler && !this._iframe) return
    window.removeEventListener('message', this._handler)
    this._iframe?.remove()
    this._iframe = null
    this._handler = null
  }
}
