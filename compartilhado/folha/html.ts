import type { DadosFolha, Via } from "../tipos.ts";
import { escaparHtml } from "../html-util.ts";
import { formatarDataHora } from "../tempo.ts";

// Folha no mesmo modelo da impressão "Pedido de Venda" do Bling (que a expedição já conhece),
// com o selo de via e o aviso de reimpressão do sistema.
export type CodigosFolha = { pedido: string; porSku: Map<string, string> };

const campo = (s: string | number | null | undefined) => (s === null || s === undefined || s === "" ? "—" : escaparHtml(s));
const vazio = (s: string | null | undefined) => escaparHtml(s ?? "");

export function formatarQuantidade(q: number): string {
  return q.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

export function formatarDinheiro(v: number | null | undefined): string {
  if (v === null || v === undefined) return "";
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function rotuloVia(n: number): string {
  return `${n}ª via`;
}

// O Bling manda "2026-10-08"; a folha mostra "08/10/2026".
function data(s: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

const ESTILO = `
@page { size: A4; }
* { box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 8.5pt; color: #000; margin: 0; }
.topo { display: flex; justify-content: space-between; align-items: center; margin-bottom: 3mm; }
.logo { font-size: 15pt; font-weight: 800; letter-spacing: .5px; }
.logo small { display: block; font-size: 6pt; font-weight: 400; letter-spacing: 0; color: #444; }
.empresa { font-size: 8pt; }
.titulo { text-align: center; margin: 2mm 0 4mm; }
.titulo h1 { font-size: 13pt; margin: 0 0 1.5mm; }
.titulo img { height: 13mm; }
.rotulo { font-weight: bold; font-size: 7.5pt; margin: 3mm 0 1mm; }
.caixa { border: 1px solid #000; padding: 1.5mm 2mm; }
.linha-cliente { display: flex; gap: 3mm; align-items: flex-start; }
.linha-cliente .caixa { flex: 1; line-height: 1.35; }
table { border-collapse: collapse; width: 100%; }
td, th { border: 1px solid #000; padding: 1mm 1.5mm; vertical-align: middle; text-align: left; }
th { font-weight: bold; }
.ident { width: 62mm; }
.ident th { width: 30mm; }
.vendedor { width: 95mm; }
.itens th { font-size: 8pt; vertical-align: bottom; }
.itens .num { text-align: right; white-space: nowrap; }
.itens .cod { text-align: center; white-space: nowrap; }
.itens tr { page-break-inside: avoid; }
.detalhe { font-style: italic; font-size: 7pt; color: #222; }
.detalhe.peso { margin-top: 2.5mm; font-size: 8pt; }
.totais td { border: 0; padding: .3mm 1.5mm; text-align: right; font-weight: bold; }
.totais td.valor { border-left: 1px solid #000; font-weight: normal; width: 22mm; }
.celula-totais { padding: 0; }
.parcelas .num, .parcelas .valor { text-align: right; }
.transp th { width: 38mm; }
.obs { white-space: pre-wrap; }
.reimpressao { border: 2px solid #000; padding: 2mm 3mm; font-weight: bold; margin-top: 4mm; }
`;

export function renderizarFolha(d: DadosFolha, via: Via, codigos: CodigosFolha): { corpo: string; cabecalho: string; rodape: string } {
  const c = d.cliente;
  const contatos = [c.telefone, c.email].filter(Boolean).join(", ");

  const itens = d.itens.map((i) => `<tr>
    <td>${campo(i.descricao)}${(i.detalhes ?? []).map((l) => `<div class="detalhe${l.startsWith("Peso") ? " peso" : ""}">${escaparHtml(l)}</div>`).join("")}</td>
    <td class="cod">${vazio(i.sku)}</td>
    <td class="cod">${vazio(i.unidade)}</td>
    <td>${vazio(i.localizacao)}</td>
    <td class="num">${formatarQuantidade(i.quantidade)}</td>
    <td class="num">${formatarDinheiro(i.precoLista)}</td>
    <td class="num">${i.descontoPct === null || i.descontoPct === undefined ? "" : `${formatarDinheiro(i.descontoPct)}%`}</td>
    <td class="num">${formatarDinheiro(i.valorUnitario)}</td>
    <td class="num">${formatarDinheiro(i.total)}</td>
  </tr>`).join("");

  const t = d.totais;
  const linhasTotais = t
    ? [
        ["N° de itens", formatarQuantidade(t.qtdItens)],
        ["Desconto dos itens", formatarDinheiro(t.descontoItens)],
        ["Soma das Qtdes", formatarQuantidade(t.somaQtd)],
        ["Total de produtos", formatarDinheiro(t.totalProdutos)],
        ...(t.descontoPedido ? [["Desconto do pedido", formatarDinheiro(t.descontoPedido)]] : []),
        ...(t.outrasDespesas ? [["Outras despesas", formatarDinheiro(t.outrasDespesas)]] : []),
        ["Frete", formatarDinheiro(t.frete)],
        ["Total do pedido", formatarDinheiro(t.total)],
      ]
    : [["N° de itens", formatarQuantidade(d.itens.length)], ["Soma das Qtdes", formatarQuantidade(d.itens.reduce((s, i) => s + i.quantidade, 0))]];
  const totais = `<tr><td colspan="9" class="celula-totais"><table class="totais">${linhasTotais
    .map(([r, v]) => `<tr><td>${r}</td><td class="valor">${v}</td></tr>`).join("")}</table></td></tr>`;

  const parcelas = d.parcelas?.length
    ? `<div class="rotulo">Parcelas</div>
<table class="parcelas"><tr><th style="width:12mm">Dias</th><th style="width:34mm">Data vencimento</th><th>Forma de pagamento</th><th class="valor" style="width:24mm">Valor</th><th style="width:34mm">Observação</th></tr>
${d.parcelas.map((p) => `<tr><td>${p.dias ?? ""}</td><td>${data(p.vencimento)}</td><td>${vazio(p.forma)}</td><td class="valor">${formatarDinheiro(p.valor)}</td><td>${vazio(p.observacao)}</td></tr>`).join("")}
</table>`
    : "";

  const tr = d.transportador ?? { nome: null, modalidade: null, servico: d.transporte };
  const transportador = `<div class="rotulo">Transportador</div>
<table class="transp">
  <tr><th>Nome</th><td>${campo(tr.nome)}</td></tr>
  <tr><th>Modalidade de frete</th><td>${campo(tr.modalidade)}</td></tr>
  ${tr.servico ? `<tr><th>Serviço</th><td>${escaparHtml(tr.servico)}</td></tr>` : ""}
</table>`;

  const observacoes = d.pedido.observacoes
    ? `<div class="rotulo">Observações</div><div class="caixa obs">${escaparHtml(d.pedido.observacoes)}</div>`
    : "";

  const reimpressao = via.numero > 1 || via.motivo
    ? `<div class="reimpressao">REIMPRESSÃO — ${rotuloVia(via.numero)} — Motivo: ${campo(via.motivo)} — Por: ${campo(via.usuario)} em ${formatarDataHora(via.em)}</div>`
    : "";

  const corpo = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>${ESTILO}</style></head><body>
<div class="topo"><div class="logo">ÔNIX<small>Produtos para Harmonização Facial</small></div><div class="empresa">Ônix - Produtos para Harmonização</div></div>
<div class="titulo"><h1>Pedido ${escaparHtml(d.pedido.numero)}</h1><img src="${codigos.pedido}" alt="${escaparHtml(d.pedido.codigoBarras)}"></div>
<div class="rotulo">Cliente</div>
<div class="linha-cliente">
  <div class="caixa">
    <b>${campo(c.nome)}</b><br>
    ${c.fantasia ? `${escaparHtml(c.fantasia)}<br>` : ""}
    ${c.documento ? `${c.documento.replace(/\D/g, "").length > 11 ? "CNPJ" : "CPF"}: ${escaparHtml(c.documento)}, ` : ""}${vazio(c.endereco)}<br>
    ${c.cidade ? `${escaparHtml(c.cidade)}<br>` : ""}
    ${vazio(contatos)}
  </div>
  <table class="ident">
    <tr><th>Número do pedido</th><td>${escaparHtml(d.pedido.numero)}</td></tr>
    <tr><th>Data</th><td>${data(d.pedido.data)}</td></tr>
    <tr><th>Data prevista</th><td>${data(d.pedido.dataPrevista)}</td></tr>
  </table>
</div>
<div class="rotulo">Vendedor</div>
<div class="caixa vendedor">${vazio(d.pedido.vendedor) || "&nbsp;"}</div>
<div class="rotulo">Itens do pedido de venda</div>
<table class="itens">
  <thead><tr><th>Descrição do produto/serviço</th><th class="cod">Código</th><th class="cod">Un.</th><th>Localização</th><th>Qtd.</th><th class="num">Preço de lista</th><th class="num">Desc %</th><th class="num">Valor unitário</th><th class="num">Total</th></tr></thead>
  <tbody>${itens}${totais}</tbody>
</table>
${parcelas}
${transportador}
${observacoes}
${reimpressao}
</body></html>`;

  // Cabeçalho e rodapé do Chrome: repetidos em toda página. Só aceitam estilo inline.
  const cabecalho = `<div style="width:100%;font-family:Arial;font-size:7.5pt;padding:0 10mm;display:flex;justify-content:space-between;align-items:center;">
  <span>${formatarDataHora(new Date().toISOString())}</span>
  <span>Ônix - Pedido de Venda</span>
  <span style="border:1px solid #000;padding:.5mm 2mm;font-weight:bold;">${rotuloVia(via.numero)}</span>
</div>`;

  const rodape = `<div style="width:100%;font-family:Arial;font-size:7.5pt;padding:0 10mm;display:flex;justify-content:space-between;">
  <span>Pedido ${escaparHtml(d.pedido.numero)}</span>
  <span><span class="pageNumber"></span>/<span class="totalPages"></span></span>
</div>`;

  return { corpo, cabecalho, rodape };
}
