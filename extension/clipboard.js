/* global chrome */
const buffer = document.querySelector("textarea");
chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.type !== "pinbot:offscreen-read") return;
  buffer.focus();
  const pasted = document.execCommand("paste");
  const value = buffer.value;
  buffer.value = "";
  respond(pasted ? value : null);
});
