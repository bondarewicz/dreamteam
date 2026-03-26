import type { EvalResult } from "../db.ts";
import { esc, ms, cost } from "./html.ts";

const AGENT_COLORS: Record<string, string> = {
  bird: "#3fb950", mj: "#58a6ff", shaq: "#bc8cff",
  kobe: "#f85149", pippen: "#39d2c0", magic: "#d29922"
};

const TOOL_RESULT_CAP = 10000;
const TOOL_INPUT_CAP = 5000;

type Counter = { value: number };

function nextId(counter: Counter): number {
  return ++counter.value;
}

function hEsc(s: unknown): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function truncateText(text: string, cap: number): { display: string; full: string; truncated: boolean } {
  if (text.length <= cap) return { display: text, full: text, truncated: false };
  return { display: text.slice(0, cap), full: text, truncated: true };
}

function renderTruncatable(text: string, cap: number, cssClass: string, counter: Counter): string {
  const { display, full, truncated } = truncateText(text, cap);
  if (!truncated) {
    return `<div class="${cssClass}">${hEsc(display)}</div>`;
  }
  const uid = nextId(counter);
  const totalChars = full.length;
  return (
    `<div class="truncated-content ${cssClass}" id="trunc-${uid}">${hEsc(display)}</div>` +
    `<div class="full-content ${cssClass}" id="full-${uid}">${hEsc(full)}</div>` +
    `<button class="show-full-btn" onclick="toggleFull(${uid})">show full output (${totalChars.toLocaleString()} chars)</button>`
  );
}

type ContentBlock = {
  type: string;
  text?: string;
  thinking?: string;
  signature?: string;
  name?: string;
  id?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  [key: string]: unknown;
};

type TraceEvent = {
  type: string;
  message?: {
    role?: string;
    content?: ContentBlock[] | string;
    model?: string;
    id?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
    stop_reason?: string;
    service_tier?: string;
  };
  system?: string | Record<string, unknown>;
  subtype?: string;
  cwd?: string;
  session_id?: string;
  tools?: string[];
  mcp_servers?: Array<{name: string; status: string}>;
  model?: string;
  permissionMode?: string;
  claude_code_version?: string;
  stop_reason?: string;
  num_turns?: number;
  duration_api_ms?: number;
  duration_ms?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  total_cost_usd?: number;
  context_window?: number | string;
  max_output_tokens?: number | string;
  permission_denials?: unknown[];
  [key: string]: unknown;
};

function renderTraceEvent(event: TraceEvent, stepNum: number, counter: Counter): { html: string; stepsRendered: number } {
  const etype = event.type ?? "unknown";
  const parts: string[] = [];
  let localStep = stepNum;

  if (etype === "system") {
    const sysText = typeof event.system === "string"
      ? event.system
      : event.system ? JSON.stringify(event.system) : "";
    const preview = sysText
      ? `<div class="step-preview">${hEsc(sysText.slice(0, 200))}</div>`
      : `<div class="step-preview"><span style="color:var(--text-muted)">(system init)</span></div>`;
    parts.push(`  <div class="trace-step">
    <div class="step-gutter"><div class="step-number">${localStep}</div><div class="step-line"></div></div>
    <div class="step-content">
      <div class="step-label system"><div class="step-type-dot"></div>System</div>
      ${preview}
    </div>
  </div>`);
    localStep++;

  } else if (etype === "rate_limit_event") {
    // Skip — not useful for debugging
    return { html: "", stepsRendered: 0 };

  } else if (etype === "assistant") {
    const message = event.message ?? {};
    let content: ContentBlock[] = [];
    if (Array.isArray(message.content)) {
      content = message.content as ContentBlock[];
    } else if (typeof message.content === "string") {
      content = [{ type: "text", text: message.content }];
    }

    const thinkingBlocks = content.filter(c => c.type === "thinking");
    const textBlocks = content.filter(c => c.type === "text");
    const toolBlocks = content.filter(c => c.type === "tool_use");

    for (const tb of thinkingBlocks) {
      const thinkingHtml = renderTruncatable(tb.thinking ?? "", TOOL_INPUT_CAP, "thinking-block", counter);
      parts.push(`  <div class="trace-step">
    <div class="step-gutter"><div class="step-number">${localStep}</div><div class="step-line"></div></div>
    <div class="step-content">
      <div class="step-label assistant"><div class="step-type-dot"></div>Assistant</div>
      <div class="thinking-label">Thinking</div>
      ${thinkingHtml}
    </div>
  </div>`);
      localStep++;
    }

    if (textBlocks.length > 0) {
      let rawText = textBlocks.map(c => c.text ?? "").join("\n");
      // Pretty-print JSON if it looks like JSON
      const stripped = rawText.trim();
      if (stripped.startsWith("{") || stripped.startsWith("[")) {
        try {
          const parsed = JSON.parse(stripped);
          rawText = JSON.stringify(parsed, null, 2);
        } catch { /* keep original */ }
      }
      const textOutputHtml = renderTruncatable(rawText, TOOL_RESULT_CAP, "step-text-output", counter);

      // Metadata chips from usage
      const usage = message.usage ?? {};
      let metaChipsHtml = "";
      const inTok = usage.input_tokens ?? 0;
      const outTok = usage.output_tokens ?? 0;
      const cacheRead = usage.cache_read_input_tokens ?? 0;
      const cacheCreated = usage.cache_creation_input_tokens ?? 0;
      const totalIn = inTok + cacheRead + cacheCreated;
      const cachePct = totalIn > 0 ? Math.round(100 * cacheRead / totalIn) : 0;
      const cacheClass = cacheRead > 0 ? "cache-hit" : "cache-miss";
      const stopReason = message.stop_reason ?? "";
      const serviceTier = message.service_tier ?? "";

      const chips: string[] = [];
      if (inTok || outTok) {
        chips.push(`<div class="meta-chip"><span class="chip-label">in:</span><span class="chip-value">${inTok.toLocaleString()}</span></div>`);
        chips.push(`<div class="meta-chip"><span class="chip-label">out:</span><span class="chip-value">${outTok.toLocaleString()}</span></div>`);
        chips.push(`<div class="meta-chip ${cacheClass}"><span class="chip-label">cache:</span><span class="chip-value">${cacheRead.toLocaleString()} (${cachePct}%)</span></div>`);
      }
      if (serviceTier) chips.push(`<div class="meta-chip"><span class="chip-label">tier:</span><span class="chip-value">${hEsc(serviceTier)}</span></div>`);
      if (stopReason) chips.push(`<div class="meta-chip"><span class="chip-label">stop:</span><span class="chip-value">${hEsc(stopReason)}</span></div>`);
      if (chips.length > 0) metaChipsHtml = `<div class="step-meta">${chips.join("")}</div>`;

      parts.push(`  <div class="trace-step">
    <div class="step-gutter"><div class="step-number">${localStep}</div><div class="step-line"></div></div>
    <div class="step-content">
      <div class="step-label assistant"><div class="step-type-dot"></div>Assistant</div>
      ${textOutputHtml}
      ${metaChipsHtml}
    </div>
  </div>`);
      localStep++;
    }

    for (const tc of toolBlocks) {
      const toolName = tc.name ?? "unknown";
      const toolInput = tc.input ?? {};
      const toolUseId = tc.id ?? "";

      let inputBoxHtml = "";
      if (typeof toolInput === "object" && toolInput !== null && !Array.isArray(toolInput)) {
        const inputLines: string[] = [];
        for (const [k, v] of Object.entries(toolInput as Record<string, unknown>).slice(0, 10)) {
          const valStr = typeof v === "string" ? v : JSON.stringify(v);
          const { display, full, truncated } = truncateText(valStr, TOOL_INPUT_CAP);
          let valFragment: string;
          if (truncated) {
            const uid = nextId(counter);
            const totalChars = full.length;
            valFragment = (
              `<span class="truncated-content val" id="trunc-${uid}">${hEsc(display)}</span>` +
              `<span class="full-content val" id="full-${uid}">${hEsc(full)}</span>` +
              `<button class="show-full-btn" onclick="toggleFull(${uid})">show full output (${totalChars.toLocaleString()} chars)</button>`
            );
          } else {
            valFragment = `<span class="val">${hEsc(display)}</span>`;
          }
          inputLines.push(`<span class="key">${hEsc(k)}:</span> ${valFragment}`);
        }
        inputBoxHtml = `<div class="tool-input">${inputLines.join("\n")}</div>`;
      } else {
        inputBoxHtml = renderTruncatable(JSON.stringify(toolInput), TOOL_INPUT_CAP, "tool-input", counter);
      }

      const toolIdChip = toolUseId
        ? `<div class="step-meta"><div class="meta-chip"><span class="chip-label">tool_use_id:</span><span class="chip-value">${hEsc(toolUseId)}</span></div></div>`
        : "";

      parts.push(`  <div class="trace-step">
    <div class="step-gutter"><div class="step-number">${localStep}</div><div class="step-line"></div></div>
    <div class="step-content">
      <div class="step-label tool-call"><div class="step-type-dot"></div>Tool Call</div>
      <div class="step-tool-name"><span class="tool-fn">${hEsc(toolName)}</span></div>
      ${inputBoxHtml}
      ${toolIdChip}
    </div>
  </div>`);
      localStep++;
    }

    if (!thinkingBlocks.length && !textBlocks.length && !toolBlocks.length) {
      const rawContent = JSON.stringify(content).slice(0, 400);
      parts.push(`  <div class="trace-step">
    <div class="step-gutter"><div class="step-number">${localStep}</div><div class="step-line"></div></div>
    <div class="step-content">
      <div class="step-label assistant"><div class="step-type-dot"></div>Assistant</div>
      <div class="step-preview">${hEsc(rawContent)}</div>
    </div>
  </div>`);
      localStep++;
    }

  } else if (etype === "user") {
    const message = event.message ?? {};
    const content: ContentBlock[] = Array.isArray(message.content) ? (message.content as ContentBlock[]) : [];
    const toolResults = content.filter(c => c.type === "tool_result");

    if (toolResults.length > 0) {
      for (const tr of toolResults) {
        let trText = "";
        if (Array.isArray(tr.content)) {
          trText = (tr.content as ContentBlock[])
            .filter(c => c.type === "text")
            .map(c => c.text ?? "")
            .join("\n");
        } else if (typeof tr.content === "string") {
          trText = tr.content;
        }
        const resultLen = trText.length;
        const lenLabel = resultLen < 10000 ? `${resultLen} chars` : `${Math.floor(resultLen / 1000)}k chars`;
        const trResultHtml = renderTruncatable(trText, TOOL_RESULT_CAP, "tool-result-box", counter);
        const parentId = tr.tool_use_id ?? "";
        const parentChip = parentId
          ? `<div class="step-meta"><div class="meta-chip"><span class="chip-label">parent:</span><span class="chip-value">${hEsc(parentId)}</span></div></div>`
          : "";

        parts.push(`  <div class="trace-step">
    <div class="step-gutter"><div class="step-number">${localStep}</div><div class="step-line"></div></div>
    <div class="step-content">
      <div class="step-label tool-result"><div class="step-type-dot"></div>Tool Result <span style="font-size:10px;color:var(--text-muted);font-weight:400;margin-left:4px">${hEsc(lenLabel)}</span></div>
      ${trResultHtml}
      ${parentChip}
    </div>
  </div>`);
        localStep++;
      }
    } else {
      const rawMsg = JSON.stringify(message).slice(0, 400);
      parts.push(`  <div class="trace-step">
    <div class="step-gutter"><div class="step-number">${localStep}</div><div class="step-line"></div></div>
    <div class="step-content">
      <div class="step-label tool-result"><div class="step-type-dot"></div>Tool Result</div>
      <div class="tool-result-box">${hEsc(rawMsg)}</div>
    </div>
  </div>`);
      localStep++;
    }

  } else if (etype === "result") {
    const stopReason = event.stop_reason ?? "end_turn";
    const numTurns = event.num_turns;
    const durationApiMs = event.duration_api_ms ?? 0;
    const durationMs2 = event.duration_ms ?? 0;
    const usage = event.usage ?? {};
    const inTok = usage.input_tokens ?? 0;
    const outTok = usage.output_tokens ?? 0;
    const cacheRead = usage.cache_read_input_tokens ?? 0;
    const cacheCreated = usage.cache_creation_input_tokens ?? 0;
    const costVal = event.total_cost_usd ?? 0;
    const ctxWindow = event.context_window;
    const maxOutput = event.max_output_tokens;
    const denials = event.permission_denials ?? [];
    const denialCount = denials.length;

    const durS = durationMs2 ? `${(durationMs2 / 1000).toFixed(1)}s` : "—";
    const apiS = durationApiMs ? `${(durationApiMs / 1000).toFixed(1)}s` : "—";
    const ctxDisplay = typeof ctxWindow === "number" && ctxWindow > 0
      ? `${Math.floor(ctxWindow / 1000)}k`
      : ctxWindow ? String(ctxWindow) : "—";
    const maxOutDisplay = typeof maxOutput === "number" && maxOutput > 0
      ? `${Math.floor(maxOutput / 1000)}k`
      : maxOutput ? String(maxOutput) : "—";
    const cacheReadStyle = cacheRead > 0 ? "color:var(--pass)" : "";
    const denialStyle = denialCount > 0 ? "color:var(--fail)" : "color:var(--pass)";
    const denialDisplay = denialCount === 0 ? "none" : String(denialCount);

    parts.push(`  <div class="trace-step">
    <div class="step-gutter"><div class="step-number">${localStep}</div></div>
    <div class="step-content">
      <div class="step-label system"><div class="step-type-dot"></div>Result</div>
      <div class="result-summary">
        <div class="result-item"><span class="result-label">Stop Reason</span><span class="result-value">${hEsc(String(stopReason))}</span></div>
        <div class="result-item"><span class="result-label">Turns</span><span class="result-value">${numTurns != null ? hEsc(String(numTurns)) : "—"}</span></div>
        <div class="result-item"><span class="result-label">Duration</span><span class="result-value">${hEsc(durS)}</span></div>
        <div class="result-item"><span class="result-label">API Time</span><span class="result-value">${hEsc(apiS)}</span></div>
        <div class="result-item"><span class="result-label">Input Tokens</span><span class="result-value">${inTok.toLocaleString()}</span></div>
        <div class="result-item"><span class="result-label">Output Tokens</span><span class="result-value">${outTok.toLocaleString()}</span></div>
        <div class="result-item"><span class="result-label">Cache Read</span><span class="result-value" style="${cacheReadStyle}">${cacheRead.toLocaleString()}</span></div>
        <div class="result-item"><span class="result-label">Cache Created</span><span class="result-value">${cacheCreated.toLocaleString()}</span></div>
        <div class="result-item"><span class="result-label">Cost</span><span class="result-value">$${costVal.toFixed(4)}</span></div>
        <div class="result-item"><span class="result-label">Context Window</span><span class="result-value">${hEsc(ctxDisplay)}</span></div>
        <div class="result-item"><span class="result-label">Max Output</span><span class="result-value">${hEsc(maxOutDisplay)}</span></div>
        <div class="result-item"><span class="result-label">Permission Denials</span><span class="result-value" style="${denialStyle}">${hEsc(denialDisplay)}</span></div>
      </div>
    </div>
  </div>`);
    localStep++;

  } else {
    const rawEvent = JSON.stringify(event).slice(0, 300);
    parts.push(`  <div class="trace-step">
    <div class="step-gutter"><div class="step-number">${localStep}</div><div class="step-line"></div></div>
    <div class="step-content">
      <div class="step-label system"><div class="step-type-dot"></div>${hEsc(etype)}</div>
      <div class="step-preview">${hEsc(rawEvent)}</div>
    </div>
  </div>`);
    localStep++;
  }

  return { html: parts.join("\n"), stepsRendered: localStep - stepNum };
}

export function TraceViewerPage(result: EvalResult, runId: string): string {
  // Create a fresh counter per request to avoid race conditions on concurrent renders
  const counter: Counter = { value: 0 };

  const runIdEncoded = encodeURIComponent(runId);

  // Parse trace
  let trace: TraceEvent[] = [];
  if (result.trace) {
    try {
      const parsed = JSON.parse(result.trace);
      trace = Array.isArray(parsed) ? parsed : [];
    } catch { /* skip */ }
  }

  // Parse observations
  type Observation = { type: "positive" | "negative"; text: string };
  let observations: Observation[] = [];
  if (result.observations) {
    try { observations = JSON.parse(result.observations); } catch { /* skip */ }
  }

  // Parse grader results
  type GraderResult = { type: string; config?: Record<string, unknown>; passed: boolean; detail?: string };
  let graderResults: GraderResult[] = [];
  if (result.grader_results) {
    try { graderResults = JSON.parse(result.grader_results); } catch { /* skip */ }
  }

  const agentLower = result.agent.toLowerCase();
  const agentColor = AGENT_COLORS[agentLower] ?? "#7d8590";
  const scoreClass = result.score === "pass" ? "pass" : result.score === "partial" ? "partial" : "fail";
  const scoreLabel = result.score.charAt(0).toUpperCase() + result.score.slice(1);
  const scenarioName = result.scenario_name ?? result.scenario_id;

  // Extract session info from the first system event in trace
  let model = "—";
  let sessionId = "—";
  let cliVersion = "—";
  let permissionMode = "—";
  let toolsCount = "—";
  let fastMode = "—";
  let mcpServers: string[] = [];
  let permissionDenials = 0;

  for (const event of trace) {
    if (event.type === "system") {
      model = String(event.model ?? "—");
      sessionId = String(event.session_id ?? "—");
      cliVersion = String(event.claude_code_version ?? "—");
      permissionMode = String(event.permissionMode ?? "—");
      const tools = Array.isArray(event.tools) ? event.tools : [];
      toolsCount = `${tools.length} tools`;
      fastMode = event.fast_mode_state === "on" ? "on" : "off";
      if (Array.isArray(event.mcp_servers)) {
        mcpServers = (event.mcp_servers as Array<{name: string; status: string}>).map(s => `${s.name} (${s.status})`);
      }
      break;
    }
  }

  // Count permission denials from result event
  for (const event of trace) {
    if (event.type === "result" && Array.isArray(event.permission_denials)) {
      permissionDenials = event.permission_denials.length;
    }
  }

  const sessionIdShort = sessionId.length > 14 ? sessionId.slice(0, 14) + "..." : sessionId;

  const durationStr = result.duration_ms ? ms(result.duration_ms) : "—";
  const costStr = result.cost_usd ? cost(result.cost_usd) : "—";

  // Count total trace steps rendered
  let totalSteps = 0;
  let totalOutputTokens = 0;
  for (const event of trace) {
    if (event.type === "result" && event.usage) {
      totalOutputTokens = event.usage.output_tokens ?? 0;
    }
  }

  // Build trace steps HTML
  const traceStepsHtml = trace.map(event => {
    const { html, stepsRendered } = renderTraceEvent(event, totalSteps + 1, counter);
    totalSteps += stepsRendered;
    return html;
  }).filter(h => h.length > 0).join("\n");

  const traceStatsStr = [
    totalSteps > 0 ? `${totalSteps} steps` : null,
    totalOutputTokens > 0 ? `${totalOutputTokens.toLocaleString()} output tokens` : null,
    durationStr !== "—" ? `${durationStr} total` : null,
  ].filter(Boolean).join("  ");

  // Build mcp servers tags
  const mcpTagsHtml = mcpServers.length > 0
    ? mcpServers.map(s => `<span class="tag">${hEsc(s)}</span>`).join("")
    : `<span class="tag ok">none</span>`;

  const denialTagHtml = permissionDenials === 0
    ? `<span class="tag ok">none</span>`
    : `<span class="tag warn">${permissionDenials}</span>`;

  // Session info grid
  const sessionInfoHtml = `
<div class="session-info">
  <div class="info-group"><span class="info-label">Model</span><span class="info-value highlight">${hEsc(model)}</span></div>
  <div class="info-group"><span class="info-label">Session</span><span class="info-value">${hEsc(sessionIdShort)}</span></div>
  <div class="info-group"><span class="info-label">CLI Version</span><span class="info-value">${hEsc(cliVersion)}</span></div>
  <div class="info-group"><span class="info-label">Permission Mode</span><span class="info-value">${hEsc(permissionMode)}</span></div>
  <div class="info-group"><span class="info-label">Tools Available</span><span class="info-value">${hEsc(toolsCount)}</span></div>
  <div class="info-group"><span class="info-label">Fast Mode</span><span class="info-value">${hEsc(fastMode)}</span></div>
  <div class="info-group"><span class="info-label">MCP Servers</span><span class="info-value">${mcpTagsHtml}</span></div>
  <div class="info-group"><span class="info-label">Permission Denials</span><span class="info-value">${denialTagHtml}</span></div>
</div>`;

  // Failure reason
  const failureHtml = result.failure_reason ? `
<div style="background:var(--fail-bg);border:1px solid var(--fail-border);border-radius:8px;padding:12px 16px;margin-bottom:20px">
  <div style="font-size:10px;font-weight:700;color:var(--fail);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Failure Reason</div>
  <div style="font-family:var(--mono);font-size:12px;color:var(--fail);white-space:pre-wrap">${hEsc(result.failure_reason)}</div>
</div>` : "";

  // Justification
  const justificationHtml = result.justification ? `
<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px 16px;margin-bottom:20px">
  <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Grader Justification</div>
  <div style="font-size:13px;line-height:1.7;color:var(--text-dim)">${hEsc(result.justification)}</div>
</div>` : "";

  // Observations as bulleted list
  let observationsHtml = "";
  if (observations.length > 0) {
    const items = observations.map(o => {
      const dotCls = o.type === "positive" ? "positive" : "negative";
      return `<li class="obs-item"><div class="obs-dot ${dotCls}"></div><span class="obs-text">${hEsc(o.text)}</span></li>`;
    }).join("");
    observationsHtml = `
<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px 16px;margin-bottom:20px">
  <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Observations</div>
  <ul class="obs-list">${items}</ul>
</div>`;
  }

  // Grader results
  let graderHtml = "";
  if (graderResults.length > 0) {
    const rows = graderResults.map(g => {
      const chipClass = g.passed ? "grader-pass" : "grader-fail";
      const icon = g.passed ? "&#10003;" : "&#10007;";
      let label = hEsc(g.type);
      if (g.config && typeof g.config === "object") {
        const parts: string[] = [];
        if (g.config.path) parts.push(`path=${g.config.path}`);
        if (g.config.min_items != null) parts.push(`min_items=${g.config.min_items}`);
        if (g.config.max_items != null) parts.push(`max_items=${g.config.max_items}`);
        if (g.config.min != null) parts.push(`min=${g.config.min}`);
        if (g.config.max != null) parts.push(`max=${g.config.max}`);
        if (g.config.type_check) parts.push(`type_check=${g.config.type_check}`);
        if (parts.length > 0) label += " " + parts.map(hEsc).join(" ");
      }
      return `<span class="grader-chip ${chipClass}"><span class="grader-icon">${icon}</span> ${label}</span>`;
    }).join(" ");
    graderHtml = `
<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px 16px;margin-bottom:20px">
  <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Grader Results</div>
  <div class="grader-row" style="padding:0">${rows}</div>
</div>`;
  }

  // Trace card
  const traceCardHtml = trace.length > 0 ? `
<div class="trace-card">
  <div class="trace-header">
    <span class="trace-header-title">Trace</span>
    <div class="trace-stats">
      ${hEsc(traceStatsStr)}
    </div>
  </div>
  <div class="trace-legend">
    <div class="legend-item"><div class="legend-dot" style="background:var(--trace-user)"></div>User</div>
    <div class="legend-item"><div class="legend-dot" style="background:var(--trace-assistant)"></div>Assistant</div>
    <div class="legend-item"><div class="legend-dot" style="background:var(--trace-tool-call)"></div>Tool Call</div>
    <div class="legend-item"><div class="legend-dot" style="background:var(--trace-tool-result)"></div>Tool Result</div>
  </div>
  <div class="trace-timeline">
  ${traceStepsHtml}
  </div>
</div>` : `<div class="empty-state">No trace data available for this result.</div>`;

  return `
<a class="back-link" href="/evals/${runIdEncoded}">&#8592; Back to ${hEsc(runId)}</a>

<h1>${hEsc(scenarioName)}</h1>
<div class="trace-meta">
  <div class="trace-meta-item">
    <span style="color:${agentColor};font-weight:600">${hEsc(result.agent)}</span>
    <span style="color:var(--text-muted)">/</span>
    <span>${hEsc(result.scenario_id)}</span>
  </div>
  <div class="trace-meta-item">
    <span class="score-badge ${scoreClass}">${scoreLabel}</span>
  </div>
  ${durationStr !== "—" ? `<div class="trace-meta-item">${hEsc(durationStr)}</div>` : ""}
  ${costStr !== "—" ? `<div class="trace-meta-item">${hEsc(costStr)}</div>` : ""}
  ${result.confidence_stated != null ? `<div class="trace-meta-item" style="color:var(--text-muted)">conf: ${result.confidence_stated}</div>` : ""}
  ${result.trial_index > 0 ? `<div class="trace-meta-item" style="color:var(--text-muted)">trial ${result.trial_index + 1}</div>` : ""}
</div>

${sessionInfoHtml}
${failureHtml}
${justificationHtml}
${observationsHtml}
${graderHtml}
${traceCardHtml}

<script>
function toggleFull(uid) {
  const trunc = document.getElementById('trunc-' + uid);
  const full = document.getElementById('full-' + uid);
  const btn = event.target;
  if (full.style.display === 'block') {
    full.style.display = 'none';
    trunc.style.display = '';
    btn.textContent = btn.textContent.replace('show less', 'show full output');
  } else {
    full.style.display = 'block';
    trunc.style.display = 'none';
    btn.textContent = btn.textContent.replace(/show full output.*/, 'show less');
  }
}
</script>
  `;
}
