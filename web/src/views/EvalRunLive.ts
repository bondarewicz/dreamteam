/**
 * Live eval run progress page — /evals/live
 */

export function EvalRunLivePage(
  runInProgress: boolean,
  runId?: string,
  startedAt?: number
): string {
  if (!runInProgress) {
    return `
      <div class="page-title">
        <h1>Live Eval Progress</h1>
      </div>
      <div class="card" style="max-width:600px">
        <p style="color:var(--text-dim);margin-bottom:16px">No eval run is currently active.</p>
        <a href="/evals/new" class="btn-link">Start a new run</a>
      </div>
      <style>
        .btn-link { color: var(--accent); text-decoration: none; font-size: 13px; }
        .btn-link:hover { text-decoration: underline; }
      </style>
    `;
  }

  const startedStr = startedAt
    ? new Date(startedAt).toISOString().replace("T", " ").slice(0, 19) + " UTC"
    : "";

  return `
    <div class="page-title">
      <h1>Live Eval Progress</h1>
      <p>Run started ${startedStr} — streaming output below.</p>
    </div>

    <div id="status-bar" class="status-bar running">
      <span id="status-icon" class="status-dot running-dot"></span>
      <span id="status-text">Running...</span>
      <span id="progress-summary" style="margin-left:auto;color:var(--text-dim);font-size:12px"></span>
    </div>

    <div id="terminal-output" class="terminal-output"></div>

    <div id="completion-banner" class="completion-banner" style="display:none"></div>

    <style>
      .status-bar { display:flex; align-items:center; gap:10px; background:var(--surface-2); border:1px solid var(--border); border-radius:8px 8px 0 0; padding:10px 16px; font-size:13px; font-weight:600; }
      .status-dot { width:10px; height:10px; border-radius:50%; flex-shrink:0; }
      .running-dot { background:var(--partial); animation: pulse 1.5s infinite; }
      .pass-dot { background:var(--pass); }
      .fail-dot { background:var(--fail); }
      @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
      .terminal-output { background:#0a0c10; border:1px solid var(--border); border-top:none; border-radius:0 0 8px 8px; padding:16px; min-height:400px; max-height:600px; overflow-y:auto; font-family:var(--mono); font-size:12px; line-height:1.6; color:#c9d1d9; white-space:pre-wrap; word-break:break-all; margin-bottom:16px; }
      .completion-banner { border-radius:8px; padding:16px 20px; font-size:14px; font-weight:600; margin-top:8px; }
      .completion-banner.success { background:var(--pass-bg); border:1px solid var(--pass-border); color:var(--pass); }
      .completion-banner.failure { background:var(--fail-bg); border:1px solid var(--fail-border); color:var(--fail); }
      .completion-banner a { color:inherit; margin-left:16px; font-weight:400; font-size:13px; }
      .btn-link { color:var(--accent); text-decoration:none; font-size:13px; }
    </style>

    <script>
      (function() {
        const output = document.getElementById('terminal-output');
        const statusBar = document.getElementById('status-bar');
        const statusIcon = document.getElementById('status-icon');
        const statusText = document.getElementById('status-text');
        const progressSummary = document.getElementById('progress-summary');
        const completionBanner = document.getElementById('completion-banner');

        let passCount = 0;
        let partialCount = 0;
        let failCount = 0;

        function appendLine(line) {
          output.textContent += line + '\\n';
          output.scrollTop = output.scrollHeight;
          // Try to extract pass/fail stats from eval output lines
          if (line.includes('[PASS]')) passCount++;
          else if (line.includes('[PARTIAL]')) partialCount++;
          else if (line.includes('[FAIL]')) failCount++;
          const total = passCount + partialCount + failCount;
          if (total > 0) {
            progressSummary.textContent = total + ' done — ' + passCount + 'P / ' + partialCount + 'p / ' + failCount + 'F';
          }
        }

        const source = new EventSource('/api/eval-runs/live');

        source.onmessage = function(e) {
          try {
            const data = JSON.parse(e.data);
            if (data.line !== undefined) {
              appendLine(data.line);
            }
          } catch (_err) {
            appendLine(e.data);
          }
        };

        source.addEventListener('complete', function(e) {
          source.close();
          statusIcon.className = 'status-dot pass-dot';
          statusText.textContent = 'Run complete';
          completionBanner.className = 'completion-banner success';
          completionBanner.style.display = 'block';
          completionBanner.innerHTML = 'Eval run completed successfully!' +
            '<a href="/">View Dashboard</a>';
        });

        source.addEventListener('failed', function(e) {
          source.close();
          let exitCode = '?';
          try { exitCode = JSON.parse(e.data).exitCode; } catch(_) {}
          statusIcon.className = 'status-dot fail-dot';
          statusText.textContent = 'Run failed';
          completionBanner.className = 'completion-banner failure';
          completionBanner.style.display = 'block';
          completionBanner.innerHTML = 'Eval run failed with exit code ' + exitCode +
            '. <a href="/evals/new">Try again</a>';
        });

        source.addEventListener('error', function(e) {
          if (source.readyState === EventSource.CLOSED) return;
          try {
            const data = JSON.parse(e.data || '{}');
            if (data.message) {
              statusText.textContent = 'Error: ' + data.message;
              source.close();
            }
          } catch(_) {}
        });

        source.onerror = function() {
          if (source.readyState === EventSource.CLOSED) return;
          // Connection dropped — retry happens automatically
          statusText.textContent = 'Reconnecting...';
        };
      })();
    </script>
  `;
}
