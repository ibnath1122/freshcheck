const DEFAULT_API = "http://localhost:5000", $ = id => document.getElementById(id);
let API = DEFAULT_API;
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
const COL = {fresh: "#1d7448", uncertain: "#a86a0c", stale: "#bb2d26", unverified: "#5d6b78"};
const LABEL = {supported: "Still true", unverifiable: "Can’t confirm", outdated: "Out of date", contradicted: "Contradicted"};
function show(s) {
  if (!s) { $("out").textContent = "Select text on any page, right-click, then choose “Check freshness of selected text”."; return; }
  if (s.status === "working") { $("out").textContent = "Checking live sources…"; return; }
  if (s.status === "error") { $("out").textContent = s.error; return; }
  const d = s.data, col = d.avg_score >= 70 ? COL.fresh : d.avg_score >= 40 ? COL.uncertain : COL.stale;
  $("out").innerHTML = `<div class="big" style="color:${col}">${d.avg_score}<small style="font:13px system-ui"> trust score</small></div>` +
    d.claims.map(c => `<div class="c" style="border-left-color:${COL[c.status]}">${esc(c.text)}<small>${c.status === "unverified" ? "Not checked" : LABEL[c.verdict]}, ${c.score}/100` +
      (c.corrected_claim ? `. Corrected: ${esc(c.corrected_claim)}` : "") + `</small></div>`).join("") +
    (d.id ? `<a href="${esc(API)}/#r${esc(d.token || d.id)}" target="_blank" rel="noopener">Open full report</a>` : "");
}
$("go").onclick = async () => {
  const text = $("t").value.trim(); if (!text) return;
  show({status: "working"});
  try {
    const r = await fetch(API + "/api/analyze", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({answer: text.slice(0, 6000)})});
    const data = await r.json(); if (!r.ok) throw new Error(data.error || "Request failed");
    const state = {status: "done", text, data}; await chrome.storage.local.set({state}); show(state);
  } catch (e) { show({status: "error", error: e.message}); }
};
$("save").onclick = async () => {
  let v = $("srv").value.trim().replace(/\/+$/, "") || DEFAULT_API;
  try { const u = new URL(v); if (!/^https?:$/.test(u.protocol)) throw 0;
    if (!/^(localhost|127\.0\.0\.1)$/.test(u.hostname)) {   // ask Chrome for access to that one server only
      if (!(await chrome.permissions.request({origins: [u.origin + "/*"]}))) { $("srvmsg").textContent = "Permission denied."; return; } }
    await chrome.storage.local.set({server: v}); API = v; $("srvmsg").textContent = "Saved.";
  } catch (e) { $("srvmsg").textContent = "Enter a full http(s) address."; }
};
chrome.storage.local.get(["state", "server"]).then(({state, server}) => { API = server || DEFAULT_API; $("srv").value = API; show(state); });
