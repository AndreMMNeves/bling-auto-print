// Roda em todas as páginas do Bling (exceto a de impressão).
// Fluxo:
//   1. Usuário marca pedidos (checkboxes) e clica no item "Atendido"
//      do menu de ações em massa, OU clica em "Atendido" no menu
//      individual de uma linha (3 pontinhos).
//   2. Esta extensão captura os pedidos selecionados ANTES do
//      atendimento concluir.
//   3. Depois de um pequeno delay (pra o Bling processar), abre
//      o menu de ações de cada pedido e clica em "Imprimir".
//   4. O Bling abre a página venda.impressao.php numa nova aba.
//   5. O content_print.js dispara o window.print() lá.
//
// Os seletores foram inferidos pelos screenshots. Se algo não bater,
// ajuste as funções `findActionMenuItem`, `findRowMenuButton` e
// `getSelectedOrderRows` abaixo.

(function () {
  const TAG = "[OnixAutoPrint]";
  const log = (...args) => console.log(TAG, ...args);

  // === Configurações ===
  const PRINT_DELAY_MS = 1500; // tempo de espera após "Atendido" antes de imprimir
  const STEP_DELAY_MS = 400;   // delay entre cada impressão (pra não estourar popup blocker)
  const ENABLED_KEY = "onixAutoPrintEnabled";

  let enabled = true;
  chrome.storage?.local?.get?.([ENABLED_KEY], (res) => {
    if (typeof res?.[ENABLED_KEY] === "boolean") enabled = res[ENABLED_KEY];
  });
  chrome.storage?.onChanged?.addListener?.((changes, area) => {
    if (area === "local" && ENABLED_KEY in changes) {
      enabled = !!changes[ENABLED_KEY].newValue;
      log("habilitado:", enabled);
    }
  });

  // === Helpers de DOM ===

  // Encontra todas as linhas (tr) da listagem de pedidos.
  function getOrderRows() {
    // Bling usa <tr> com data-attribute de id; mas como não temos acesso ao HTML real,
    // usamos heurística: linhas que contém um número de pedido (4-7 dígitos) numa célula.
    return Array.from(document.querySelectorAll("tr")).filter((tr) => {
      const checkbox = tr.querySelector('input[type="checkbox"]');
      return !!checkbox && tr.querySelectorAll("td").length >= 3;
    });
  }

  // Linhas com checkbox marcado.
  function getSelectedOrderRows() {
    return getOrderRows().filter((tr) => {
      const cb = tr.querySelector('input[type="checkbox"]');
      return cb && cb.checked;
    });
  }

  // Tenta extrair o número/id do pedido a partir da linha.
  function getOrderNumberFromRow(tr) {
    // Heurística: primeira td numérica com 4+ dígitos é o número do pedido.
    const tds = Array.from(tr.querySelectorAll("td"));
    for (const td of tds) {
      const t = (td.textContent || "").trim();
      if (/^\d{4,8}$/.test(t)) return t;
    }
    // Fallback: olha por data-id, data-idVenda etc.
    return (
      tr.getAttribute("data-id") ||
      tr.getAttribute("data-idvenda") ||
      tr.getAttribute("data-id-venda") ||
      null
    );
  }

  // Encontra o botão de menu (3 pontinhos) na linha.
  function findRowMenuButton(tr) {
    // Heurística: último botão da linha, ou elemento com classe contendo "menu"/"options".
    const candidates = [
      ...tr.querySelectorAll("button"),
      ...tr.querySelectorAll('[role="button"]'),
      ...tr.querySelectorAll('[class*="menu"]'),
      ...tr.querySelectorAll('[class*="options"]'),
      ...tr.querySelectorAll('[class*="more"]'),
      ...tr.querySelectorAll('[class*="dots"]'),
    ];
    // Pega o último candidato visível.
    for (let i = candidates.length - 1; i >= 0; i--) {
      const el = candidates[i];
      if (el.offsetParent !== null) return el;
    }
    return null;
  }

  // Procura no DOM (body) um item de menu com determinado texto, case-insensitive.
  // Usado pra achar "Imprimir" e "Atendido" no menu flutuante.
  function findMenuItemByText(text) {
    const target = String(text).trim().toLowerCase();
    // Pega itens de menu visíveis (geralmente <a>, <li>, <button> ou <div role=menuitem>).
    const selector =
      'a, li, button, [role="menuitem"], [class*="menu"] *';
    const nodes = Array.from(document.querySelectorAll(selector));
    for (const n of nodes) {
      // Só considera visível
      if (n.offsetParent === null) continue;
      const txt = (n.innerText || n.textContent || "").trim().toLowerCase();
      if (!txt) continue;
      // Match exato ou contém o termo isolado.
      if (txt === target || txt.split(/\s+/).includes(target)) {
        return n;
      }
    }
    return null;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // Tenta abrir o menu de ações da linha e clicar em "Imprimir".
  async function triggerPrintForRow(tr, orderNumber) {
    log("disparando impressão para pedido", orderNumber);

    const menuBtn = findRowMenuButton(tr);
    if (!menuBtn) {
      log("não encontrei botão de menu na linha do pedido", orderNumber);
      return false;
    }

    menuBtn.click();
    await sleep(350); // espera o menu abrir

    const printItem = findMenuItemByText("Imprimir");
    if (!printItem) {
      log("item 'Imprimir' não apareceu para pedido", orderNumber);
      // Fecha o menu (clica fora) pra não deixar UI travada.
      document.body.click();
      return false;
    }

    printItem.click();
    log("cliquei em Imprimir para pedido", orderNumber);
    return true;
  }

  // === Detecção do clique em "Atendido" ===

  // Captura pedidos antes do atendimento.
  let pendingPrint = []; // array de { tr, orderNumber }

  function captureSelectedOrders(clickedAtendidoNearRow) {
    // Caso 1: ação em massa — usa todos os checkboxes marcados.
    const selected = getSelectedOrderRows();
    if (selected.length > 0) {
      pendingPrint = selected
        .map((tr) => ({ tr, orderNumber: getOrderNumberFromRow(tr) }))
        .filter((x) => x.orderNumber);
      log("ação em massa, pedidos capturados:", pendingPrint.map((x) => x.orderNumber));
      return;
    }
    // Caso 2: ação individual pelo menu de uma linha — usa a linha mais próxima do clique.
    if (clickedAtendidoNearRow) {
      const orderNumber = getOrderNumberFromRow(clickedAtendidoNearRow);
      if (orderNumber) {
        pendingPrint = [{ tr: clickedAtendidoNearRow, orderNumber }];
        log("ação individual, pedido capturado:", orderNumber);
        return;
      }
    }
    pendingPrint = [];
  }

  // Tenta achar a linha de pedido associada a um elemento clicado (item de menu).
  // Como o menu costuma ser um popup fora da tabela, isso pode ser null em ações em massa.
  function findRowForClickedMenuItem(el) {
    // Sobe até achar tr.
    let cur = el;
    while (cur && cur !== document.body) {
      if (cur.tagName === "TR" && cur.querySelector('input[type="checkbox"]')) {
        return cur;
      }
      cur = cur.parentElement;
    }
    return null;
  }

  // Listener global de clique — detecta clique no item "Atendido".
  document.addEventListener(
    "click",
    (ev) => {
      if (!enabled) return;
      const el = ev.target.closest(
        'a, li, button, [role="menuitem"], [class*="menu"] *'
      );
      if (!el) return;
      const txt = (el.innerText || el.textContent || "").trim().toLowerCase();
      if (!txt) return;
      // Match: "atendido" exato (evita pegar coisas tipo "marcar como atendido" só se for o caso).
      const isAtendido =
        txt === "atendido" || /\batendido\b/.test(txt);
      if (!isAtendido) return;

      log("clique em 'Atendido' detectado");
      const nearRow = findRowForClickedMenuItem(el);
      captureSelectedOrders(nearRow);

      if (pendingPrint.length === 0) {
        log("nenhum pedido capturado, abortando impressão automática");
        return;
      }

      // Aguarda o Bling processar o atendimento.
      setTimeout(async () => {
        const items = pendingPrint.slice();
        pendingPrint = [];
        for (const { tr, orderNumber } of items) {
          // Re-verifica se a linha ainda existe no DOM (pode ter sumido por causa do filtro).
          let liveRow = tr.isConnected ? tr : null;
          if (!liveRow) {
            // Tenta achar pela rownumber atual.
            liveRow = getOrderRows().find(
              (r) => getOrderNumberFromRow(r) === orderNumber
            );
          }
          if (!liveRow) {
            log("linha do pedido", orderNumber, "sumiu da tela — não consigo reimprimir");
            continue;
          }
          await triggerPrintForRow(liveRow, orderNumber);
          await sleep(STEP_DELAY_MS);
        }
      }, PRINT_DELAY_MS);
    },
    true // captura na fase de captura pra registrar antes do handler nativo
  );

  log("content_listing.js carregado");
})();
