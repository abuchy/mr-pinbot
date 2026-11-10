/* global chrome */
const app = "https://pinbot.annabuchy.com";
// For local development, change app to http://localhost:3000 before loading unpacked.
const menu = "pinbot-capture";
const maxBytes = 4_000_000;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: menu, title: "Save to Mr. Pinbot", contexts: ["image"],
    documentUrlPatterns: ["http://*/*", "https://*/*"] });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === menu && info.srcUrl && tab?.id !== undefined) {
    void openCapture(info, tab).catch(console.error);
  }
});

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

async function openCapture(info, tab) {
  let capture = { title: tab.title || "", source: info.srcUrl, data: "" };
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [info.frameId ?? 0] },
      args: [info.srcUrl, maxBytes],
      func: async (source, limit) => {
        const title = document.querySelector('meta[property="og:title"]')?.content
          || document.querySelector("h1")?.textContent || document.title;
        try {
          const url = new URL(source);
          if (!["http:", "https:", "blob:", "data:"].includes(url.protocol)) return { title };
          const response = await fetch(url, {
            credentials: "omit", redirect: "error", signal: AbortSignal.timeout(5000),
          });
          if (!response.ok || !response.body || !/^image\//i.test(response.headers.get("content-type") || "")) return { title };
          const reader = response.body.getReader();
          const chunks = [];
          let size = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > limit) { await reader.cancel(); return { title }; }
            chunks.push(value);
          }
          const image = new Blob(chunks, { type: response.headers.get("content-type") });
          const data = await new Promise((resolve, reject) => {
            const fileReader = new FileReader();
            fileReader.onload = () => resolve(fileReader.result);
            fileReader.onerror = reject;
            fileReader.readAsDataURL(image);
          });
          return { title, data };
        } catch {
          return { title };
        }
      },
    });
    capture = { ...capture, ...result?.result };
  } catch {
    // Cross-origin frames and restricted pages can require a manual image file.
  }
  if (capture.source.length > 2048 || !/^https:\/\//i.test(capture.source)) capture.source = "";
  await showCapture(capture);
}

async function showCapture(capture) {
  const key = crypto.randomUUID();
  await chrome.storage.session.set({ [key]: capture });
  try {
    const popup = await chrome.windows.create({ url: app + "/capture#" + key, type: "popup", width: 510, height: 780 });
    const cleanup = id => {
      if (id !== popup.id) return;
      chrome.windows.onRemoved.removeListener(cleanup);
      void chrome.storage.session.remove(key);
    };
    chrome.windows.onRemoved.addListener(cleanup);
  } catch (error) {
    await chrome.storage.session.remove(key);
    throw error;
  }
}

let creatingClipboard;
async function readClipboard() {
  const url = chrome.runtime.getURL("clipboard.html");
  if (!(await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [url] })).length) {
    creatingClipboard ??= chrome.offscreen.createDocument({
      url: "clipboard.html", reasons: ["CLIPBOARD"], justification: "Read copied Pin details while the capture window is open.",
    }).finally(() => { creatingClipboard = undefined; });
    await creatingClipboard;
  }
  return chrome.runtime.sendMessage({ type: "pinbot:offscreen-read" });
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === "pinbot:open-panel" && sender.url === chrome.runtime.getURL("panel.html")) {
    const key = crypto.randomUUID();
    chrome.storage.session.set({ [key]: { title: "", source: "", data: "" } })
      .then(() => respond(app + "/capture#" + key), () => respond(null));
    return true;
  }
  if (!["pinbot:read-capture", "pinbot:read-clipboard"].includes(message?.type) || !sender.url) return;
  const url = new URL(sender.url);
  const key = url.hash.slice(1);
  if (url.origin !== app || url.pathname !== "/capture" || !/^[a-f0-9-]{36}$/.test(key)) return;
  chrome.storage.session.get(key).then(async data => {
    if (!data[key]) return null;
    return message.type === "pinbot:read-clipboard" ? readClipboard() : data[key];
  }).then(respond, () => respond(null));
  return true;
});
