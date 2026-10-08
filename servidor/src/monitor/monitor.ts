import { transacao } from "../banco/banco.ts";
import type { PedidoRow, Repositorio } from "../banco/repositorio.ts";
import { ErroBlingDesconectado, type ResumoPedido } from "../bling/cliente.ts";
import type { MontarFolha } from "../bling/montar-folha.ts";
import { formatarDataHora } from "../tempo.ts";

export type DepsMonitor = {
  repo: Repositorio;
  bling: { listarPedidosAlterados(desde: Date, ate: Date): Promise<ResumoPedido[]> };
  montarFolha: MontarFolha;
  filialId: number;
  impressoraId: number;
  situacaoAtendido: number;
  situacaoCancelado: number;
  margemMinutos: number;
  agora: () => Date;
};

export type ResultadoCiclo =
  | { tipo: "baseline"; registrados: number }
  | { tipo: "ciclo"; novos: number; alertas: number };

const DIAS_BASELINE = 30;
const LIMIAR_RETOMADA_MS = 5 * 60_000;

export async function executarCiclo(d: DepsMonitor): Promise<ResultadoCiclo> {
  const agora = d.agora();
  const chave = `monitor:cursor:${d.filialId}`;
  const cursor = d.repo.obterEstado(chave);

  if (cursor === null) {
    // Primeira ativação: o que já está Atendido é registrado, nunca impresso.
    const lista = await d.bling.listarPedidosAlterados(new Date(agora.getTime() - DIAS_BASELINE * 86_400_000), agora);
    let registrados = 0;
    for (const r of lista) {
      if (r.situacaoId !== d.situacaoAtendido || d.repo.buscarPedido(d.filialId, r.numero)) continue;
      d.repo.inserirPedido({ filialId: d.filialId, numero: r.numero, idBling: r.id, situacao: r.situacaoId, origem: "baseline", agora });
      registrados++;
    }
    d.repo.definirEstado(chave, agora.toISOString());
    return { tipo: "baseline", registrados };
  }

  const ultimo = new Date(cursor);
  const lista = await d.bling.listarPedidosAlterados(new Date(ultimo.getTime() - d.margemMinutos * 60_000), agora);
  lista.sort((a, b) => Number(a.numero) - Number(b.numero) || a.numero.localeCompare(b.numero));

  let novos = 0;
  let alertas = 0;
  for (const r of lista) {
    const existente = d.repo.buscarPedido(d.filialId, r.numero);

    if (!existente) {
      if (r.situacaoId !== d.situacaoAtendido) continue;
      const dados = await d.montarFolha(r.id, agora);
      // Confere de novo dentro da transação: outro ciclo pode ter criado enquanto esperávamos o Bling.
      const criado = transacao(d.repo.db, () => {
        if (d.repo.buscarPedido(d.filialId, r.numero)) return false;
        const pedidoId = d.repo.inserirPedido({
          filialId: d.filialId, numero: r.numero, idBling: r.id, situacao: r.situacaoId, origem: "monitor", agora,
        });
        d.repo.criarImpressao({ pedidoId, impressoraId: d.impressoraId, via: 1, dados, motivo: null, usuarioId: null, agora });
        return true;
      });
      if (criado) novos++;
      continue;
    }

    if (existente.situacao === r.situacaoId) continue;
    d.repo.atualizarSituacao(existente.id, r.situacaoId);

    if (r.situacaoId === d.situacaoAtendido) {
      d.repo.criarAlerta({ tipo: "repetido", pedidoId: existente.id, mensagem: mensagemRepetido(d.repo, existente), agora });
      alertas++;
    } else if (r.situacaoId === d.situacaoCancelado && d.repo.ultimaImpressao(existente.id)) {
      d.repo.criarAlerta({
        tipo: "cancelado", pedidoId: existente.id, agora,
        mensagem: `Pedido ${existente.numero} foi CANCELADO, mas já foi impresso: retire da separação.`,
      });
      alertas++;
    }
  }

  if (novos > 0 && agora.getTime() - ultimo.getTime() > LIMIAR_RETOMADA_MS) {
    d.repo.criarAlerta({
      tipo: "retomada", pedidoId: null, agora,
      mensagem: `O sistema ficou sem consultar o Bling de ${formatarDataHora(cursor)} a ${formatarDataHora(agora.toISOString())}. ` +
        `${novos} pedido(s) impresso(s) na retomada.`,
    });
    alertas++;
  }

  d.repo.definirEstado(chave, agora.toISOString());
  return { tipo: "ciclo", novos, alertas };
}

function mensagemRepetido(repo: Repositorio, p: PedidoRow): string {
  const ult = repo.ultimaImpressao(p.id);
  return ult
    ? `Pedido ${p.numero} voltou para Atendido. Já foi impresso em ${formatarDataHora(ult.criado_em)}. Reimprimir?`
    : `Pedido ${p.numero} voltou para Atendido. Ele é anterior ao sistema e não foi impresso por ele.`;
}

export async function cicloMonitorado(d: DepsMonitor, log: Pick<Console, "info" | "error"> = console): Promise<void> {
  try {
    const r = await executarCiclo(d);
    d.repo.definirEstado("bling:erro_desde", null);
    d.repo.definirEstado("bling:erro_msg", null);
    d.repo.definirEstado("bling:ultima_consulta", d.agora().toISOString());
    if (r.tipo === "baseline") log.info(`[monitor] primeira ativação: ${r.registrados} pedido(s) já atendido(s) registrado(s) sem imprimir`);
    else if (r.novos || r.alertas) log.info(`[monitor] ${r.novos} pedido(s) novo(s), ${r.alertas} alerta(s)`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!d.repo.obterEstado("bling:erro_desde")) d.repo.definirEstado("bling:erro_desde", d.agora().toISOString());
    d.repo.definirEstado("bling:erro_msg", msg);
    if (e instanceof ErroBlingDesconectado && !d.repo.alertaPendenteDoTipo("bling_desconectado")) {
      d.repo.criarAlerta({
        tipo: "bling_desconectado", pedidoId: null, agora: d.agora(),
        mensagem: "O Bling desconectou o sistema. Um supervisor precisa clicar em \"Reconectar ao Bling\" na Configuração.",
      });
    }
    log.error(`[monitor] erro: ${msg}`);
  }
}
