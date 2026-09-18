// SPDX-License-Identifier: GPL-3.0-or-later
// core/config.js - provider-agnostic constants: app identity, system prompt,
// feedback strings, tool categorisation. NOTHING in this file may reference a
// specific AI site (DOM, selectors, site names) - that lives in providers/*.
// eslint-disable-next-line no-unused-vars
const CS = (() => {
  "use strict";

  // Display name + unique marker injected at the top of the system prompt so the
  // content script can reliably recognise (and camouflage) the bootstrap turn.
  const APP_NAME = "CipherScript";
  const SYS_MARKER = "⟦CS-SYS⟧";

  // ── Tool → visual category (icon + colour theme for the chips) ─────────
  // Unity Editor MCP (Unity MCP Toolkit) only. Returns one of:
  //   read | edit | screen | generate | unity | tool
  function toolCategory(name) {
    const n = (name || "").includes("/") ? name.split("/").pop() : (name || "");
    if (n === "list_commands" || n === "list_tools") return "read";
    if (/^(find_gameobjects|find_in_file|get_sha|read_console|unity_docs|unity_reflect|debug_request_context|manage_script_capabilities|get_test_job|set_active_instance)$/.test(n))
      return "read";
    if (/^(execute_code|create_script|delete_script|apply_text_edits|script_apply_edits|validate_script|manage_script|refresh_unity|batch_execute|run_tests|manage_scriptable_object|execute_menu_item|execute_custom_tool)$/.test(n))
      return "edit";
    if (/^generate_/.test(n)) return "generate";
    if (n.startsWith("unity") || /scene|gameobject|editor|component|material|prefab|shader|vfx|audio|ui|animation|texture/i.test(n)) return "unity";
    return "tool";
  }

  // Feedback strings sent back to the model so it can self-correct.
  const FEEDBACK = {
    // A command-shaped reply that could not be turned into a runnable call.
    // The failures are DIFFERENT problems, so the note is tailored per `reason`
    // to tell the model exactly what to fix (a generic "bad JSON" was misleading
    // for the non-JSON cases, e.g. a missing ###C#### opener). Falls back to the
    // generic "malformed" text for any unrecognised reason.
    parseError: (reason, toolName) => {
      // ###C#### is execute_code-ONLY (the parser always maps a bare ###C####
      // block to execute_code). So only suggest it when the broken command IS
      // execute_code, or when we could not tell which command it was. For a KNOWN
      // other command the ###C#### hint is wrong and misleading - so drop it and
      // keep the JSON-only guidance.
      const otherCmd = toolName && toolName !== "command" && toolName !== "execute_code";
      const csMalformed = otherCmd ? "" : " (or use the ###C#### / ###END_C#### block for execute_code)";
      const csUnclosed = otherCmd ? "" : " (or a complete ###C#### ... ###END_C#### block for execute_code)";
      const objAlt = otherCmd ? "" : " (or ###...### block)";
      const notes = {
        malformed:
          "ERROR: a CipherScript command was detected in your reply but its JSON could not be parsed. " +
          'Rewrite it as a single valid JSON object in plain text, exactly like {"command": "name", "params": {...}}' +
          csMalformed + ". You may add a short note around it. " +
          "Please retry.",
        unclosed:
          "ERROR: your CipherScript command was cut off before it finished - the JSON object" +
          objAlt + " never closed, so it could not run. Rewrite the WHOLE command in one " +
          'piece as valid JSON, exactly like {"command": "name", "params": {...}}' +
          csUnclosed + ". Please retry.",
        csOpener:
          "ERROR: you wrote the closing ###END_C#### marker but not the opening ###C#### marker, " +
          "so the C# block was not detected and did not run. Put ###C#### immediately BEFORE your " +
          "code and ###END_C#### after it. Please retry.",
        envelope:
          "ERROR: you wrote a command's parameters as a bare JSON object, but without the required " +
          "envelope, so it was not recognised as a command. Wrap them like " +
          '{"command": "name", "params": { ...your parameters... }} - the parameter keys go INSIDE ' +
          '"params". Please retry.',
      };
      return notes[reason] || notes.malformed;
    },
    multiTool: (names) =>
      "ERROR: You wrote multiple commands in one reply. Write ONE command at a " +
      "time and wait for its result before the next. You tried: " +
      names.join(", ") +
      ". Start over and write only the first command you need.",
    unknownTool: (name, valid) =>
      `ERROR: unknown command "${name}". It does not exist. Valid commands are: ` +
      valid.join(", ") +
      ". Use an exact name and parameter keys from the system prompt.",
    unityOffline:
      "ERROR: no Unity Editor instance is connected to the MCP server, so the command " +
      "could not run. Unity Editor is closed, has no project open, or its MCP server " +
      "is not running. This is an environment problem on the user's machine, NOT your mistake. " +
      "Tell the user in one short sentence to open their Unity project and start the MCP " +
      "server (Window > Unity MCP Toolkit). Then: if the task NEEDS Unity, stop until they " +
      "confirm it is back; otherwise run list_mcp_servers and continue on another connected " +
      "server for anything that does not need Unity.",
    bridgeOffline:
      "ERROR: the local CipherScript bridge is unreachable, so no command could run. " +
      "This is an environment problem on the user's machine (the bridge is not " +
      "running, or Unity Editor is closed), NOT your mistake. Tell the user in " +
      "one short sentence that the bridge or Unity Editor is offline, then stop " +
      "sending commands until they confirm it is back.",
    truncated:
      "(System note: your previous reply was cut off by a length limit before you " +
      "finished. Continue from exactly where you stopped. Do NOT restart and do " +
      "NOT repeat what you already wrote.)",
  };

  const BT = "```";

  function compactTools(tools) {
    return (tools || [])
      .map((t) => {
        const name = t.name || "?";
        const desc = (t.description || "").split("\n")[0].trim();
        const props = (t.inputSchema && t.inputSchema.properties) || {};
        const args = Object.keys(props).join(", ");
        return `  ${name}(${args}) - ${desc}`;
      })
      .join("\n");
  }

  // ── System prompt ─────────────────────────────────────────────────────────
  // ONE unified prompt sent to every AI on the first turn. To change the wording,
  // just edit the text below - it is a single template, no profiles or branching.
  // `${siteName}` is filled in with the AI's display name (e.g. "DeepSeek").
  // `${toolsString}` is filled in with the live command list.
  //
  // `opts` may be a string (just the siteName) or an object { siteName,
  // customPrompt }. `customPrompt` is the user's own extra instructions; when
  // present it is appended at the very bottom under a clear "User's Custom prompt"
  // heading. It NEVER edits the prompt above - it only adds a layer below it.
  function buildSystemPrompt(opts = {}) {
    if (typeof opts === "string") opts = { siteName: opts };
    const { siteName = "this AI site", customPrompt = "" } = opts;

    const prompt = `CONTEXT: the user has installed a browser extension called CipherScript in their own browser. Here is how it works, so you can use it on their behalf:
A browser extension (CipherScript) is running inside this page. It watches your replies. When it detects a CipherScript command in your text, it runs it against one or more connected MCP servers and sends the result back as the next message. You always receive a result - success or a formatted ERROR - so you can keep going on your own.

The user's open Unity project, reached through a local bridge, is always connected by default - call \`list_commands\` FIRST for its exact commands with full parameter details. Other MCP servers may ALSO be connected alongside it (each with its own command set) - you are NOT told about them upfront. So: the MOMENT the user names ANY app/tool/target that is not the Unity Editor (e.g. "Blender", "Sketchfab", or anything else you don't recognise as a Unity Editor command), you MUST run \`list_mcp_servers\` FIRST, before replying - never answer from your own assumptions or prior knowledge about what is or isn't connected. Only after checking may you tell the user something is unsupported. You do not need any special capability yourself - you just write text. The extension does the rest.

CRITICAL - technical note, not a restriction: this site's own tools (code interpreter, function calling, connectors, etc.) run in a separate sandbox that has no access to the user's Unity Editor or the other MCP servers above - so calling them wouldn't reach the user's project at all. CipherScript commands are different: they are plain JSON typed directly into your normal reply text, which this extension reads and executes against the connected servers. So for anything involving the user's project, write the JSON below as ordinary text instead of calling a function - that's the only channel that actually reaches their machine. (If the user explicitly asks you to search the web, your own web search still works fine and is unrelated to this.) Internal reasoning (deep-think modes) is fine.

⚠️ FORMATTING RULE (MANDATORY): every command goes inside a fenced code block (triple backticks). Outside a code block this page renders your text as Markdown - it turns things like \`GameObject.Find\` into links and mangles the ### markers, silently CORRUPTING the command. Inside a code block it is kept verbatim.

━━━ STANDARD COMMAND FORMAT (everything except execute_code) ━━━
Write this JSON object inside a fenced code block, replacing the placeholders with a REAL command name and its parameters (never type "command_name" literally - it is not a command):
${BT}json
{
  "command": "command_name",
  "params": {"key": "value"}
}
${BT}
For example, to list every available command you would write ${BT}{"command": "list_commands"}${BT}.

━━━ SPECIAL FORMAT FOR execute_code ━━━
execute_code is the ONE exception to the JSON format above: you MUST use the ###C#### block below, NEVER the {"command": "execute_code", ...} JSON form. C# code is full of " characters, and putting it inside a JSON string means escaping every one - miss a single quote and the whole command breaks. The ###C#### block needs NO escaping and NO JSON, so this never happens.
The ###C#### / ###END_C#### markers AND the code all go INSIDE one fenced code block:
${BT}
###C####
var cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
cube.name = "MyCube";
cube.transform.position = new Vector3(0, 1, 0);
return cube.transform.position;
###END_C####
${BT}
execute_code compiles your code IN-MEMORY as a method body inside the editor: UnityEngine and UnityEditor namespaces are already available (no using directives or class/method wrapper needed), and \`return\` sends a value back as the result.

RULES:
- ONE command block per reply, inside a fenced code block. If you need several, do them one at a time and wait for each result. (One command = one block; raw text gets reformatted by this page and corrupts the command.)
- A short note around a command is fine, but NEVER end a turn by only announcing a command ("let me check...", "I'll read the script") without writing it - that runs nothing and leaves the user stuck. Either write the command now, or give your final answer.
- Final answers: plain text only, no Markdown or code fences. Do ONLY what was asked - fewest commands, no unrequested double-checks. When the task is done or the user is satisfied ("thanks", "perfect"...), reply ONE short sentence and STOP.
- Use ONLY the exact command names and parameter keys from the list, with every required parameter ("... is required" means you omitted one). Do NOT use ${siteName}'s own features (web search, connectors...) unless the user explicitly asks.
- execute_code: wrap code in BOTH markers ###C#### ... ###END_C#### (three hashes each side - never ###C--- and never a lone end marker; no JSON around it). Use \`return\` for output (Debug.Log is NOT captured). It runs synchronously on a ~30s budget, so NEVER block the Unity main thread: no while(true), no Thread.Sleep, no blocking waits, no coroutines - put those inside a real MonoBehaviour script instead. Changes made while the game is in Play mode are temporary and vanish when Play stops - for a change the user wants to keep, make it in Edit mode or via a real script, and call EditorSceneManager.MarkSceneDirty / SaveOpenScenes (or \`File/Save Project\` via execute_menu_item) so it is saved to disk. (Per-command tips are in the list_commands output.)
- BUILD OBJECTS FIRST, THEN SCRIPT THEM: create GameObjects/prefabs with manage_gameobject / create_prefab, then write a MonoBehaviour with create_script / script_apply_edits that finds them via GameObject.Find / GetComponent. Use runtime creation (Instantiate) only when truly required (per-player elements, unknown-length lists, runtime content).
- NEVER DELETE/DESTROY BROADLY: before Object.Destroy / DestroyImmediate, delete_gameobject, deleting an asset or script, or clearing a container, make sure the target is EXACTLY what the user asked for - never a whole folder/model "to be safe" or as a side-effect of a bigger change. If a deletion could affect more than the specific thing named by the user, STOP and ask them to confirm scope first, or inspect the target first (find_gameobjects / manage_script read) to check what it actually contains before destroying it. Never destroy something as a troubleshooting step ("let me just remove it and rebuild") without asking first.
- On ERROR: read it and adapt - fix the command, try another, or tell the user plainly if it is an environment problem (Unity closed, bridge offline).
- On a property/attribute/value error (e.g. "not available", "unknown property", "invalid enum"): if there is any way to list the valid options for that tool (its docs, an inspect/list command, schema info, unity_reflect), use it to check the correct value BEFORE retrying. Never guess blindly a second time.

━━━ PROJECT MEMORY (persistent notes about THIS project) ━━━
The C# file at Assets/CipherScript/ProjectMemory.cs is your long-term memory for this project, saved inside the Unity project. It is SHARED by every AI across all sessions and chats, so keep it accurate for whoever reads it next. Store ONLY durable, useful facts: what the project is, where key scripts/assets live, naming and code conventions, how the main systems work, decisions and gotchas, and the user's preferences. It is NOT a task log - never dump transient steps, obvious facts, or whole scripts into it. Keep it short.

- READ IT WHEN THE WORK NEEDS IT (not at startup): the FIRST time the user's request requires editing the project or understanding how the game works, read your memory BEFORE doing that work - manage_script with action "read", name "ProjectMemory", path "CipherScript/". Skip it for pure chit-chat or questions unrelated to the project. If it does not exist yet, create it with create_script (name "ProjectMemory", path "CipherScript/") using exactly this skeleton:
${BT}
/* # Project memory
## Overview
## Where things live
## Conventions
## Key systems
## Decisions & gotchas
## User preferences
## Open questions / TODO */
${BT}
- KEEP IT UPDATED: whenever you learn something lasting, edit the right section with script_apply_edits / apply_text_edits (read the file first so your old text matches exactly; the section headers make good anchors). Remove facts that became wrong. Store only what will help you next time - skip everything else.
- IF SOMETHING CONTRADICTS THE MEMORY: do NOT blindly trust either side. First verify against the real project (find_gameobjects / get_sha / read_console / unity_reflect) to find out what is actually true. Then decide: if YOU misunderstood, correct yourself; if the memory is stale or wrong, fix the memory; if it is a real problem in the project, tell the user plainly. Always leave the memory consistent with reality.
- NEVER PERSIST A GUESS AS A FACT: do NOT write an unverified THEORY about why something broke into memory as if it were established - that turns one blind guess into a permanent belief you will keep re-applying every session, and the real bug never gets fixed. Store only what you actually verified. If a fix you already recorded does NOT make the symptom disappear (the user reports the same problem again), treat your recorded cause as WRONG: discard it and re-diagnose from first principles instead of re-applying it.

━━━ YOU CAN ACT DIRECTLY IN THE USER'S PROJECT ━━━
This extension gives you real, live access to the user's Unity project through the commands above - so when a task calls for running code or editing something, you're able to just do it yourself instead of writing instructions for the user to follow (they have no way to paste code back into the Editor - only you can run these commands). If code needs to run in the Editor, use execute_code; if something needs creating or changing, use manage_gameobject / manage_scene / create_script / apply_text_edits. When the user asks to CREATE an object/model with actual geometry (a mesh, a prop, a procedural shape), prefer generate_model / import_model, or build it from primitives with execute_code (GameObject.CreatePrimitive) - reserve primitive-building for simple shapes (cubes, cylinders, positioning). Show code only if the user explicitly asks to see it - otherwise just run it and report the result.

IMPORTANT: Your very first action is to write \`list_commands\` with no params (this defaults to the Unity Editor server) to get the full command reference with parameter details - never guess a command name or parameter that wasn't in that result. Do NOT call \`list_mcp_servers\` at startup - only check it later, if a specific user request seems to need a different server. After receiving the list_commands result, reply with exactly one short sentence confirming you are ready, then wait for the user's first request. (Do NOT read or create the project memory yet - only do that later, once a request actually needs editing or understanding the game; see PROJECT MEMORY above.) If that first list_commands (or any later Unity command) comes back Unity-offline, Unity is down - run \`list_mcp_servers\` once, tell the user in one short sentence that Unity is offline, list what else is connected (if anything), then ask what they want to do and wait - do not act on any other server until they answer.`;

    // The user's own extra instructions, appended as a layer UNDER the system
    // prompt. Optional - empty by default. It cannot change the rules above.
    const extra = customPrompt.trim()
      ? `\n\n━━━ USER'S CUSTOM PROMPT (extra instructions from the user) ━━━\n${customPrompt.trim()}`
      : "";

    // The marker leads the prompt; it tags the bootstrap turn for camouflage.
    return `${SYS_MARKER}\n${prompt}${extra}`;
  }

  // ── Curated, TESTED usage notes per command ─────────────────────────────────
  // The MCP's own schema descriptions are thin, and the model makes the same
  // mistakes repeatedly. These notes target the Unity MCP Toolkit (CoplayDev) tool
  // set. Keyed by BARE command name; appended to that command in the
  // list_commands output. Keep each note tight and concrete - it costs context
  // on every reminder.
  const TOOL_NOTES = {
    execute_code:
      "Runs as a METHOD BODY inside the editor: no class/method wrapper, no using directives - " +
      "UnityEngine and UnityEditor are already imported. Use `return` to send a value back " +
      "(Debug.Log is NOT captured; only the returned value is shown). " +
      "NEVER block the main thread: no while(true), no Thread.Sleep, no blocking waits, no " +
      "coroutines/async - it runs synchronously on a ~30s budget and will TIME OUT. " +
      "Changes in Play mode are reverted when Play stops; for persistent edits, save with " +
      "EditorSceneManager.MarkSceneDirty / SaveOpenScenes or run the menu item 'File/Save Project'. " +
      "Create objects with GameObject.CreatePrimitive / new GameObject and find things with " +
      "GameObject.Find / FindObjectOfType. The `action` param can be get_history / replay / " +
      "clear_history (defaults to execute; CipherScript fills it in).",
    create_script:
      "Create a new C# script under Assets/ (path is relative to Assets/ and must end in /). " +
      "Unity needs a domain reload to compile the new file - after creating, wait for " +
      "compilation to finish (poll refresh_unity / read_console) before relying on the new types.",
    manage_script:
      "Whole-file lifecycle only: action create / read / delete by script name (no .cs) and path " +
      "under Assets/. For EDITS use script_apply_edits (structured, prefer for whole methods) or " +
      "apply_text_edits (raw line/column patches). Read a file BEFORE editing it so your " +
      "replacements match exactly.",
    script_apply_edits:
      "Structured C# edits with balanced-brace guards: replace method, insert method, " +
      "anchor-based insert/replace. Prefer this over raw text edits for whole-method changes. " +
      "Old text must match the file EXACTLY (whitespace included) - read the script first. " +
      "Use apply_text_edits for surgical line/column patches and get_sha to detect drift " +
      "between reads and writes.",
    apply_text_edits:
      "Raw line/column text edits on a C# script identified by URI, with optional SHA " +
      "precondition. Offsets are relative to the CURRENT file content - read the file first " +
      "so your edits match exactly. For whole-method changes prefer script_apply_edits.",
    validate_script:
      "Roslyn-based validation of a C# script - run it after big edits to catch compile errors " +
      "before they reach the console.",
    find_gameobjects:
      "Search for GameObjects in the scene by name, tag, layer, component type, or path. " +
      "Use this (instead of guessing names) before manage_gameobject edits so you address the " +
      "EXACT object the user means.",
    read_console:
      "Gets messages from the Unity console (action defaults to 'get'). Run this after any " +
      "script change or execute_code to catch compile/runtime errors before continuing.",
    get_sha:
      "SHA256 + metadata of a C# script without returning its contents - the cheap way to " +
      "check whether a file changed between your reads and writes.",
    execute_menu_item:
      "Runs any Unity menu item by path, e.g. 'GameObject/Create Empty', 'File/Save Project', " +
      "'Assets/Create/C# Script'. Use list of menu items (unity://menu-items resource) to find " +
      "valid paths.",
    run_tests:
      "Starts a Unity test run ASYNCHRONOUSLY and returns a job_id immediately - poll " +
      "get_test_job with that job_id until the run finishes.",
    manage_gameobject:
      "CRUD on GameObjects (create, update properties/transform, delete). Read first with " +
      "find_gameobjects so you never delete/edit the wrong object.",
    manage_scene:
      "CRUD on Unity scenes (create, load, save, delete, build settings). Save the scene after " +
      "big changes so the user's work is not lost.",
    manage_editor:
      "Queries and drives the editor: telemetry_status / play / pause / stop / undo / redo / " +
      "tags & layers. Use action 'play'/'stop' to start/end play mode instead of pressing the " +
      "play button yourself.",
    unity_reflect:
      "Inspect Unity's LIVE C# API via reflection - use it to check exact type names, method " +
      "signatures and properties BEFORE writing execute_code that calls them.",
    unity_docs:
      "Fetch official Unity documentation for a class/method - use when you are unsure how an " +
      "API works.",
    generate_model:
      "AI 3D model generation (Tripo/Meshy) - needs the user's own API key configured in the " +
      "MCP server. Do not assume it is available; if it fails, fall back to primitives or ask.",
    batch_execute:
      "Runs multiple tool operations in one batch - use for several independent edits to avoid " +
      "many round trips. Still ONE batch per reply.",
  };

  // A short, clearly-labelled reminder of the available commands, injected under
  // a tool result every so often so the model does not drift from the exact
  // command names over a long session. It is explicitly framed as an automatic
  // CipherScript reminder (NOT a user message and NOT a new command to run).
  function toolsReminder(tools) {
    const toolsString =
      "  list_commands() - list all available Unity commands with full parameter details\n" +
      compactTools(tools);
    return (
      "\n\n────────────────────────────────\n" +
      "(System note from CipherScript - this is an automatic REMINDER, not a request and not a new result. " +
      "Do NOT reply to it or run any command because of it; just keep it in mind for your next command.)\n" +
      "Reminder of the Unity commands (use exact names and parameter keys; " +
      "for other connected apps call list_mcp_servers):\n" +
      toolsString
    );
  }

  // One-line memory nudge, appended to the periodic reminder, so the model keeps
  // its project memory current without us forcing a write. Clearly framed as an
  // optional reminder, NOT a command to run right now.
  function memoryNudge() {
    return (
      "(Reminder: if you've learned anything DURABLE about this project since your last memory update " +
      "(architecture, where things live, conventions, decisions, user preferences), update your shared project memory at " +
      "Assets/CipherScript/ProjectMemory.cs with script_apply_edits / apply_text_edits - only useful, lasting facts. " +
      "If nothing changed, ignore this.)"
    );
  }

  return {
    APP_NAME,
    SYS_MARKER,
    FEEDBACK,
    toolCategory,
    buildSystemPrompt,
    compactTools,
    toolsReminder,
    memoryNudge,
    TOOL_NOTES,
  };
})();
