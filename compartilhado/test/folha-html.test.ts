import { test } from "node:test";
import assert from "node:assert/strict";
import { formatarQuantidade, renderizarFolha, rotuloVia, type CodigosFolha } from "../folha/html.ts";
import { dadosFolhaExemplo } from "../../servidor/test/ajudantes.ts";

const codigos = (porSku: Record<string, string> = {}): CodigosFolha => ({ pedido: "data:image/png;base64,PEDIDO", porSku: new Map(Object.entries(porSku)) });
const via1 = { numero: 1, motivo: null, usuario: null, em: null };

test("descrição com caracteres especiais aparece escapada", () => {
  const d = dadosFolhaExemplo(1);
  d.itens[0].descricao = `Seringa <1ml> & "Luer"`;
  const { corpo } = renderizarFolha(d, via1, codigos());
  assert.ok(corpo.includes("Seringa &lt;1ml&gt; &amp; &quot;Luer&quot;"));
  assert.ok(!corpo.includes("<1ml>"));
});

test("quantidade fracionada no formato brasileiro", () => {
  assert.equal(formatarQuantidade(1.5), "1,5");
  assert.equal(formatarQuantidade(10), "10");
});

test("item sem EAN usa código de barras do SKU; sem EAN e sem SKU mostra —", () => {
  const d = dadosFolhaExemplo(2);
  d.itens[0].ean = null;
  d.itens[1].ean = null;
  d.itens[1].sku = null;
  const { corpo } = renderizarFolha(d, via1, codigos({ "SKU-001": "data:image/png;base64,SKU1" }));
  assert.ok(corpo.includes(`src="data:image/png;base64,SKU1"`));
  assert.match(corpo, /<td class="sku">—<\/td>/);
});

test("1ª via sem bloco de reimpressão; cabeçalho com pedido, código e via", () => {
  const { corpo, cabecalho, rodape } = renderizarFolha(dadosFolhaExemplo(), via1, codigos());
  assert.ok(!corpo.includes("REIMPRESSÃO"));
  assert.ok(cabecalho.includes("12345"));
  assert.ok(cabecalho.includes("data:image/png;base64,PEDIDO"));
  assert.ok(cabecalho.includes("1ª via"));
  assert.ok(rodape.includes(`class="pageNumber"`));
  assert.ok(rodape.includes(`class="totalPages"`));
});

test("reimpressão mostra via, motivo, nome e horário", () => {
  const via = { numero: 2, motivo: "Folha perdida", usuario: "Maria", em: "2026-10-08T18:00:00.000Z" };
  const { corpo, cabecalho } = renderizarFolha(dadosFolhaExemplo(), via, codigos());
  assert.equal(rotuloVia(2), "2ª via");
  assert.ok(cabecalho.includes("2ª via"));
  assert.ok(corpo.includes("REIMPRESSÃO"));
  assert.ok(corpo.includes("Folha perdida"));
  assert.ok(corpo.includes("Maria"));
  assert.ok(corpo.includes("08/10/2026 15:00"));
});

test("campos vazios aparecem como —", () => {
  const d = dadosFolhaExemplo();
  d.cliente.documento = null;
  d.transporte = null;
  d.pedido.vendedor = null;
  const { corpo } = renderizarFolha(d, via1, codigos());
  assert.ok(corpo.includes("Transporte:</b> —"));
  assert.ok(corpo.includes("Vendedor:</b> —"));
});

test("data do pedido no formato brasileiro", () => {
  const { corpo } = renderizarFolha(dadosFolhaExemplo(), via1, codigos());
  assert.ok(corpo.includes("Data do pedido:</b> 08/10/2026"));
});
