import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { ConstitutionEvent } from "@zeroclaw/core";
import type { ConstitutionEventStream } from "./event-stream.js";

export interface WebServerConfig {
  stream: ConstitutionEventStream;
  port: number;
  /** Called when the user submits an intent through the UI form. */
  onIntent: (intent: string) => Promise<void>;
}

const HTML = `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8"/>
  <title>ZeroClaw / SafeSwap</title>
  <style>
    :root { color-scheme: dark; }
    body {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      margin: 0; padding: 24px; background: #0d0d10; color: #e6e6e6;
    }
    header { display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; }
    h1 { margin:0; font-size:18px; letter-spacing:0.5px; }
    h1 .tag { color:#7af0a8; margin-right:8px; }
    .subtitle { color:#8a8a92; font-size:12px; }
    form { margin-bottom: 16px; display:flex; gap:8px; }
    input[type=text] { flex:1; padding:10px 12px; background:#1a1a1f; border:1px solid #2a2a32; color:#e6e6e6; border-radius:6px; font-family:inherit; }
    button { padding:10px 16px; background:#7af0a8; color:#0d0d10; border:0; border-radius:6px; font-weight:600; cursor:pointer; font-family:inherit; }
    .columns { display:grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .col { background:#15151a; border:1px solid #23232a; border-radius:8px; padding:12px; min-height: 320px; }
    .col h2 { margin:0 0 8px 0; font-size:14px; color:#a8a8b2; letter-spacing:1px; text-transform:uppercase; }
    .col.proposer h2 { color:#7af0a8; }
    .col.critic h2 { color:#f0a87a; }
    .entry { background:#1a1a1f; border-left:3px solid #2a2a32; padding:8px 10px; margin-bottom:8px; font-size:12px; white-space:pre-wrap; word-break: break-word; }
    .entry.proposer { border-left-color:#7af0a8; }
    .entry.critic { border-left-color:#f0a87a; }
    .entry.mechanism { border-left-color:#7aa8f0; }
    .entry.executed { border-left-color:#f0e57a; }
    footer { margin-top:16px; padding-top:12px; border-top:1px solid #23232a; font-size:12px; color:#8a8a92; }
    footer a { color:#7af0a8; }
  </style>
</head><body>
  <header>
    <h1><span class="tag">ZeroClaw</span>SafeSwap</h1>
    <div class="subtitle">A constitutional agent. Two roles. One mechanism. Zero trust.</div>
  </header>
  <form id="intent-form">
    <input type="text" id="intent" placeholder="swap 5 ETH to USDC, lowest slippage" required />
    <button type="submit">Deliberate</button>
  </form>
  <div class="columns">
    <div class="col proposer"><h2>Proposer</h2><div id="proposer-stream"></div></div>
    <div class="col critic"><h2>Critic</h2><div id="critic-stream"></div></div>
  </div>
  <div id="mechanism" class="col" style="margin-top:16px;"><h2>Mechanism</h2><div id="mech-stream"></div></div>
  <footer id="footer">Awaiting intent...</footer>
  <script>
    const form = document.getElementById('intent-form');
    const intent = document.getElementById('intent');
    const proposerCol = document.getElementById('proposer-stream');
    const criticCol = document.getElementById('critic-stream');
    const mechCol = document.getElementById('mech-stream');
    const footer = document.getElementById('footer');

    const append = (col, cls, text) => {
      const div = document.createElement('div');
      div.className = 'entry ' + cls;
      div.textContent = text;
      col.appendChild(div);
      col.scrollTop = col.scrollHeight;
    };

    const sse = new EventSource('/events');
    sse.onmessage = (m) => {
      const e = JSON.parse(m.data);
      if (e.type === 'proposed') {
        append(proposerCol, 'proposer',
          'Plan: ' + JSON.stringify(e.plan.parameters) + '\\n' + e.plan.rationale);
      } else if (e.type === 'critiqued') {
        append(criticCol, 'critic',
          'Verdict: ' + e.critique.verdict + '\\n' +
          'Counter: ' + JSON.stringify(e.critique.counterParameters) + '\\n' +
          (e.critique.concerns || []).map(c => '• ' + c).join('\\n') + '\\n' +
          e.critique.rationale);
      } else if (e.type === 'round_event') {
        append(mechCol, 'mechanism', e.parameter + ' :: ' + e.event.type +
          (e.event.participant ? ' (' + e.event.participant + ')' : '') +
          (e.event.value !== undefined ? ' value=' + e.event.value : ''));
      } else if (e.type === 'round_resolved') {
        append(mechCol, 'mechanism',
          '✔ ' + e.parameter + ' resolved → ' + e.resolution);
      } else if (e.type === 'executed') {
        const r = e.receipt;
        footer.innerHTML = '✅ ' + r.status + ' — <a href="' + r.explorerUrl + '" target="_blank">' + r.txHash + '</a>';
      } else if (e.type === 'aborted') {
        footer.innerHTML = '⛔ aborted: ' + e.reason;
      }
    };

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      proposerCol.innerHTML = '';
      criticCol.innerHTML = '';
      mechCol.innerHTML = '';
      footer.textContent = 'Deliberating...';
      await fetch('/intent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ intent: intent.value }),
      });
    });
  </script>
</body></html>`;

export const buildWebServer = (cfg: WebServerConfig): FastifyInstance => {
  const app = Fastify({ logger: false });

  app.get("/", async (_req, reply) => {
    reply.header("content-type", "text/html; charset=utf-8");
    return HTML;
  });

  app.get("/events", async (req, reply) => {
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    const send = (event: ConstitutionEvent) => {
      const safe = serializeEvent(event);
      reply.raw.write(`data: ${JSON.stringify(safe)}\n\n`);
    };
    const unsub = cfg.stream.subscribe(send);
    req.raw.on("close", () => unsub());
    // Heartbeat so proxies don't close the stream.
    const hb = setInterval(() => reply.raw.write(`: hb\n\n`), 15_000);
    req.raw.on("close", () => clearInterval(hb));
  });

  app.post<{ Body: { intent?: string } }>("/intent", async (req, reply) => {
    const intent = req.body?.intent;
    if (!intent) {
      reply.code(400);
      return { error: "intent required" };
    }
    // Fire-and-forget; events stream back over SSE.
    cfg.onIntent(intent).catch((err) => {
      cfg.stream.publish({ type: "aborted", reason: String(err) });
    });
    return { ok: true };
  });

  app.listen({ port: cfg.port, host: "0.0.0.0" });
  return app;
};

const serializeEvent = (event: ConstitutionEvent): unknown => {
  // Map values are not JSON.stringify-safe; convert.
  if (event.type === "round_event") {
    const e = event.event;
    if (e.type === "resolved") {
      return {
        type: "round_event",
        parameter: event.parameter,
        event: {
          type: e.type,
          resolution: e.resolution,
          scores: Object.fromEntries(e.scores),
        },
      };
    }
    return event;
  }
  return event;
};
