/* global chrome */
const status = document.querySelector("p");
chrome.runtime.sendMessage({ type: "pinbot:open-panel" }).then(url => {
  if (!url) throw new Error();
  const frame = document.querySelector("iframe");
  frame.src = url;
  frame.hidden = false;
  status.hidden = true;
}).catch(() => {
  status.textContent = "Could not open Mr. Pinbot. Reload the extension and try again.";
});
