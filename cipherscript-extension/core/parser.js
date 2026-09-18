// SPDX-License-Identifier: GPL-3.0-or-later
// core/parser.js - CipherScript command parsing. PURE string logic, zero DOM:
// the provider extracts a turn's text from the site's DOM; everything here
// operates on that text. The command formats (###C#### blocks, {"command":…}
// JSON) are defined by OUR system prompt, so they are the same on every AI site
// - only the way a site's markdown may mangle them differs (the regexes below
// are whitespace/dash tolerant for that reason).
// eslint-disable-next-line no-unused-vars
const CSParse = (() => {
  "use strict";

  const START_M = "###MCP_TOOL###";
  const END_M = "###END_MCP_TOOL###";
  // Whitespace-tolerant markers: site markdown can insert spaces around the
  // hashes (e.g. "### C# ###") or render END_C# with a dash. These regexes
  // match those variants so a marker mangled by markdown still parses.
  // `###C####` (and its alias `###CSHARP###`) selects the C# code-execution
  // tool the parser maps a bare block to (execute_code, see below).
  const CS_START_RE = /###\s*(?:c\s*#|csharp|cs)\s*(?:###|---)/i;
  const CS_END_RE = /###\s*end[_\- ]?(?:c\s*#|csharp|cs)\s*###/i;

  // Find the first C# start marker at or after `from`. Returns { pos, len }
  // where len is the marker's own length to skip past it.
  function findCodeStart(text, from = 0) {
    const m = CS_START_RE.exec(text.slice(from));
    return m ? { pos: from + m.index, len: m[0].length } : { pos: -1, len: 0 };
  }

  // Find the first C# end marker at or after `from`. Returns its start index or -1.
  function findCodeEnd(text, from = 0) {
    const m = CS_END_RE.exec(text.slice(from));
    return m ? from + m.index : -1;
  }

  // Strip a code-block UI label (the "Copy" button caption, or a leftover fence
  // language token like "json") that some sites bleed into the block's text
  // right after the opening marker. Seen live on Kimi: its code-block chrome
  // renders as `###C#### Copy <code>`, so the bare-marker slice below would
  // capture `Copy task.wait(...)` as the C# code. The JSON path already does
  // this at line ~206; mirror it for the raw ###C#### extraction. Requires
  // trailing whitespace (\s+) so it never eats a legitimate identifier like
  // `Copy(x)` that a script might genuinely start with.
  function stripCodeChrome(code) {
    return code.replace(/^(?:json|copy)\s+/i, "");
  }

  // A command is `{"command":"name", ...}` (or "tool"). The params/arguments
  // object is OPTIONAL: paramless commands like list_commands are written as
  // `{"command":"list_commands"}`, so requiring "params" too would MISS them
  // (they'd be shown raw and never executed). We key on the `"command":"…"` /
  // `"tool":"…"` shape instead - a string-valued key, which prose almost never
  // contains - so paramless calls are detected without false-positiving on text.
  const CMD_KEY_RE = /"(?:command|tool)"\s*:\s*"/;

  function hasToolSignature(r) {
    return (
      r.includes(START_M) ||
      r.includes("MCP_TOOL") ||
      CS_START_RE.test(r) ||
      CMD_KEY_RE.test(r)
    );
  }

  // True if the reply contains a tool block that has STARTED but not yet CLOSED
  // (a ###C#### / ###MCP_TOOL### opener with no matching end marker). Used by the
  // response watcher to avoid finalizing a command that is still being streamed.
  function hasOpenToolBlock(r) {
    if (!r) return false;
    const { pos: ls, len } = findCodeStart(r);
    if (ls !== -1 && findCodeEnd(r, ls + len) === -1) return true;
    const sm = r.indexOf(START_M);
    if (sm !== -1) {
      const low = r.toLowerCase();
      if (low.indexOf("###end_mcp_tool###", sm) === -1 && low.indexOf("###end-mcp_tool###", sm) === -1) return true;
    }
    // An inline JSON command ({"command"/"tool": …}) whose object has NOT closed yet
    // is still being streamed (a big multi_edit can take many seconds). Treat it as
    // open so the watcher keeps waiting instead of finalizing - and failing to parse -
    // half a command, which would drop the tool and end the turn as plain text.
    for (const key of ['"command"', '"tool"']) {
      const k = r.indexOf(key);
      if (k === -1) continue;
      const open = r.lastIndexOf("{", k);
      if (open !== -1 && matchBrace(r, open) === -1) return true;
    }
    return false;
  }

  // Normalise a parsed JSON object into { tool, arguments }, accepting both the
  // new CipherScript schema ("command"/"params") and the legacy/function-calling
  // schema ("tool"/"arguments"/"name"/"args"). Returns null if not a valid call.
  function normalizeCall(o) {
    if (!o || typeof o !== "object") return null;
    const name = o.command != null ? o.command : (o.tool != null ? o.tool : o.name);
    let args = o.params != null ? o.params : (o.arguments != null ? o.arguments : o.args);
    if (typeof name !== "string" || !name) return null;
    if (!args || typeof args !== "object") args = {};
    return { tool: name, arguments: args };
  }

  // String-aware matching-brace finder: index of the "}" that closes the "{" at
  // `start`, SKIPPING braces inside JSON string literals (escaped quotes handled).
  // A naive depth counter miscounts the braces embedded in code passed as a string
  // value (e.g. apply_text_edits' edits / a C# snippet), grabs the wrong end, and
  // makes JSON.parse fail - which silently dropped the command, so the tool never ran
  // and the turn was treated as a plain-text answer. Returns -1 if unbalanced.
  function matchBrace(text, start) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") { if (--depth === 0) return i; }
    }
    return -1;
  }

  // JSON.parse with a fallback for RAW control characters inside string
  // literals (tab/newline/CR). Models sometimes emit a literal TAB instead of
  // \t inside a command's string value (seen live on Gemini in a big
  // multi_edit); strict JSON rejects it, the parse failed silently and the
  // command was never executed. The fallback walks the text string-aware and
  // escapes those characters ONLY inside string literals, then re-parses.
  function parseLoose(raw) {
    try {
      return JSON.parse(raw);
    } catch (e0) {
      let out = "", inStr = false, esc = false;
      for (const c of raw) {
        if (inStr) {
          if (esc) { esc = false; out += c; continue; }
          if (c === "\\") { esc = true; out += c; continue; }
          if (c === '"') { inStr = false; out += c; continue; }
          if (c === "\t") { out += "\\t"; continue; }
          if (c === "\n") { out += "\\n"; continue; }
          if (c === "\r") { out += "\\r"; continue; }
          out += c;
          continue;
        }
        if (c === '"') inStr = true;
        out += c;
      }
      return JSON.parse(out); // may still throw - callers catch
    }
  }

  function extractJson(raw) {
    raw = raw.trim().replace(/^(?:json|JSON)\s*/, "");
    raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    const s = raw.indexOf("{");
    if (s === -1) return null;
    const e = matchBrace(raw, s);            // string-aware: not the last "}" in code
    if (e === -1) return null;
    try {
      return parseLoose(raw.slice(s, e + 1));
    } catch {
      return null;
    }
  }

  function extractToolAnywhere(text) {
    for (const key of ['"command"', '"tool"']) {
      let pos = 0;
      while (true) {
        const s = text.indexOf(key, pos);
        if (s === -1) break;
        const start = text.lastIndexOf("{", s);
        if (start === -1) { pos = s + 1; continue; }
        const end = matchBrace(text, start); // string-aware brace matching
        if (end === -1) { pos = s + 1; continue; }
        try {
          const call = normalizeCall(parseLoose(text.slice(start, end + 1)));
          if (call) return call;
        } catch {}
        pos = s + 1;
      }
    }
    return null;
  }

  function parseToolCalls(r) {
    // Lowercase for case-insensitive end-marker search. Models write
    // ###end_mcp_tool### (underscore) or ###end-mcp_tool### (dash).
    const rLow = r.toLowerCase();
    const findEndM = (from) => {
      const a = rLow.indexOf("###end_mcp_tool###", from);
      const b = rLow.indexOf("###end-mcp_tool###", from);
      if (a === -1 && b === -1) return -1;
      if (a === -1) return b;
      if (b === -1) return a;
      return Math.min(a, b);
    };
    const out = [];
    let from = 0;
    while (true) {
      const sm = r.indexOf(START_M, from);
      if (sm === -1) break;
      const em = findEndM(sm);
      if (em === -1) break;
      const body = r.slice(sm + START_M.length, em);
      const { pos: cs, len: csLen } = findCodeStart(body);
      const ce = findCodeEnd(body, cs === -1 ? 0 : cs + csLen);
      if (cs !== -1 && ce !== -1 && ce > cs) {
        out.push({ tool: "execute_code", arguments: { action: "execute", code: stripCodeChrome(body.slice(cs + csLen, ce).trim()) } });
        from = em + END_M.length;
        continue;
      }
      for (const sub of body.split(START_M)) {
        const cleaned = sub.trim().replace(/^(?:json|JSON|Copy|copy)\s*/i, "").trim();
        if (!cleaned) continue;
        const p = normalizeCall(extractJson(cleaned));
        if (p) out.push(p);
      }
      from = em + END_M.length;
    }
    // Prefer a JSON command envelope when one is present: a model may wrap
    // execute_code as {"command":"execute_code","params":{"code":"###C####…"}},
    // and the bare-marker fallback below would slice the still-ESCAPED JSON
    // source (literal \n, \") instead of the decoded code. extractToolAnywhere
    // JSON-decodes it; cleanCodeCall (applied at the end) then strips the markers.
    if (out.length === 0) {
      const f = extractToolAnywhere(r);
      if (f) out.push(f);
    }
    // Bare ###C#### … ###END_C#### block with no JSON envelope at all.
    if (out.length === 0) {
      const { pos: cs, len: csLen } = findCodeStart(r);
      const ce = findCodeEnd(r, cs === -1 ? 0 : cs + csLen);
      if (cs !== -1 && ce !== -1 && ce > cs) {
        out.push({ tool: "execute_code", arguments: { action: "execute", code: stripCodeChrome(r.slice(cs + csLen, ce).trim()) } });
      }
    }
    return out.map(cleanCodeCall);
  }

  // Some models wrap execute_code in the JSON envelope AND keep the
  // ###C#### / ###END_C#### markers INSIDE the code string, e.g.
  //   {"command":"execute_code","params":{"code":"###C####\n<code>\n###END_C####"}}
  // Once JSON-decoded the code still starts with the literal markers, which the
  // MCP rejects. Strip a leading start marker and a trailing end marker from
  // execute_code's code. No-op for a clean code string.
  function cleanCodeCall(call) {
    if (!call || call.tool !== "execute_code") return call;
    const code = call.arguments && call.arguments.code;
    if (typeof code !== "string") return call;
    const s = findCodeStart(code);
    if (s.pos === -1) return call;
    const e = findCodeEnd(code, s.pos + s.len);
    call.arguments.code = code.slice(s.pos + s.len, e === -1 ? code.length : e).trim();
    if (!call.arguments.action) call.arguments.action = "execute";
    return call;
  }

  // Last-resort salvage of a CUT-OFF JSON command: the model hit its output
  // limit with the whole payload complete but the trailing closers missing
  // (seen live on Qwen: a big multi_edit missing exactly ONE final "}").
  // Strictly conservative - we only auto-close when it is provably just the
  // closing sequence that was lost, never when actual content was amputated:
  //  - the scan must NOT end inside a string literal (a value cut mid-string
  //    means real content is missing → keep the parse_error);
  //  - the last non-whitespace char must terminate a complete JSON value
  //    (`"`, `}`, `]`, digit, or the tail of true/false/null);
  //  - at most MAX_SALVAGE_CLOSERS closers may be appended. 2 covers the
  //    root-brace and params-brace cases; a deeper deficit usually means the
  //    cut fell between items (e.g. mid-edits-array), where running a partial
  //    command would be dangerous - the retry feedback stays the right call.
  // Callers must only invoke this once generation has ENDED (the watcher's
  // parse_error branch), never on a still-streaming reply.
  const MAX_SALVAGE_CLOSERS = 2;
  function salvageCutOff(text) {
    for (const key of ['"command"', '"tool"']) {
      const k = text.indexOf(key);
      if (k === -1) continue;
      const start = text.lastIndexOf("{", k);
      if (start === -1) continue;
      if (matchBrace(text, start) !== -1) continue; // closed → not our case
      // String-aware bracket stack from the opener to the end of the text.
      const stack = [];
      let inStr = false, esc = false;
      for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (inStr) {
          if (esc) esc = false;
          else if (c === "\\") esc = true;
          else if (c === '"') inStr = false;
        } else if (c === '"') inStr = true;
        else if (c === "{") stack.push("}");
        else if (c === "[") stack.push("]");
        else if (c === "}" || c === "]") {
          if (stack.pop() !== c) return null; // mismatched nesting → hopeless
        }
      }
      if (inStr) return null;                       // cut mid-string value
      if (!stack.length || stack.length > MAX_SALVAGE_CLOSERS) return null;
      const body = text.slice(start).trimEnd();
      if (!/[""}\]0-9]$|(?:true|false|null)$/.test(body)) return null; // value incomplete
      try {
        const call = normalizeCall(parseLoose(body + stack.reverse().join("")));
        if (call) return cleanCodeCall(call);
      } catch {}
      return null;
    }
    return null;
  }

  function toolNameFromText(txt) {
    // Match the name even BEFORE its closing quote (`[^"]*`), so the chip shows
    // the real command name AS IT IS TYPED instead of a generic "command"
    // placeholder until the JSON closes. A still-empty value falls through.
    // Trim: while the value is still streaming it can be whitespace-only (e.g.
    // Kimi renders `"tool": "    "` for a beat), which would otherwise show a
    // blank chip label until the loop repaints it. A whitespace value falls
    // through to the placeholder below instead.
    const m = txt.match(/"(?:command|tool)"\s*:\s*"([^"]*)/);
    if (m && m[1].trim()) return m[1].trim();
    if (txt.includes("execute_code") || CS_START_RE.test(txt)) return "execute_code";
    return "command";
  }

  // A turn the EXTENSION injected (always sent as a user turn): a tool result, an
  // ERROR, or a "(System note: …)" control message. Matched ONLY by the fixed
  // shapes we emit - never by command-like keywords, since a parse-error note
  // quotes a {"command": …} example that must NOT be read as a real command.
  function isInjectedFeedback(txt) {
    return /^\s*Output of '/.test(txt) ||
           /^\s*ERROR\b/.test(txt) ||
           /^\s*\(System note:/.test(txt);
  }

  // The assistant emitted a CipherScript command (JSON or a ###C#### block).
  function hasCommandShape(txt) {
    return txt.includes(START_M) ||
           CS_START_RE.test(txt) ||
           CMD_KEY_RE.test(txt); // command/tool with OR without params (e.g. list_commands)
  }

  return {
    START_M, END_M, CS_START_RE, CS_END_RE, CMD_KEY_RE,
    findCodeStart, findCodeEnd, matchBrace, extractJson, normalizeCall,
    hasToolSignature, hasOpenToolBlock, parseToolCalls, salvageCutOff, toolNameFromText,
    isInjectedFeedback, hasCommandShape,
  };
})();
