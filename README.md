# CipherScript - Free AI Agent for Unity Editor

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-lightgrey)
![License](https://img.shields.io/badge/license-GPL--3.0-blue)

**CipherScript (Unity edition)** is a free browser extension that turns DeepSeek, Gemini, Kimi, GLM, Qwen, Arena or Meta AI into a **Unity Editor AI agent**.
Control the Unity Editor with AI directly from your browser - create GameObjects, write/edit C# scripts, run editor code, generate assets - all from a normal AI chat. No API key, no terminal, no coding needed.

> CipherScript connects your AI chat to the Unity Editor through [Unity MCP Toolkit](https://github.com/CoplayDev/unity-mcp) (free, open source, MIT).

Seven AI providers are supported: **DeepSeek** (chat.deepseek.com, recommended), **Google Gemini** (gemini.google.com), **Kimi** (kimi.com, Moonshot AI), **GLM** (chat.z.ai, Z.ai), **Qwen** (chat.qwen.ai), **Arena** (arena.ai, a multi-model playground) and **Meta AI** (meta.ai). DeepSeek is the recommended provider.

## How it works

```
AI chat (DeepSeek / Gemini / Kimi / GLM / Qwen / Arena / Meta AI, in your browser) -> CipherScript Extension -> Bridge (your PC) -> Unity Editor (Unity MCP Toolkit)
```

The extension runs inside the chat page. When you type a request, it sends commands to the Bridge running on your PC, which drives the Unity Editor through the Unity MCP Toolkit server.

## Setup

### 1. Install Unity MCP Toolkit inside Unity (one time, per project)

Open your Unity project, then:

- `Window > Package Manager` → click **+** (top left) → **Add package from git URL...**
- Paste: `https://github.com/CoplayDev/unity-mcp.git?path=/MCPForUnity#main`
- Wait for it to import, then open **`Window > Unity MCP Toolkit`** (a setup wizard opens).
- Confirm Python and uv are installed (the wizard guides you if not), click **Done**.
- Make sure the MCP server is **started** (the status panel shows **Connected**). You can start/stop it anytime from `Window > Unity MCP Toolkit`.

### 2. Load the extension

- Go to `edge://extensions` (Edge) or `chrome://extensions` (Chrome)
- Enable **Developer mode** (top right toggle)
- Click **Load unpacked** and select the `cipherscript-extension` folder

### 3. Run the Bridge

- **Windows:** double-click `start.bat` (it installs Python/uv automatically if needed).
- **macOS:** double-click `MacOS_Start.command`. The first time, macOS shows a security warning - click **Done**, then **System Settings > Privacy & Security > Open Anyway**.

A small window opens - that means the Bridge is running. **Keep it open** (minimize it; closing it stops CipherScript).

### 4. Start a session

Go to https://chat.deepseek.com (recommended), open a **new chat**, and click **Start Unity agent** in the CipherScript bar above the input box. Then type what you want to build - e.g. *"Create a cube at the origin with a Rigidbody"* or *"Build a simple WASD player controller"*.

> Works on the 7 supported AI sites listed above - it will not work on any other site.

## What the AI can do

- Create, edit and delete GameObjects, scenes and prefabs
- Write, read and edit C# scripts (with Roslyn validation)
- **Run C# code directly inside the Editor** (`###C####` blocks) - inspect, drive and modify the project live
- Create and modify materials, physics, cameras, UI, VFX and animations
- Generate/import 3D models, 2D images and audio (needs your own AI-provider key in Unity MCP Toolkit)
- Query the scene, search the project, read the console, run tests
- Control play mode, undo/redo, and editor menu items
- **Remember your project across sessions** - persistent project memory saved at `Assets/CipherScript/ProjectMemory.cs`

## Panel status

| Dot | Meaning |
|-----|---------|
| Green | Bridge + Unity Editor ready |
| Yellow | Bridge OK, but Unity isn't usable yet - open the Editor, a project, or start the MCP server (`Window > Unity MCP Toolkit`) |
| Grey | Bridge offline - run start.bat (Windows) or MacOS_Start.command (macOS) |

## Requirements

- Windows or macOS
- Unity 2021.3 LTS or newer (2022/2023/6.x fine)
- Microsoft Edge or Chrome
- Python 3.9+ (bridge) and uv (Unity MCP Toolkit) - both installed automatically by start.bat on Windows

## Troubleshooting

- **"Unity offline" in the panel but Unity is open** → open `Window > Unity MCP Toolkit` in Unity and make sure the server is started (start/stop it once if needed). The Bridge window turns green when it connects.
- **Bridge says "command not found: 'uvx'"** → uv isn't on PATH. Run `python -m pip install uv` and restart start.bat.
- **Extension can't reach the Bridge** → run `start.bat` and keep the window open; wait ~10s for "listening" to appear.

## Support

CipherScript is free and open source (GPL-3.0).

---

Credit: the Unity MCP integration is powered by [Unity MCP Toolkit (CoplayDev)](https://github.com/CoplayDev/unity-mcp) - free, MIT licensed.
