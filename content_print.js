// Roda na página https://www.bling.com.br/relatorios/venda.impressao.php
// Dispara o diálogo de impressão automaticamente quando a página termina de carregar.

(function () {
  const ALREADY_PRINTED = "__onixAutoPrintFired";

  function triggerPrint() {
    if (window[ALREADY_PRINTED]) return;
    window[ALREADY_PRINTED] = true;

    // Espera as imagens (logo, barcode) carregarem pra impressão sair completa.
    const imgs = Array.from(document.images || []);
    const pending = imgs.filter((img) => !img.complete);

    const fire = () => {
      try {
        window.focus();
        window.print();
      } catch (e) {
        console.error("[OnixAutoPrint] erro ao chamar print:", e);
      }
    };

    if (pending.length === 0) {
      // Pequeno delay pra garantir layout final.
      setTimeout(fire, 250);
      return;
    }

    let remaining = pending.length;
    const done = () => {
      remaining -= 1;
      if (remaining <= 0) setTimeout(fire, 250);
    };
    pending.forEach((img) => {
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
    });

    // Fallback: imprime após 3s mesmo que algo trave.
    setTimeout(fire, 3000);
  }

  if (document.readyState === "complete") {
    triggerPrint();
  } else {
    window.addEventListener("load", triggerPrint, { once: true });
  }
})();
