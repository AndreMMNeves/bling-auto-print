# Onix HOF - Auto Impressão Bling

Extensão de navegador (Chrome / Edge) que imprime automaticamente o
pedido de venda do Bling assim que ele é movido para **Atendido**.

## Como funciona

1. O consultor seleciona um ou mais pedidos na lista de **Pedidos de
   venda** do Bling.
2. Clica em **Atendido** (no menu de ações em massa ou no menu de 3
   pontinhos da linha).
3. A extensão captura os pedidos selecionados e, logo após o Bling
   confirmar o atendimento, abre a página de impressão de cada um.
4. Na página `relatorios/venda.impressao.php`, o diálogo de impressão
   do Chrome é disparado automaticamente — basta confirmar.

## Instalação

### Chrome ou Edge

1. Abra `chrome://extensions` (ou `edge://extensions`).
2. Ative o **Modo desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação**.
4. Selecione esta pasta: `C:\Users\Administrador\bling-auto-print`.
5. Pronto — o ícone verde com "O" aparece na barra de extensões.

### Permitir popups do Bling

Como cada impressão abre numa nova aba, garanta que popups de
`bling.com.br` estejam permitidos:

- `chrome://settings/content/popups` → Adicionar
  `https://www.bling.com.br` à lista de permitidos.

## Ligar / desligar

Clique no ícone da extensão na barra para alternar entre ligado e
desligado. O estado fica salvo entre sessões.

## Ajustes finos

Se a impressão não disparar (porque o HTML do Bling mudou ou usa
seletores diferentes), edite `content_listing.js` — ajuste:

- `findRowMenuButton` (botão de 3 pontinhos da linha)
- `findMenuItemByText` (busca de item "Imprimir" no menu flutuante)
- `getOrderNumberFromRow` (como o número do pedido aparece na linha)

Logs aparecem no DevTools (F12) da página do Bling, prefixados com
`[OnixAutoPrint]`.

## Arquivos

- `manifest.json` — declaração da extensão (Manifest V3)
- `background.js` — service worker (passivo)
- `content_listing.js` — intercepta cliques em "Atendido" na listagem
- `content_print.js` — dispara `window.print()` na página de impressão
- `popup.html` / `popup.js` — UI de ligar/desligar
- `icons/` — ícones (16/32/48/128)
