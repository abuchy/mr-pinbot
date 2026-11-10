/* global chrome */
window.addEventListener("message", async event => {
  if (event.source !== window || event.origin !== location.origin ||
      event.data?.type !== "pinbot:request-capture" || location.pathname !== "/capture") return;
  const capture = await chrome.runtime.sendMessage({ type: "pinbot:read-capture" }).catch(() => null);
  window.postMessage({ type: "pinbot:capture", nonce: event.data.nonce, capture }, location.origin);
});


let lastClipboard;
let reading = false;
async function watchClipboard() {
  if (reading || location.pathname !== "/capture" || !location.hash) return;
  reading = true;
  try {
    const value = await chrome.runtime.sendMessage({ type: "pinbot:read-clipboard" });
    if (typeof value !== "string") return;
    if (lastClipboard !== undefined && value !== lastClipboard && value.trim()) {
      window.postMessage({ type: "pinbot:clipboard", value }, location.origin);
    }
    lastClipboard = value;
  } catch {
    // The extension may have been reloaded while this window was open.
  } finally {
    reading = false;
  }
}
void watchClipboard();
setInterval(watchClipboard, 400);
