import { test } from "node:test";
import assert from "node:assert/strict";
import { executarCiclo, cicloMonitorado, type DepsMonitor } from "../src/monitor/monitor.ts";
import { ErroBlingDesconectado, type ResumoPedido } from "../src/bling/cliente.ts";
import { AGORA, bancoDeTeste, dadosFolhaExemplo, todas } from "./ajudantes.ts";

const ATENDIDO = 9, CANCELADO = 12, ABERTO = 6;
const resumo = (numero: string, situacaoId: number): ResumoPedido => ({ id: Number(numero) + 1000, numero, numeroLoja: null, situacaoId });

const VENDEDOR = 1; // consultor configurado nos testes

async function cenario() {
  const base = await bancoDeTeste();
  // Uma expedição com o consultor VENDEDOR: os pedidos dele vão para a fila dela.
  const expedicao = await base.repo.criarUsuario({ nome: "Expedição ES", email: "es@x", senhaHash: "h", papel: "expedicao" });
  const fila = await base.repo.garantirFilaDoUsuario(expedicao, base.filialId);
  await base.repo.definirConsultor(VENDEDOR, "Larissa", expedicao);
  const vendedoresConsultados: Array<number | undefined> = [];
  let lista: ResumoPedido[] = [];
  let antigos: ResumoPedido[] = [];
  let agora = AGORA;
  const consultas: Array<{ desde: Date; ate: Date }> = [];
  const paginasPedidas: number[] = [];
  const deps: DepsMonitor = {
    repo: base.repo,
    bling: {
      listarPedidosAlterados: async (desde, ate, idVendedor) => {
        consultas.push({ desde, ate });
        vendedoresConsultados.push(idVendedor);
        return idVendedor === VENDEDOR ? lista : [];
      },
      paginaPorSituacao: async (situacaoId, pagina) => {
        paginasPedidas.push(pagina);
        return [...antigos, ...lista].filter((p) => p.situacaoId === situacaoId).slice((pagina - 1) * 100, pagina * 100);
      },
    },
    montarFolha: async (idBling) => dadosFolhaExemplo(1, String(idBling - 1000)),
    filialId: base.filialId,
    situacaoAtendido: ATENDIDO, situacaoCancelado: CANCELADO, margemMinutos: 5,
    agora: () => agora,
  };
  return {
    ...base, deps, consultas, paginasPedidas, fila, vendedoresConsultados,
    definirLista: (l: ResumoPedido[]) => { lista = l; },
    definirAntigos: (l: ResumoPedido[]) => { antigos = l; },
    avancar: (ms: number) => { agora = new Date(agora.getTime() + ms); },
    impressoes: () => todas<{ id: number; via: number; dados_json: string }>(base.repo, "SELECT * FROM impressoes ORDER BY id"),
    alertas: () => todas<{ tipo: string; mensagem: string }>(base.repo, "SELECT tipo, mensagem FROM alertas ORDER BY id"),
  };
}

test("primeira ativação registra todos os Atendido, de qualquer data, sem imprimir", async () => {
  const c = await cenario();
  c.definirAntigos([resumo("5", ATENDIDO)]); // atendido há meses, fora de qualquer janela de alteração
  c.definirLista([resumo("1", ATENDIDO), resumo("2", ABERTO)]);
  const r = await executarCiclo(c.deps);
  assert.deepEqual(r, { tipo: "baseline", registrados: 2, concluida: true });
  assert.equal((await c.impressoes()).length, 0);
  assert.equal((await c.repo.buscarPedido(c.filialId, "1"))?.origem, "baseline");
  assert.equal((await c.repo.buscarPedido(c.filialId, "5"))?.origem, "baseline");
  assert.equal(await c.repo.buscarPedido(c.filialId, "2"), null);

  // Depois, o pedido antigo ganha uma alteração (nota fiscal, rastreio): não imprime.
  c.definirLista([resumo("5", ATENDIDO)]);
  c.avancar(30_000);
  await executarCiclo(c.deps);
  assert.equal((await c.impressoes()).length, 0);
});

test("pedido novo Atendido vira 1ª via na fila, em ordem de número", async () => {
  const c = await cenario();
  await executarCiclo(c.deps);
  c.avancar(30_000);
  c.definirLista([resumo("11", ATENDIDO), resumo("10", ATENDIDO), resumo("12", ABERTO)]);
  const r = await executarCiclo(c.deps);
  assert.deepEqual(r, { tipo: "ciclo", novos: 2, alertas: 0 });
  const imps = (await c.impressoes());
  assert.deepEqual(imps.map((i) => JSON.parse(i.dados_json).pedido.numero), ["10", "11"]);
  assert.ok(imps.every((i) => i.via === 1));
});

test("consulta usa o cursor menos a margem", async () => {
  const c = await cenario();
  await executarCiclo(c.deps);
  c.avancar(30_000);
  await executarCiclo(c.deps);
  assert.equal(c.consultas[0].desde.getTime(), AGORA.getTime() - 5 * 60_000); // a ativação não consulta por data
});

test("pedido que aparece de novo como Atendido sem mudar não faz nada", async () => {
  const c = await cenario();
  await executarCiclo(c.deps);
  c.definirLista([resumo("10", ATENDIDO)]);
  await executarCiclo(c.deps);
  await executarCiclo(c.deps);
  assert.equal((await c.impressoes()).length, 1);
  assert.equal((await c.alertas()).length, 0);
});

test("pedido que sai e volta para Atendido gera alerta e não imprime", async () => {
  const c = await cenario();
  await executarCiclo(c.deps);
  c.definirLista([resumo("10", ATENDIDO)]);
  await executarCiclo(c.deps);
  c.definirLista([resumo("10", ABERTO)]);
  await executarCiclo(c.deps);
  c.definirLista([resumo("10", ATENDIDO)]);
  await executarCiclo(c.deps);
  assert.equal((await c.impressoes()).length, 1);
  assert.deepEqual((await c.alertas()).map((a) => a.tipo), ["repetido"]);
  assert.match((await c.alertas())[0].mensagem, /Pedido 10 voltou para Atendido\. Já foi impresso em 08\/10\/2026 14:32/);
});

test("pedido cancelado depois de impresso gera alerta", async () => {
  const c = await cenario();
  await executarCiclo(c.deps);
  c.definirLista([resumo("10", ATENDIDO)]);
  await executarCiclo(c.deps);
  c.definirLista([resumo("10", CANCELADO)]);
  await executarCiclo(c.deps);
  assert.deepEqual((await c.alertas()).map((a) => a.tipo), ["cancelado"]);
  assert.match((await c.alertas())[0].mensagem, /CANCELADO/);
});

test("pedido desconhecido que não está Atendido é ignorado", async () => {
  const c = await cenario();
  await executarCiclo(c.deps);
  c.definirLista([resumo("10", CANCELADO)]);
  await executarCiclo(c.deps);
  assert.equal(await c.repo.buscarPedido(c.filialId, "10"), null);
});

test("retomada depois de mais de 5 min parado gera aviso com a quantidade", async () => {
  const c = await cenario();
  await executarCiclo(c.deps);
  c.avancar(13 * 3600_000);
  c.definirLista([resumo("10", ATENDIDO), resumo("11", ATENDIDO)]);
  await executarCiclo(c.deps);
  assert.deepEqual((await c.alertas()).map((a) => a.tipo), ["retomada"]);
  assert.match((await c.alertas())[0].mensagem, /2 pedido\(s\) impresso\(s\) na retomada/);
});

test("dois ciclos ao mesmo tempo não duplicam a 1ª via", async () => {
  const c = await cenario();
  await executarCiclo(c.deps);
  c.definirLista([resumo("10", ATENDIDO)]);
  await Promise.all([await executarCiclo(c.deps), await executarCiclo(c.deps)]);
  assert.equal((await c.impressoes()).length, 1);
});

test("pedido que falha ao montar não trava os outros e é tentado de novo depois", async () => {
  const c = await cenario();
  await executarCiclo(c.deps);
  c.definirLista([resumo("10", ATENDIDO), resumo("11", ATENDIDO)]);
  const montarOk = c.deps.montarFolha;
  c.deps.montarFolha = async (idBling, quando) => {
    if (idBling === 1010) throw new Error("Bling /produtos/5 respondeu 404");
    return montarOk(idBling, quando);
  };
  c.avancar(30_000);
  await executarCiclo(c.deps);
  assert.deepEqual((await c.impressoes()).map((i) => JSON.parse(i.dados_json).pedido.numero), ["11"]);
  assert.equal(await c.repo.obterEstado(`monitor:cursor:${c.filialId}`), new Date(AGORA.getTime() + 30_000).toISOString());
  assert.deepEqual((await c.alertas()).map((a) => a.tipo), ["falha_impressao"]);
  assert.match((await c.alertas())[0].mensagem, /Pedido 10.*404/);

  // Sai da janela do Bling, mas continua pendente; falha de novo sem alerta repetido.
  c.definirLista([]);
  c.avancar(30_000);
  await executarCiclo(c.deps);
  assert.equal((await c.alertas()).length, 1);

  // Bling volta a responder: o pendente é impresso.
  c.deps.montarFolha = montarOk;
  c.avancar(30_000);
  await executarCiclo(c.deps);
  assert.deepEqual((await c.impressoes()).map((i) => JSON.parse(i.dados_json).pedido.numero).sort(), ["10", "11"]);
  assert.equal(await c.repo.obterEstado(`monitor:pendentes:${c.filialId}`), "[]");
});

test("Bling desconectado ao montar a folha derruba o ciclo sem avançar o cursor", async () => {
  const c = await cenario();
  await executarCiclo(c.deps);
  const cursorAntes = await c.repo.obterEstado(`monitor:cursor:${c.filialId}`);
  c.definirLista([resumo("10", ATENDIDO)]);
  c.deps.montarFolha = async () => { throw new ErroBlingDesconectado("revogado"); };
  c.avancar(30_000);
  await assert.rejects(executarCiclo(c.deps), ErroBlingDesconectado);
  assert.equal(await c.repo.obterEstado(`monitor:cursor:${c.filialId}`), cursorAntes);
});

test("cicloMonitorado registra erro do Bling e cria alerta de desconexão uma vez só", async () => {
  const c = await cenario();
  const log = { info: () => {}, error: () => {} };
  const falha = async (): Promise<ResumoPedido[]> => { throw new ErroBlingDesconectado("revogado"); };
  c.deps.bling = { listarPedidosAlterados: falha, paginaPorSituacao: falha };
  await cicloMonitorado(c.deps, log);
  await cicloMonitorado(c.deps, log);
  assert.equal(await c.repo.obterEstado("bling:erro_desde"), AGORA.toISOString());
  assert.equal(await c.repo.obterEstado("bling:erro_msg"), "revogado");
  assert.deepEqual((await c.alertas()).map((a) => a.tipo), ["bling_desconectado"]);
  c.deps.bling = { listarPedidosAlterados: async () => [], paginaPorSituacao: async () => [] };
  await cicloMonitorado(c.deps, log);
  assert.equal(await c.repo.obterEstado("bling:erro_desde"), null);
  assert.equal(await c.repo.obterEstado("bling:ultima_consulta"), AGORA.toISOString());
});

test("primeira ativação grande é feita em partes e continua de onde parou", async () => {
  const c = await cenario();
  c.definirAntigos(Array.from({ length: 250 }, (_, i) => resumo(String(5000 + i), ATENDIDO)));
  let tempo = 0;
  c.deps.relogio = () => tempo;
  c.deps.orcamentoMs = 1;
  const pagina = c.deps.bling.paginaPorSituacao;
  c.deps.bling.paginaPorSituacao = async (s, p) => { tempo += 10; return pagina(s, p); };

  const r1 = await executarCiclo(c.deps);
  assert.deepEqual(r1, { tipo: "baseline", registrados: 100, concluida: false });
  assert.equal(await c.repo.obterEstado(`monitor:cursor:${c.filialId}`), null);

  const r2 = await executarCiclo(c.deps);
  assert.deepEqual(r2, { tipo: "baseline", registrados: 100, concluida: false });
  const r3 = await executarCiclo(c.deps);
  assert.deepEqual(r3, { tipo: "baseline", registrados: 50, concluida: true });
  assert.deepEqual(c.paginasPedidas, [1, 2, 3]);
  assert.equal(await c.repo.obterEstado(`monitor:cursor:${c.filialId}`), AGORA.toISOString());
  assert.equal((await c.impressoes()).length, 0);
});

test("cada consultor vai para a fila da sua expedição; os demais não são nem consultados", async () => {
  const c = await cenario();
  const pr = await c.repo.criarUsuario({ nome: "Expedição PR", email: "pr@x", senhaHash: "h", papel: "expedicao" });
  const filaPr = await c.repo.garantirFilaDoUsuario(pr, c.filialId);
  await c.repo.definirConsultor(2, "Luana Cardoso", pr);
  await c.repo.definirConsultor(3, "Sem expedição", null);
  c.deps.bling.listarPedidosAlterados = async (_d, _a, idVendedor) => {
    c.vendedoresConsultados.push(idVendedor);
    if (idVendedor === VENDEDOR) return [resumo("10", ATENDIDO)];
    if (idVendedor === 2) return [resumo("20", ATENDIDO)];
    return [resumo("30", ATENDIDO)];
  };
  await executarCiclo(c.deps); // primeira ativação
  c.vendedoresConsultados.length = 0;
  c.avancar(30_000);
  await executarCiclo(c.deps);
  assert.deepEqual([...c.vendedoresConsultados].sort(), [VENDEDOR, 2]);
  const imps = await todas<{ impressora_id: number; dados_json: string }>(c.repo, "SELECT impressora_id, dados_json FROM impressoes ORDER BY id");
  assert.deepEqual(imps.map((i) => [JSON.parse(i.dados_json).pedido.numero, i.impressora_id]), [["10", c.fila.impressoraId], ["20", filaPr.impressoraId]]);
});

test("sem nenhum consultor configurado, nada é impresso", async () => {
  const c = await cenario();
  await c.repo.definirConsultor(VENDEDOR, "Larissa", null);
  await executarCiclo(c.deps);
  c.definirLista([resumo("10", ATENDIDO)]);
  c.avancar(30_000);
  const r = await executarCiclo(c.deps);
  assert.deepEqual(r, { tipo: "ciclo", novos: 0, alertas: 0 });
  assert.equal((await c.impressoes()).length, 0);
});
