import { test } from "node:test";
import assert from "node:assert/strict";
import { criarMontadorFolha, type FonteBling } from "../src/bling/montar-folha.ts";
import type { PedidoBling } from "../src/bling/cliente.ts";
import { AGORA } from "./ajudantes.ts";

const pedido = (extra: Partial<PedidoBling> = {}): PedidoBling => ({
  id: 77, numero: "12345", numeroLoja: "MP-999", data: "2026-10-08",
  contato: { nome: "Clínica X", numeroDocumento: "123" }, vendedorId: 3,
  itens: [
    { codigo: "ZZ-9", descricao: "Cânula", quantidade: 10, produtoId: 2 },
    { codigo: "AH-1", descricao: "Ácido", quantidade: 3, produtoId: 1 },
    { codigo: null, descricao: "Brinde", quantidade: 1, produtoId: null },
  ],
  etiqueta: { endereco: "Rua A", numero: "10", complemento: "Sala 2", bairro: "Centro", municipio: "Vitória", uf: "ES", cep: "29000-000" },
  transporte: "SEDEX", observacoes: "Frágil", ...extra,
});

function fonte(p: PedidoBling) {
  const chamadas = { vendedor: 0, produto: 0 };
  const f: FonteBling = {
    obterPedido: async () => p,
    obterProduto: async (id) => { chamadas.produto++; return { gtin: id === 1 ? "7891111111111" : null, codigo: null }; },
    obterVendedor: async () => { chamadas.vendedor++; return { nome: "Fulano" }; },
  };
  return { f, chamadas };
}

test("monta a folha com cliente, entrega, vendedor e EAN", async () => {
  const { f } = fonte(pedido());
  const d = await criarMontadorFolha(f, { filialNome: "Espírito Santo", campoCodigoBarras: "numero" })(77, AGORA);
  assert.equal(d.filial, "Espírito Santo");
  assert.equal(d.pedido.numero, "12345");
  assert.equal(d.pedido.codigoBarras, "12345");
  assert.equal(d.pedido.vendedor, "Fulano");
  assert.equal(d.pedido.atendidoEm, AGORA.toISOString());
  assert.deepEqual(d.entrega, { endereco: "Rua A, 10 — Sala 2 — Centro", cidadeUf: "Vitória/ES", cep: "29000-000" });
  assert.equal(d.transporte, "SEDEX");
});

test("itens ordenados por SKU, sem SKU por último, EAN do cadastro do produto", async () => {
  const { f } = fonte(pedido());
  const d = await criarMontadorFolha(f, { filialNome: "ES", campoCodigoBarras: "numero" })(77, AGORA);
  assert.deepEqual(d.itens.map((i) => i.sku), ["AH-1", "ZZ-9", null]);
  assert.equal(d.itens[0].ean, "7891111111111");
  assert.equal(d.itens[1].ean, null);
  assert.equal(d.itens[2].ean, null);
});

test("campo do código de barras configurável", async () => {
  const { f } = fonte(pedido());
  const porLoja = await criarMontadorFolha(f, { filialNome: "ES", campoCodigoBarras: "numeroLoja" })(77, AGORA);
  assert.equal(porLoja.pedido.codigoBarras, "MP-999");
  const porId = await criarMontadorFolha(f, { filialNome: "ES", campoCodigoBarras: "id" })(77, AGORA);
  assert.equal(porId.pedido.codigoBarras, "77");
  const { f: semLoja } = fonte(pedido({ numeroLoja: null }));
  assert.equal((await criarMontadorFolha(semLoja, { filialNome: "ES", campoCodigoBarras: "numeroLoja" })(77, AGORA)).pedido.codigoBarras, "12345");
});

test("vendedor fica em cache entre pedidos; sem etiqueta vira campos nulos", async () => {
  const { f, chamadas } = fonte(pedido({ etiqueta: null }));
  const montar = criarMontadorFolha(f, { filialNome: "ES", campoCodigoBarras: "numero" });
  const d = await montar(77, AGORA);
  await montar(77, AGORA);
  assert.equal(chamadas.vendedor, 1);
  assert.deepEqual(d.entrega, { endereco: null, cidadeUf: null, cep: null });
});
