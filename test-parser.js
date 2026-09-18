// Quick Node smoke test for core/parser.js (run: node test-parser.js). Not shipped.
const fs = require("fs");
const CSParse = new Function(fs.readFileSync(__dirname + "/core/parser.js", "utf8") + "; return CSParse;")();

const ok = (name, cond) => { console.log((cond ? "PASS" : "FAIL") + "  " + name); if (!cond) process.exitCode = 1; };

const cs = CSParse.parseToolCalls("###C####\nreturn 1+1;\n###END_C####");
ok("cs block", cs.length === 1 && cs[0].tool === "execute_code" && cs[0].arguments.code === "return 1+1;" && cs[0].arguments.action === "execute");

const csSpaced = CSParse.parseToolCalls("### C# ###\nvar s = \"x\";\n### END_C####");
ok("markdown-mangled cs markers", csSpaced.length === 1 && csSpaced[0].tool === "execute_code");

const csCsharp = CSParse.parseToolCalls("###CSHARP###\nreturn 1;\n###END_CSHARP###");
ok("csharp alias markers", csCsharp.length === 1 && csCsharp[0].tool === "execute_code");

// Kimi bleeds its code-block "Copy" button caption into the block text right
// after a lowercase ###c#### marker: `###c#### Copy <code>`. The extracted
// code must NOT start with "Copy" (Unity MCP Toolkit would reject `Copy ...`).
const csCopy = CSParse.parseToolCalls('###c#### Copy Object.Find("X")\nreturn "dom test done"\n###END_C####');
ok("strips Copy chrome from bare cs block", csCopy.length === 1 && csCopy[0].arguments.code === 'Object.Find("X")\nreturn "dom test done"');
// A genuine identifier called Copy (no trailing space eaten) must survive.
const csCopyIdent = CSParse.parseToolCalls("###C####\nCopy(workspace)\n###END_C####");
ok("keeps legit Copy( identifier", csCopyIdent[0].arguments.code === "Copy(workspace)");

const paramless = CSParse.parseToolCalls('{"command":"list_commands"}');
ok("paramless command", paramless.length === 1 && paramless[0].tool === "list_commands");

const braces = CSParse.parseToolCalls('{"command":"manage_gameobject","params":{"name":"if x then {y} end"}}');
ok("braces inside string value", braces.length === 1 && braces[0].arguments.name === "if x then {y} end");

const legacy = CSParse.parseToolCalls('{"tool":"find_gameobjects","arguments":{"name":"Player"}}');
ok("legacy tool/arguments schema", legacy.length === 1 && legacy[0].tool === "find_gameobjects");

const mcp = CSParse.parseToolCalls('###MCP_TOOL###\n{"command":"manage_scene"}\n###END_MCP_TOOL###');
ok("mcp_tool wrapper", mcp.length === 1 && mcp[0].tool === "manage_scene");

ok("open cs block detected", CSParse.hasOpenToolBlock("###C####\nvar x=1") === true);
ok("closed cs block not open", CSParse.hasOpenToolBlock("###C####\nreturn 1;\n###END_C####") === false);
ok("open json command detected", CSParse.hasOpenToolBlock('{"command":"script_apply_edits","params":{"a":1') === true);

ok("prose has no signature", CSParse.hasToolSignature("Here is how you could use a command in theory.") === false);
ok("command shape detected", CSParse.hasCommandShape('{"command":"x"}') === true);
ok("injected feedback detected", CSParse.isInjectedFeedback("Output of 'execute_code':\n2") === true);
ok("parse-error note is feedback not command", CSParse.isInjectedFeedback('ERROR: bad JSON, write {"command": "name"}') === true);
ok("tool name mid-stream", CSParse.toolNameFromText('{"command":"manage_gameob') === "manage_gameob");

// ── salvageCutOff: auto-close a command whose trailing closers were cut ──
// A big script edit missing exactly ONE final "}".
const cut1 = CSParse.salvageCutOff('{"command": "apply_text_edits", "params": {"uri": "file:///Assets/Scripts/Player.cs", "edits": [{"old_string": "a", "new_string": "b"}]}');
ok("salvage: one missing root brace", cut1 && cut1.tool === "apply_text_edits" && cut1.arguments.edits.length === 1);
// Two missing closers (params + root) still salvages.
const cut2 = CSParse.salvageCutOff('{"command": "manage_scene", "params": {"verbose": true');
ok("salvage: two missing closers", cut2 && cut2.tool === "manage_scene" && cut2.arguments.verbose === true);
// Cut MID-STRING = real content amputated -> refuse.
ok("salvage refuses mid-string cut", CSParse.salvageCutOff('{"command": "apply_text_edits", "params": {"edits": [{"old_string": "elseif command ==') === null);
// Deep deficit (cut between edits: ] } } missing = 3 closers) -> refuse.
ok("salvage refuses deep deficit", CSParse.salvageCutOff('{"command": "apply_text_edits", "params": {"edits": [{"old_string": "a", "new_string": "b"}') === null);
// A CLOSED command is not salvage's business.
ok("salvage ignores closed command", CSParse.salvageCutOff('{"command": "list_commands"}') === null);
// Dangling comma after the last complete value = incomplete next value -> refuse.
ok("salvage refuses trailing comma", CSParse.salvageCutOff('{"command": "apply_text_edits", "params": {"edits": [{"old_string": "a"},') === null);
// Escaped quotes inside values must not confuse the string tracking.
const cutEsc = CSParse.salvageCutOff('{"command": "execute_code", "params": {"code": "print(\\"hi\\")", "action": "execute"}');
ok("salvage handles escaped quotes", cutEsc && cutEsc.tool === "execute_code" && cutEsc.arguments.code === 'print("hi")');

console.log(process.exitCode ? "\nSOME TESTS FAILED" : "\nALL TESTS PASSED");
