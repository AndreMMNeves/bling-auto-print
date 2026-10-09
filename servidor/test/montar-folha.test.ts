import { test } from "node:test";
import assert from "node:assert/strict";
import { criarMontadorFolha, type FonteBling } from "../src/bling/montar-folha.ts";
import type { PedidoBling, ProdutoBling } from "../src/bling/cliente.ts";
import { AGORA } from "./ajudantes.ts";

// Baseado no pedido 297469 do Bling SP (modelo de impressão enviado pelo usuário).
const pedido = (extra: Partial<PedidoBling> = {}): PedidoBling => ({
  id: 77, numero: "297469", numeroLoja: null, data: "2026-10-09", dataPrevista: null,
  contato: { id: 500, nome: "Vitoria Chalega de Lima", numeroDocumento: "435.242.208-86" }, vendedorId: 3,
  itens: [
    { codigo: "ON.9", descricao: "BIOGELIS GLOBAL WITH LIDOCAINE 20 MG/ML+0, 3% LIDOCAINA", descricaoDetalhada: null, unidade: "Un", quantidade: 1, valor: 407, descontoPct: 0, produtoId: 9 },
    { codigo: "ON.11", descricao: "BIOGELIS VOLUME WITH LIDOCAINE 25 MG/ML+0, 3% LIDOCAINA", descricaoDetalhada: null, unidade: "Un", quantidade: 1, valor: 417, descontoPct: 0, produtoId: 11 },
    { codigo: null, descricao: "Brinde", descricaoDetalhada: "Amostra grátis", unidade: null, quantidade: 2, valor: 10, descontoPct: 50, produtoId: null },
  ],
  etiqueta: { endereco: "Rua Urânio", numero: "89", complemento: null, bairro: "Parque Primavera", municipio: "Guarulhos", uf: "SP", cep: "07145140" },
  transporte: null, observacoes: null,
  totalProdutos: 834, total: 874, outrasDespesas: 0, desconto: { valor: 0, unidade: "REAL" },
  parcelas: [{ vencimento: "2026-10-09", valor: 874, observacao: null, formaPagamentoId: 6503483 }],
  frete: 40, fretePorConta: 0, transportadorNome: "JPL TARDE (11:10 AS 14:30)",
  ...extra,
});

const produto = (id: number): ProdutoBling => ({
  gtin: id === 11 ? "7891111111111" : null, codigo: null, localizacao: id === 11 ? "F101" : "F102",
  pesoBruto: 0.2, dimensoes: { largura: 20, altura: 8, profundidade: 10 },
});

function fonte(p: PedidoBling, falhas: { contato?: boolean } = {}) {
  const chamadas = { vendedor: 0, forma: 0 };
  const f: FonteBling = {
    obterPedido: async () => p,
    obterProduto: async (id) => produto(id),
    obterVendedor: async () => { chamadas.vendedor++; return { nome: "Gustavo Hortins" }; },
    obterContato: async () => {
      if (falhas.contato) throw new Error("Bling /contatos/500 respondeu 403");
      return {
        fantasia: null, telefone: "(11) 95790-9171", celular: "(11) 95790-9171", email: "dravitoriachalega@hotmail.com",
        endereco: { endereco: "Rua Urânio", numero: "89", complemento: null, bairro: "Parque Primavera", municipio: "Guarulhos", uf: "SP", cep: "07145140" },
      };
    },
    obterFormaPagamento: async () => { chamadas.forma++; return { descricao: "PIX - ITAÚ" }; },
  };
  return { f, chamadas };
}

const montar = (f: FonteBling) => criarMontadorFolha(f, { filialNome: "São Paulo", campoCodigoBarras: "numero" });

test("cliente com documento, endereço, telefone e e-mail como no Bling", async () => {
  const d = await montar(fonte(pedido()).f)(77, AGORA);
  assert.equal(d.cliente.nome, "Vitoria Chalega de Lima");
  assert.equal(d.cliente.documento, "435.242.208-86");
  assert.equal(d.cliente.endereco, "Rua Urânio, N° 89, Bairro: Parque Primavera.");
  assert.equal(d.cliente.cidade, "07145140 - Guarulhos, SP");
  assert.equal(d.cliente.telefone, "Fone: (11) 95790-9171, Celular: (11) 95790-9171");
  assert.equal(d.cliente.email, "dravitoriachalega@hotmail.com");
  assert.equal(d.pedido.vendedor, "Gustavo Hortins");
});

test("itens com unidade, localização, preços, desconto e detalhes (medidas e peso)", async () => {
  const d = await montar(fonte(pedido()).f)(77, AGORA);
  const vol = d.itens.find((i) => i.sku === "ON.11")!;
  assert.equal(vol.unidade, "Un");
  assert.equal(vol.localizacao, "F101");
  assert.equal(vol.precoLista, 417);
  assert.equal(vol.descontoPct, 0);
  assert.equal(vol.valorUnitario, 417);
  assert.equal(vol.total, 417);
  assert.deepEqual(vol.detalhes, ["L20 X A8 X P10 CM", "Peso Bruto: 0.20000"]);
  const brinde = d.itens.find((i) => i.sku === null)!;
  assert.equal(brinde.valorUnitario, 5);
  assert.equal(brinde.total, 10);
  assert.deepEqual(brinde.detalhes, ["Amostra grátis"]);
});

test("itens na ordem do pedido no Bling", async () => {
  const d = await montar(fonte(pedido()).f)(77, AGORA);
  assert.deepEqual(d.itens.map((i) => i.sku), ["ON.9", "ON.11", null]);
});

test("totais, parcelas e transportador", async () => {
  const d = await montar(fonte(pedido()).f)(77, AGORA);
  assert.deepEqual(d.totais, {
    qtdItens: 3, somaQtd: 4, descontoItens: 10, totalProdutos: 834, frete: 40, outrasDespesas: 0, descontoPedido: 0, total: 874,
  });
  assert.deepEqual(d.parcelas, [{ dias: 0, vencimento: "2026-10-09", forma: "PIX - ITAÚ", valor: 874, observacao: null }]);
  assert.deepEqual(d.transportador, { nome: "JPL TARDE (11:10 AS 14:30)", modalidade: "Contratação do Frete por conta do Remetente (CIF)", servico: null });
});

test("sem permissão de contato: usa o endereço de entrega e segue", async () => {
  const d = await montar(fonte(pedido(), { contato: true }).f)(77, AGORA);
  assert.equal(d.cliente.endereco, "Rua Urânio, N° 89, Bairro: Parque Primavera.");
  assert.equal(d.cliente.telefone, null);
});

test("campo do código de barras configurável", async () => {
  const { f } = fonte(pedido({ numeroLoja: "MP-999" }));
  assert.equal((await criarMontadorFolha(f, { filialNome: "SP", campoCodigoBarras: "numeroLoja" })(77, AGORA)).pedido.codigoBarras, "MP-999");
  assert.equal((await criarMontadorFolha(f, { filialNome: "SP", campoCodigoBarras: "id" })(77, AGORA)).pedido.codigoBarras, "77");
  const { f: semLoja } = fonte(pedido());
  assert.equal((await criarMontadorFolha(semLoja, { filialNome: "SP", campoCodigoBarras: "numeroLoja" })(77, AGORA)).pedido.codigoBarras, "297469");
});

test("vendedor e forma de pagamento ficam em cache entre pedidos", async () => {
  const { f, chamadas } = fonte(pedido());
  const m = montar(f);
  await m(77, AGORA);
  await m(77, AGORA);
  assert.equal(chamadas.vendedor, 1);
  assert.equal(chamadas.forma, 1);
});

test("produto ou vendedor excluído no Bling não impede a folha", async () => {
  const { f } = fonte(pedido());
  f.obterProduto = async (id) => { if (id === 9) throw new Error("Bling /produtos/9 respondeu 404"); return produto(id); };
  f.obterVendedor = async () => { throw new Error("Bling /vendedores/3 respondeu 404"); };
  const d = await montar(f)(77, AGORA);
  assert.equal(d.pedido.vendedor, null);
  assert.equal(d.itens[0].localizacao, null);
  assert.deepEqual(d.itens[0].detalhes, []);
  assert.equal(d.itens[1].localizacao, "F101");
});
