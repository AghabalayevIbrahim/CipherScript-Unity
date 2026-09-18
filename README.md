# CipherScript (Unity edition) - browser extension

Turns DeepSeek, Gemini, Kimi, GLM, Qwen, Arena or Meta AI into a **Unity Editor AI agent**, for free: describe what you want and it creates GameObjects, writes/edits C# scripts, runs editor code (`###C####` blocks), and generates assets directly in your Unity project. No API key, no terminal, no coding required.

This is a Chrome/Edge extension plus a small local bridge that connects the chat to the **Unity Editor** through [Unity MCP Toolkit](https://github.com/CoplayDev/unity-mcp). **DeepSeek is the recommended provider.** Gemini, Kimi, GLM, Qwen, Arena and Meta AI also work but can be less stable.

## Install

1. **Unity side:** `Window > Package Manager` → **+** → **Add package from git URL...** → `https://github.com/CoplayDev/unity-mcp.git?path=/MCPForUnity#main`. Then open **`Window > Unity MCP Toolkit`**, confirm Python + uv, and make sure the server is **started** (status panel shows **Connected**).
2. **Extension:** open `edge://extensions` / `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, select this folder.
3. **Bridge:** run `start.bat` (Windows) or `MacOS_Start.command` (macOS) from the folder above this one, and keep that window open.
4. Open a **new chat** on a supported AI site, click **Start Unity agent**, and type what you want to build.

## How it works

```
AI chat -> CipherScript extension (this folder) -> Bridge (bridge.py, WebSocket on 127.0.0.1:17613) -> Unity MCP Toolkit -> Unity Editor
```

The extension watches the AI's replies. When it detects a CipherScript command - either a JSON `{"command": ..., "params": {...}}` envelope or a `###C#### ... ###END_C####` C# block - it runs it against the Unity MCP server and feeds the result back, so the AI keeps working autonomously.

## Project layout

- `core/config.js` - system prompt, tool categories, per-command notes (Unity)
- `core/parser.js` - parses `###C####` blocks and JSON commands from AI replies
- `core/main.js` - the agentic loop, UI bar, chips, session bootstrap
- `providers/*.js` - per-AI-site adapters (DeepSeek, Gemini, Kimi, GLM, Qwen, Arena, Meta)
- `background.js` - service worker owning the WebSocket to the bridge
- `popup.html` / `popup.js` - extension popup with bridge status

## Tests

Run the parser smoke test with: `node test-parser.js`
