import type { DadosFolha, Via } from "../../../compartilhado/tipos.ts";
import { escaparHtml } from "../html-util.ts";
import { formatarDataHora, formatarHora } from "../tempo.ts";

export type CodigosFolha = { pedido: string; porSku: Map<string, string> };

const campo = (s: string | number | null | undefined) => (s === null || s === undefined || s === "" ? "—" : escaparHtml(s));

export function formatarQuantidade(q: number): string {
  return q.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

// O Bling manda "2026-10-08"; a folha mostra "08/10/2026".
function formatarDataPedido(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : campo(s);
}

export function rotuloVia(n: number): string {
  return `${n}ª via`;
}

const ESTILO = `
@page { size: A4; }
* { box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 9pt; color: #000; margin: 0; }
.bloco { border: 1px solid #000; padding: 2mm 3mm; margin-bottom: 2mm; }
.linha { display: flex; justify-content: space-between; gap: 4mm; }
table { width: 100%; border-collapse: collapse; }
thead { display: table-header-group; }
th, td { border: 1px solid #000; padding: 1mm 1.5mm; text-align: left; vertical-align: middle; }
th { background: #e6e6e6; font-size: 8pt; }
tr { page-break-inside: avoid; }
td.check { width: 6mm; text-align: center; font-size: 11pt; }
td.qtd { width: 13mm; text-align: center; font-weight: bold; font-size: 11pt; }
td.sku { width: 28mm; }
td.ean { width: 44mm; }
td.ean img { height: 8mm; display: block; }
.obs { white-space: pre-wrap; }
.assinaturas { display: flex; gap: 10mm; margin-top: 6mm; }
.assinaturas div { flex: 1; border-top: 1px solid #000; padding-top: 1mm; }
.reimpressao { border: 2px solid #000; padding: 2mm 3mm; font-weight: bold; margin-top: 2mm; }
`;

export function renderizarFolha(d: DadosFolha, via: Via, codigos: CodigosFolha): { corpo: string; cabecalho: string; rodape: string } {
  const linhas = d.itens.map((i) => {
    const ean = i.ean
      ? escaparHtml(i.ean)
      : i.sku && codigos.porSku.has(i.sku)
        ? `<img src="${codigos.porSku.get(i.sku)}" alt="${escaparHtml(i.sku)}">`
        : "—";
    return `<tr><td class="check">☐</td><td class="qtd">${formatarQuantidade(i.quantidade)}</td>` +
      `<td class="sku">${campo(i.sku)}</td><td>${campo(i.descricao)}</td><td class="ean">${ean}</td></tr>`;
  }).join("");

  const totalItens = d.itens.reduce((s, i) => s + i.quantidade, 0);

  const reimpressao = via.numero > 1 || via.motivo
    ? `<div class="reimpressao">REIMPRESSÃO — ${rotuloVia(via.numero)} — Motivo: ${campo(via.motivo)} — Por: ${campo(via.usuario)} em ${formatarDataHora(via.em)}</div>`
    : "";

  const corpo = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>${ESTILO}</style></head><body>
<div class="bloco"><div class="linha">
  <span><b>Data do pedido:</b> ${formatarDataPedido(d.pedido.data)}</span>
  <span><b>Atendido:</b> ${formatarDataHora(d.pedido.atendidoEm)}</span>
  <span><b>Vendedor:</b> ${campo(d.pedido.vendedor)}</span>
</div></div>
<div class="bloco">
  <div><b>CLIENTE:</b> ${campo(d.cliente.nome)} — ${campo(d.cliente.documento)}</div>
  <div><b>Entrega:</b> ${campo(d.entrega.endereco)} — ${campo(d.entrega.cidadeUf)} — CEP ${campo(d.entrega.cep)}</div>
  <div><b>Transporte:</b> ${campo(d.transporte)}</div>
</div>
<table>
  <thead><tr><th>☐</th><th>QTD</th><th>SKU</th><th>PRODUTO</th><th>EAN</th></tr></thead>
  <tbody>${linhas}</tbody>
</table>
<div class="bloco" style="margin-top:2mm">
  <div class="linha"><span><b>Total de itens:</b> ${formatarQuantidade(totalItens)} (${d.itens.length} linhas)</span><span><b>Volumes:</b> ______</span></div>
  <div class="obs"><b>Observações do pedido:</b> ${campo(d.pedido.observacoes)}</div>
</div>
<div class="assinaturas"><div>Separado por</div><div>Conferido por</div></div>
${reimpressao}
</body></html>`;

  // Cabeçalho e rodapé do Chrome: repetidos em toda página. Só aceitam estilo inline.
  const cabecalho = `<div style="width:100%;font-family:Arial;font-size:9pt;padding:0 10mm;display:flex;align-items:center;justify-content:space-between;">
  <div><b style="font-size:11pt">ÔNIX HOF — ${escaparHtml(d.filial)}</b><br>FOLHA DE SEPARAÇÃO</div>
  <div style="text-align:center"><b style="font-size:13pt">Pedido nº ${escaparHtml(d.pedido.numero)}</b></div>
  <img src="${codigos.pedido}" style="height:14mm">
  <div style="border:1px solid #000;padding:1mm 2mm;font-weight:bold;font-size:10pt">${rotuloVia(via.numero)}</div>
</div>`;

  const rodape = `<div style="width:100%;font-family:Arial;font-size:8pt;padding:0 10mm;display:flex;justify-content:space-between;">
  <span>Pedido nº ${escaparHtml(d.pedido.numero)} — gerado ${formatarHora(new Date().toISOString())}</span>
  <span>Página <span class="pageNumber"></span>/<span class="totalPages"></span></span>
</div>`;

  return { corpo, cabecalho, rodape };
}
