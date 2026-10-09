import { test } from "node:test";
import assert from "node:assert/strict";
import { gerarCsv } from "../src/relatorio.ts";
import { appDeTeste, dadosFolhaExemplo, entrar } from "./ajudantes.ts";

async function comDados() {
  const c = await appDeTeste();
  const criar = async (numero: string, quando: string, via = 1, vendedor = "Fulano", motivo: string | null = null, usuarioId: number | null = null) => {
    const p = (await c.repo.buscarPedido(c.filialId, numero)) ?? { id: await c.repo.inserirPedido({ filialId: c.filialId, numero, idBling: 1, situacao: 9, origem: "monitor", agora: new Date(quando) }) };
    const d = dadosFolhaExemplo(3, numero);
    d.pedido.vendedor = vendedor;
    const id = await c.repo.criarImpressao({ pedidoId: p.id, impressoraId: c.impressoraId, via, dados: d, motivo, usuarioId, agora: new Date(quando) });
    await c.repo.marcarImpressa(id, new Date(quando));
    return id;
  };
  await criar("10", "2026-10-08T13:00:00.000Z");
  await criar("11", "2026-10-09T02:50:00.000Z", 1, "Beltrano"); // 23:50 do dia 08 em SP
  await criar("10", "2026-10-08T15:00:00.000Z", 2, "Fulano", "Folha perdida", c.supervisorId);
  await criar("12", "2026-10-09T12:00:00.000Z");
  return c;
}

test("filtra pelo dia local (23:50 conta no próprio dia)", async () => {
  const c = await comDados();
  const linhas = await c.repo.relatorio({ de: "2026-10-08", ate: "2026-10-08" });
  assert.deepEqual(linhas.map((l) => l.numero).sort(), ["10", "10", "11"]);
  assert.deepEqual((await c.repo.relatorio({ de: "2026-10-09", ate: "2026-10-09" })).map((l) => l.numero), ["12"]);
});

test("filtros por vendedor, pedido e só reimpressões", async () => {
  const c = await comDados();
  const dia = { de: "2026-10-08", ate: "2026-10-09" };
  assert.deepEqual((await c.repo.relatorio({ ...dia, vendedor: "beltr" })).map((l) => l.numero), ["11"]);
  assert.equal((await c.repo.relatorio({ ...dia, pedido: "10" })).length, 2);
  const re = await c.repo.relatorio({ ...dia, soReimpressoes: true });
  assert.equal(re.length, 1);
  assert.equal(re[0].motivo, "Folha perdida");
  assert.equal(re[0].usuario, "Sup");
  assert.equal(re[0].itens, 3);
  assert.equal(re[0].cliente, "Clínica X");
});

test("CSV abre no Excel: BOM, ponto e vírgula, aspas escapadas", async () => {
  const csv = gerarCsv([{
    impressaoId: 1, criadoEm: "2026-10-08T17:32:00.000Z", impressoEm: "2026-10-08T17:32:00.000Z", numero: "10",
    cliente: 'Clínica "X"; Ltda', vendedor: null, itens: 2, via: 1, status: "impresso", impressora: "HP", usuario: null, motivo: null,
  }]);
  assert.ok(csv.startsWith("﻿"));
  const [cab, linha] = csv.slice(1).trim().split("\r\n");
  assert.ok(cab.startsWith("Horário;Pedido;Cliente"));
  assert.ok(linha.includes(`"Clínica ""X""; Ltda"`));
  assert.ok(linha.startsWith("08/10/2026 14:32;10;"));
});

test("página do relatório exige login e mostra as linhas do dia", async () => {
  const c = await comDados();
  assert.equal((await c.app.inject({ url: "/relatorio" })).statusCode, 302);
  const op = await entrar(c.app, "op@x.com", "senha-op");
  const r = await c.app.inject({ url: "/relatorio?de=2026-10-08&ate=2026-10-08", headers: { cookie: op } });
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /Folha perdida/);
  const csv = await c.app.inject({ url: "/relatorio.csv?de=2026-10-08&ate=2026-10-08", headers: { cookie: op } });
  assert.equal(csv.statusCode, 200);
  assert.match(String(csv.headers["content-disposition"]), /relatorio-2026-10-08-a-2026-10-08\.csv/);
});

test("relatório mostra 50 por página com navegação; o Excel leva tudo", async () => {
  const c = await appDeTeste();
  for (let i = 0; i < 120; i++) {
    const pedidoId = await c.repo.inserirPedido({ filialId: c.filialId, numero: String(1000 + i), idBling: i, situacao: 9, origem: "monitor", agora: new Date("2026-10-08T13:00:00.000Z") });
    await c.repo.criarImpressao({ pedidoId, impressoraId: c.impressoraId, via: 1, dados: dadosFolhaExemplo(1, String(1000 + i)), motivo: null, usuarioId: null, agora: new Date("2026-10-08T13:00:00.000Z") });
  }
  const op = await entrar(c.app, "op@x.com", "senha-op");
  const linhas = (html: string) => (html.match(/<td>HP A4<\/td>/g) ?? []).length;

  const p1 = await c.app.inject({ url: "/relatorio?de=2026-10-08&ate=2026-10-08", headers: { cookie: op } });
  assert.equal(linhas(p1.body), 50);
  assert.match(p1.body, /Página 1 de 3/);
  assert.match(p1.body, /120 impressões/);
  assert.match(p1.body, /href="\/relatorio\?[^"]*p=2"/);

  const p3 = await c.app.inject({ url: "/relatorio?de=2026-10-08&ate=2026-10-08&p=3", headers: { cookie: op } });
  assert.equal(linhas(p3.body), 20);
  assert.match(p3.body, /Página 3 de 3/);

  const fora = await c.app.inject({ url: "/relatorio?de=2026-10-08&ate=2026-10-08&p=99", headers: { cookie: op } });
  assert.match(fora.body, /Página 3 de 3/);

  const csv = await c.app.inject({ url: "/relatorio.csv?de=2026-10-08&ate=2026-10-08&p=2", headers: { cookie: op } });
  assert.equal(csv.body.trim().split("\r\n").length, 121);
});
