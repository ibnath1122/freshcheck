const DEFAULT_API = "http://localhost:5000";
const getApi = async () => ((await chrome.storage.local.get("server")).server || DEFAULT_API).replace(/\/+$/, "");
chrome.runtime.onInstalled.addListener(() =>
  chrome.contextMenus.create({id: "fc", title: "Check freshness of selected text", contexts: ["selection"]}));
chrome.contextMenus.onClicked.addListener(async info => {
  const text = (info.selectionText || "").trim(); if (!text) return;
  await chrome.storage.local.set({state: {status: "working", text}}); chrome.action.setBadgeText({text: "…"});
  try {
    const api = await getApi();
    const r = await fetch(api + "/api/analyze", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({answer: text.slice(0, 6000)})});
    const data = await r.json(); if (!r.ok) throw new Error(data.error || "Request failed");
    await chrome.storage.local.set({state: {status: "done", text, data, api}});
    chrome.action.setBadgeText({text: String(data.avg_score)});
    chrome.action.setBadgeBackgroundColor({color: data.avg_score >= 70 ? "#1d7448" : data.avg_score >= 40 ? "#a86a0c" : "#bb2d26"});
  } catch (e) {
    await chrome.storage.local.set({state: {status: "error", text, error: e.message}}); chrome.action.setBadgeText({text: "!"});
  }
});
