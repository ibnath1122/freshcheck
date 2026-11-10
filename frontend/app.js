/* Optional API key: protected routes (watchlist run, etc.) answer 401 when FRESHCHECK_API_KEY is set on the server. */
const _fetch = window.fetch.bind(window);
window.fetch = async (u, o = {}) => {
  let key = ""; try { key = localStorage.getItem("fc_key") || ""; } catch (e) {}
  const r = await _fetch(u, key ? {...o, headers: {...(o.headers || {}), "X-API-Key": key}} : o);
  if (r.status === 401 && !o._retried) {
    const k = prompt("This action needs the FreshCheck API key:");
    if (k) { try { localStorage.setItem("fc_key", k); } catch (e) {} return window.fetch(u, {...o, _retried: true}); }
  }
  return r;
};
const API = location.port === "5000" ? "" : "http://localhost:5000";
const $ = id => document.getElementById(id);
const SAMPLE = "The latest stable Python version is 3.11. Sundar Pichai is the CEO of Google. " +
  "GPT-4 costs $30 per million input tokens. The EU AI Act has not yet come into force.";
const LABEL = {supported: "Still true", unverifiable: "Can’t confirm", outdated: "Out of date", contradicted: "Contradicted"};
const STATUS_NAME = {fresh: "Fresh", uncertain: "Unsure", stale: "Stale", unverified: "Not checked"};
const DECAY = v => v >= .7 ? "changes fast" : v >= .4 ? "changes sometimes" : "rarely changes";
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
const band = s => s >= 70 ? "fresh" : s >= 40 ? "uncertain" : "stale";
const color = s => `var(--${band(s)})`;
let fixedText = "", lastData = null, filter = "all";

/* ---------- small helpers ---------- */
let toastT;
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2400);
}
function setBusy(on, msg) {
  $("statusBar").hidden = !on; if (msg) $("status").textContent = msg;
  if (on) $("statusErr").hidden = true;
  for (const id of ["go", "ask", "goUrl", "goBifrost"]) { const el = $(id); if (el) el.disabled = on; }
}
function showErr(msg) { setBusy(false); $("statusErr").textContent = msg; $("statusErr").hidden = false; }
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; }
  catch (e) {
    const a = document.createElement("textarea"); a.value = t; document.body.appendChild(a); a.select();
    const ok = document.execCommand("copy"); a.remove(); return ok;
  }
}
function since(d) {
  const m = /^(\d{4})-(\d{2})/.exec(d || ""); if (!m) return "";
  const now = new Date(), n = (now.getFullYear() - +m[1]) * 12 + now.getMonth() + 1 - +m[2];
  return n < 1 ? "changed this month" : n < 24 ? `changed ${n} month${n > 1 ? "s" : ""} ago` : `changed ${Math.floor(n / 12)} years ago`;
}

/* ---------- tabs ---------- */
function showTab(name) {
  document.querySelectorAll(".tab").forEach(t => {
    const on = t.dataset.tab === name; t.classList.toggle("active", on); t.setAttribute("aria-selected", on);
  });
  document.querySelectorAll(".pane").forEach(p => p.hidden = p.dataset.pane !== name);
  const f = {paste: "answer", ask: "q", bifrost: "bifrostPrompt", url: "url"}[name]; if (f) $(f).focus({preventScroll: true});
}
document.querySelectorAll(".tab").forEach(t => t.onclick = () => showTab(t.dataset.tab));

/* ---------- rendering ---------- */
function markup(text, claims) {
  const spans = claims.map((c, n) => ({c, n, i: text.indexOf(c.text)})).filter(x => x.i >= 0).sort((a, b) => a.i - b.i);
  let out = "", pos = 0;
  for (const {c, n, i} of spans) {
    if (i < pos) continue;
    out += esc(text.slice(pos, i)) + `<mark class="${c.status}" data-c="${n}" title="${STATUS_NAME[c.status]} · ${c.score}/100 (click for details)">${esc(c.text)}</mark>`;
    pos = i + c.text.length;
  }
  return out + esc(text.slice(pos));
}

function card(c, n) {
  const label = c.status === "unverified" ? "Not checked" : LABEL[c.verdict];
  return `<article class="claim ${c.status}" id="claim-${n}" data-status="${c.status}" style="animation-delay:${Math.min(n, 8) * 40}ms">
    <p class="t">${esc(c.text)}</p>
    <div class="meta"><span class="badge ${c.status}">${label}</span><span>${esc(c.category)}</span>
      <span class="chip">${DECAY(c.volatility)}</span>${c.cached ? '<span class="chip">cached</span>' : ""}${c.changed_on ? `<span class="chip">${since(c.changed_on)}</span>` : ""}${c.rounds > 1 ? '<span class="chip">2 search rounds</span>' : ""}
      <div class="bar"><i style="width:${c.score}%"></i></div><span class="score">${c.score}/100</span></div>
    ${c.current_fact ? `<p class="now"><b>Sources now say:</b> ${esc(c.current_fact)}</p>` : ""}
    ${c.corrected_claim ? `<p class="now fix"><b>Corrected:</b> ${esc(c.corrected_claim)}</p>` : ""}
    ${c.reasoning ? `<p class="muted">${esc(c.reasoning)}${c.ai ? ` (confidence ${Math.round(c.confidence * 100)}%)` : ""}</p>` : ""}
    ${c.error ? `<p class="muted">${esc(c.error)}</p>` : ""}
    ${c.sources.length ? `<details><summary>${c.sources.length} live source${c.sources.length > 1 ? "s" : ""}</summary>${c.sources.map(s =>
      `<div class="src"><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a><span>${esc(s.date || "")} ${esc(s.snippet)}…</span></div>`).join("")}</details>` : ""}
  </article>`;
}

function verdictFor(d) {
  if (!d.claims.length) return ["No time-sensitive claims", "var(--unverified)"];
  const s = d.avg_score;
  return s >= 80 ? ["Looks fresh", "var(--fresh)"] : s >= 60 ? ["Mostly up to date", "var(--fresh)"]
    : s >= 40 ? ["Some claims are shaky", "var(--uncertain)"] : ["Likely out of date", "var(--stale)"];
}

function setGauge(score, col) {
  const g = $("gVal"), C = 2 * Math.PI * 52;
  g.style.stroke = col; g.style.strokeDashoffset = C;
  requestAnimationFrame(() => requestAnimationFrame(() => g.style.strokeDashoffset = C * (1 - Math.max(0, Math.min(100, score)) / 100)));
}
function countUp(el, to) {
  const t0 = performance.now(), dur = 800;
  const tick = t => { const p = Math.min(1, (t - t0) / dur); el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}

function applyFilter() {
  document.querySelectorAll(".claim").forEach(el => el.hidden = filter !== "all" && el.dataset.status !== filter);
  document.querySelectorAll(".f").forEach(b => b.classList.toggle("on", b.dataset.f === filter));
}

function render(text, data) {
  $("result").hidden = false; lastData = data; $("watchMsg").textContent = ""; filter = "all";
  const has = data.claims.length, [vt, vc] = verdictFor(data);
  if (has) countUp($("avg"), data.avg_score); else $("avg").textContent = "–";
  $("avg").style.color = vc; setGauge(has ? data.avg_score : 0, vc);
  $("verdict").textContent = vt;
  $("avgLabel").textContent = has
    ? `Trust score across ${data.claims.length} time-sensitive claim${data.claims.length > 1 ? "s" : ""}, weighted toward fast-changing facts.`
    : "Nothing in this text is likely to have gone stale.";
  const n = {fresh: 0, uncertain: 0, stale: 0, unverified: 0}; data.claims.forEach(c => n[c.status] = (n[c.status] || 0) + 1);
  const shown = Object.keys(n).filter(k => n[k]);
  const sec = data.security || {}, blocked = (sec.sources_blocked || 0) + (sec.answer_flagged ? 1 : 0);
  const note = blocked || sec.corrected_rejected ? `<span class="count unverified" title="Web pages or text that tried to give the AI instructions were ignored.">🛡 ${blocked ? blocked + " injection attempt" + (blocked > 1 ? "s" : "") + " blocked" : "unsafe rewrite rejected"}</span>` : "";
  $("counts").innerHTML = note + shown.map(k => `<span class="count ${k}">${n[k]} ${STATUS_NAME[k].toLowerCase()}</span>`).join("");
  $("filters").innerHTML = has && shown.length > 1
    ? [`<button class="f on" data-f="all">All ${has}</button>`, ...shown.map(k => `<button class="f" data-f="${k}">${STATUS_NAME[k]} ${n[k]}</button>`)].join("") : "";
  $("marked").innerHTML = markup(text, data.claims);
  fixedText = data.corrected_answer || "";
  $("fixBox").hidden = !(fixedText && data.claims.some(c => c.status === "stale"));
  $("fixed").textContent = fixedText; $("copy").textContent = "Copy";
  $("claims").innerHTML = data.claims.map(card).join("");
  $("result").scrollIntoView({behavior: "smooth", block: "start"});
}

$("filters").onclick = e => { const b = e.target.closest(".f"); if (b) { filter = b.dataset.f; applyFilter(); } };
$("marked").onclick = e => {
  const m = e.target.closest("mark"); if (!m) return;
  const el = $("claim-" + m.dataset.c); if (!el) return;
  filter = "all"; applyFilter();
  el.scrollIntoView({behavior: "smooth", block: "center"});
  el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1400);
  const d = el.querySelector("details"); if (d) d.open = true;
};

/* ---------- inputs ---------- */
const updateCount = () => { $("count").textContent = `${$("answer").value.length} / 6000`; };
$("answer").addEventListener("input", updateCount);
$("answer").addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") $("go").click(); });
$("q").addEventListener("keydown", e => { if (e.key === "Enter") $("ask").click(); });
$("bifrostPrompt")?.addEventListener("keydown", e => { if (e.key === "Enter") $("goBifrost").click(); });
$("url").addEventListener("keydown", e => { if (e.key === "Enter") $("goUrl").click(); });
$("go").onclick = () => { const t = $("answer").value.trim(); if (!t) return showErr("Paste an answer first."); stream({answer: t}); };
$("ask").onclick = () => { const q = $("q").value.trim(); if (!q) return showErr("Type a question first."); stream({question: q}); };
$("sample").onclick = () => { $("answer").value = SAMPLE; updateCount(); $("answer").focus(); };
$("clear").onclick = () => { $("answer").value = ""; updateCount(); $("answer").focus(); };
$("copy").onclick = async () => { if (await copyText(fixedText)) { $("copy").textContent = "Copied ✓"; toast("Corrected answer copied"); } };

/* ---------- history, watchlist, stats ---------- */
async function loadHistory() {
  try {
    const rows = await (await fetch(API + "/api/history")).json();
    if (!Array.isArray(rows) || !rows.length) return;
    $("history").innerHTML = rows.map(r => `<li class="click" data-id="${esc(r.token || r.id)}" tabindex="0" role="button">
      <span class="sc ${band(r.avg_score)}">${r.avg_score}</span><span class="txt">${esc(r.preview)}…</span></li>`).join("");
  } catch (e) { /* history is optional */ }
}
async function openId(id) {
  const d = await (await fetch(`${API}/api/analysis/${id}`)).json(); if (d.error) return;
  $("answer").value = d.answer; updateCount(); showTab("paste"); render(d.answer, d);
}
$("history").onclick = e => { const li = e.target.closest("li[data-id]"); if (li) openId(li.dataset.id); };
$("history").onkeydown = e => { if (e.key === "Enter" || e.key === " ") { const li = e.target.closest("li[data-id]"); if (li) { e.preventDefault(); openId(li.dataset.id); } } };

async function loadEvents() {
  try {
    const d = await (await fetch(API + "/api/watch")).json();
    if (!d.events || !d.events.length) return;
    $("events").innerHTML = d.events.map(e => `<li><span class="ev"><span class="count ${e.old_status === "fresh" ? "fresh" : "stale"}">${esc(e.old_status)}</span><span class="arrow">→</span><span class="count ${e.new_status === "fresh" ? "fresh" : "stale"}">${esc(e.new_status)}</span></span>
      <span class="txt">${esc(e.claim_text)}</span><span class="when">${esc(e.created_at.slice(0, 16).replace("T", " "))}</span></li>`).join("");
  } catch (e) { /* optional */ }
}
async function loadStats() {
  try {
    const d = await (await fetch(API + "/api/stats")).json(); if (d.error) return;
    const t = (n, l, cls = "") => `<div class="stat ${cls}"><b>${n}</b><span>${l}</span></div>`;
    $("stats").hidden = false;
    $("stats").innerHTML = t(d.analyses, "answers checked") + t(d.claims, "claims reviewed") + t(d.stale, "found out of date", "bad") + t(d.cached, "evidence cached");
  } catch (e) { /* optional */ }
}

$("watch").onclick = async () => {
  const r = await fetch(API + "/api/watch", {method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({analysis_id: lastData && lastData.id})});
  const j = await r.json();
  $("watchMsg").textContent = r.ok ? `Watching. Re-checked every ${j.interval_h} hours.` : (j.error || "Could not watch");
  if (r.ok) toast("Added to watchlist");
};
$("runWatch").onclick = async () => {
  $("runMsg").textContent = "Re-checking watched answers…";
  try {
    const r = await (await fetch(API + "/api/watch/run", {method: "POST"})).json();
    $("runMsg").textContent = `Checked ${r.checked || 0} watched answer(s).`; loadEvents();
  } catch (e) { $("runMsg").textContent = "Could not reach the server."; }
};
$("dl").onclick = () => {
  const d = lastData; if (!d) return;
  const md = `# FreshCheck report\n\nTrust score: ${d.avg_score}/100\n\n` + d.claims.map(c =>
    `## ${c.text}\n- Verdict: ${c.status === "unverified" ? "not checked" : LABEL[c.verdict]} (${c.score}/100)\n` +
    (c.corrected_claim ? `- Corrected: ${c.corrected_claim}\n` : "") +
    c.sources.map(s => `- Source: ${s.title} ${s.url}`).join("\n")).join("\n\n") +
    (d.corrected_answer ? `\n\n## Corrected answer\n${d.corrected_answer}\n` : "");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([md], {type: "text/markdown"}));
  a.download = "freshcheck-report.md"; a.click(); toast("Report downloaded");
};
$("share").onclick = async () => {
  if (!lastData || !lastData.id) return toast("Sharing needs MySQL running");
  if (await copyText(`${location.origin}${location.pathname}#r${lastData.token || lastData.id}`)) toast("Share link copied");
};

/* ---------- Bifrost Gateway ---------- */
$("goBifrost")?.addEventListener("click", async () => {
  const prompt = $("bifrostPrompt").value.trim();
  const model = $("bifrostModel").value.trim() || "openai/gpt-4o-mini";
  const autofix = $("bifrostAutofix")?.checked ?? true;
  if (!prompt) return showErr("Enter a question or prompt for Bifrost.");

  setBusy(true, "Forwarding to Bifrost Gateway… checking freshness…");
  try {
    const payload = {
      model,
      messages: [{role: "user", content: prompt}],
      freshcheck_autofix: autofix
    };
    const r = await fetch(API + "/v1/chat/completions", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(payload)
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || (typeof d === "string" ? d : "Gateway request failed"));

    const content = d.choices?.[0]?.message?.content || "";
    const freshness = d.freshness;
    if (!freshness || freshness.error) {
      throw new Error(freshness?.error || "No freshness audit returned by gateway");
    }

    setBusy(false);
    $("answer").value = content;
    updateCount();
    render(content, freshness);
    loadHistory();
    loadStats();
    toast("Bifrost response & FreshCheck audit loaded!");
  } catch (e) {
    showErr(e.message);
  }
});

/* ---------- page audit ---------- */
$("goUrl").onclick = async () => {
  const url = $("url").value.trim(); if (!url) return showErr("Paste a link first.");
  setBusy(true, "Reading the page and searching live sources…");
  try {
    const r = await fetch(API + "/api/analyze-url", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({url})});
    const d = await r.json(); if (!r.ok) throw new Error(d.error || "Request failed");
    $("answer").value = d.answer; updateCount(); setBusy(false); render(d.answer, d); loadHistory(); loadStats();
  } catch (e) { showErr(e.message); }
};

/* ---------- live progress (server-sent events) ---------- */
async function stream(payload) {
  setBusy(true, "Starting…");
  try {
    const r = await fetch(API + "/api/stream", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(payload)});
    if (!r.ok) throw new Error((await r.json()).error || "Request failed");
    const rd = r.body.getReader(), dec = new TextDecoder(); let buf = "";
    for (;;) {
      const {value, done} = await rd.read(); if (done) break;
      buf += dec.decode(value, {stream: true});
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const ev = JSON.parse(buf.slice(6, i)); buf = buf.slice(i + 2);
        if (ev.stage) $("status").textContent = ev.stage;
        if (ev.asked) { $("answer").value = ev.asked; updateCount(); }
        if (ev.error) throw new Error(ev.error);
        if (ev.done) { setBusy(false); render(ev.done.answer, ev.done); loadHistory(); loadStats(); }
      }
    }
    setBusy(false);
  } catch (e) { showErr(e.message === "Failed to fetch" ? "Can’t reach the FreshCheck server. Is `python app.py` running?" : e.message); }
}

/* ---------- theme: system -> light -> dark, remembered ---------- */
const root = document.documentElement;
const ICONS = {
  auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>'
};
const mode = () => root.dataset.theme || "auto";
function paintTheme() {
  const m = mode(); $("theme").innerHTML = ICONS[m];
  const names = {auto: "System theme", light: "Light theme", dark: "Dark theme"};
  $("theme").title = names[m] + " (click to change)"; $("theme").setAttribute("aria-label", names[m] + ", click to change");
  const dark = m === "dark" || (m === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelector('meta[name="theme-color"]').content = dark ? "#0a0f12" : "#f4f7f6";
}
$("theme").onclick = () => {
  const next = {auto: "light", light: "dark", dark: "auto"}[mode()];
  if (next === "auto") delete root.dataset.theme; else root.dataset.theme = next;
  try { next === "auto" ? localStorage.removeItem("fc-theme") : localStorage.setItem("fc-theme", next); } catch (e) { /* private mode */ }
  paintTheme(); toast({auto: "Theme: follow system", light: "Theme: light", dark: "Theme: dark"}[next]);
};
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", paintTheme);
paintTheme();

/* ---------- boot ---------- */
fetch(API + "/api/config").then(r => r.json()).then(c => {
  $("mode").textContent = c.ai ? `Gemini (${c.model}) judges evidence from Tavily live search.`
    : "Rule-based mode. Add GEMINI_API_KEY in backend/.env for AI judging and corrected answers.";
  const b = $("modeBadge"); b.className = "pill on" + (c.ai ? " ai" : ""); b.textContent = c.ai ? "AI judge on" : "Rule-based";
  if ($("bifrostEndpointHint")) {
    $("bifrostEndpointHint").innerHTML = c.bifrost 
      ? `Upstream: <code>${esc(c.llm_url)}</code>`
      : `⚠️ Set <code>LLM_BASE_URL</code> in backend/.env to connect Bifrost`;
  }
}).catch(() => {});
loadHistory(); loadEvents(); loadStats(); updateCount();
const hashId = location.hash.match(/^#r([\w-]{1,16})$/); if (hashId) openId(hashId[1]);
