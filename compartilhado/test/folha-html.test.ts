import { test } from "node:test";
import assert from "node:assert/strict";
import { formatarDinheiro, formatarQuantidade, renderizarFolha, rotuloVia, type CodigosFolha } from "../folha/html.ts";
import { dadosFolhaExemplo } from "../../servidor/test/ajudantes.ts";

const codigos: CodigosFolha = { pedido: "data:image/png;base64,PEDIDO", porSku: new Map() };
const via1 = { numero: 1, motivo: null, usuario: null, em: null };
const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("números no formato do Bling (2 casas, vírgula)", () => {
  assert.equal(formatarQuantidade(1), "1,00");
  assert.equal(formatarQuantidade(1.5), "1,50");
  assert.equal(formatarDinheiro(1058), "1.058,00");
  assert.equal(formatarDinheiro(null), "");
});

test("cabeçalho do pedido: número, código de barras, cliente e caixa com número/data", () => {
  const { corpo } = renderizarFolha(dadosFolhaExemplo(), via1, codigos);
  const t = texto(corpo);
  assert.match(t, /Pedido 12345/);
  assert.ok(corpo.includes(`src="data:image/png;base64,PEDIDO"`));
  assert.match(t, /Cliente Clínica X CNPJ: 12\.345\.678\/0001-90, Rua A, N° 10, Bairro: Centro\. 29000000 - Vitória, ES Fone: \(27\) 3333-4444, clinica@x\.com/);
  assert.match(t, /Número do pedido 12345 Data 08\/10\/2026 Data prevista/);
  assert.match(t, /Vendedor Fulano/);
});

test("tabela de itens com as colunas do Bling e linhas de detalhe", () => {
  const d = dadosFolhaExemplo(1);
  d.itens[0].detalhes = ["L20 X A8 X P10 CM", "Peso Bruto: 0.20000"];
  const t = texto(renderizarFolha(d, via1, codigos).corpo);
  assert.match(t, /Descrição do produto\/serviço Código Un\. Localização Qtd\. Preço de lista Desc % Valor unitário Total/);
  assert.match(t, /Produto 1 L20 X A8 X P10 CM Peso Bruto: 0\.20000 SKU-001 Un F100 1,00 100,00 0,00% 100,00 100,00/);
});

test("totais, parcelas e transportador", () => {
  const t = texto(renderizarFolha(dadosFolhaExemplo(2), via1, codigos).corpo);
  assert.match(t, /N° de itens 2,00 Desconto dos itens 0,00 Soma das Qtdes 3,00 Total de produtos 300,00 Frete 20,00 Total do pedido 320,00/);
  assert.match(t, /Parcelas Dias Data vencimento Forma de pagamento Valor Observação 0 08\/10\/2026 PIX - ITAÚ 320,00/);
  assert.match(t, /Transportador Nome Correios Modalidade de frete Contratação do Frete por conta do Remetente \(CIF\) Serviço SEDEX/);
});

test("descrição com caracteres especiais aparece escapada", () => {
  const d = dadosFolhaExemplo(1);
  d.itens[0].descricao = `Seringa <1ml> & "Luer"`;
  const { corpo } = renderizarFolha(d, via1, codigos);
  assert.ok(corpo.includes("Seringa &lt;1ml&gt; &amp; &quot;Luer&quot;"));
  assert.ok(!corpo.includes("<1ml>"));
});

test("1ª via sem aviso de reimpressão; via e página no cabeçalho/rodapé", () => {
  const { corpo, cabecalho, rodape } = renderizarFolha(dadosFolhaExemplo(), via1, codigos);
  assert.ok(!corpo.includes("REIMPRESSÃO"));
  assert.ok(cabecalho.includes("Pedido de Venda"));
  assert.ok(cabecalho.includes("1ª via"));
  assert.ok(rodape.includes(`class="pageNumber"`));
  assert.ok(rodape.includes(`class="totalPages"`));
});

test("reimpressão mostra via, motivo, nome e horário", () => {
  const via = { numero: 2, motivo: "Folha perdida", usuario: "Maria", em: "2026-10-08T18:00:00.000Z" };
  const { corpo, cabecalho } = renderizarFolha(dadosFolhaExemplo(), via, codigos);
  assert.equal(rotuloVia(2), "2ª via");
  assert.ok(cabecalho.includes("2ª via"));
  const t = texto(corpo);
  assert.match(t, /REIMPRESSÃO — 2ª via — Motivo: Folha perdida — Por: Maria em 08\/10\/2026 15:00/);
});

test("folha antiga (sem os campos novos) ainda é impressa", () => {
  const d = dadosFolhaExemplo(1) as unknown as Record<string, unknown>;
  delete d.totais;
  delete d.parcelas;
  delete d.transportador;
  const t = texto(renderizarFolha(d as never, via1, codigos).corpo);
  assert.match(t, /Pedido 12345/);
  assert.match(t, /Transportador Nome — Modalidade de frete — Serviço SEDEX/);
});

test("rótulo CPF para pessoa física e CNPJ para empresa, como no Bling", () => {
  const d = dadosFolhaExemplo(1);
  d.cliente.documento = "435.242.208-86";
  assert.match(texto(renderizarFolha(d, via1, codigos).corpo), /CPF: 435\.242\.208-86,/);
  d.cliente.documento = "12.345.678/0001-90";
  assert.match(texto(renderizarFolha(d, via1, codigos).corpo), /CNPJ: 12\.345\.678\/0001-90,/);
});
