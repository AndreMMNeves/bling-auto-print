const KEY = "onixAutoPrintEnabled";

function render(enabled) {
  const status = document.getElementById("status");
  const toggle = document.getElementById("toggle");
  status.textContent = enabled ? "Ligado" : "Desligado";
  status.className = "status " + (enabled ? "on" : "off");
  toggle.textContent = enabled ? "Desligar" : "Ligar";
  toggle.className = enabled ? "off" : "";
}

chrome.storage.local.get([KEY], (res) => {
  const enabled = typeof res[KEY] === "boolean" ? res[KEY] : true;
  render(enabled);
  document.getElementById("toggle").addEventListener("click", () => {
    chrome.storage.local.get([KEY], (res2) => {
      const cur = typeof res2[KEY] === "boolean" ? res2[KEY] : true;
      const next = !cur;
      chrome.storage.local.set({ [KEY]: next }, () => render(next));
    });
  });
});
