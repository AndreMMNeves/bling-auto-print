// Service worker — coordena abertura de abas de impressão.
// O content_listing.js manda mensagens daqui pra abrir uma nova aba
// na página de impressão do pedido, mas o fluxo principal é todo
// feito direto no DOM via simulação de cliques (mais robusto que
// tentar reconstruir a URL POST do Bling).

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "log") {
    console.log("[OnixAutoPrint]", ...(msg.args || []));
    sendResponse({ ok: true });
    return true;
  }
});
