import type { DadosFolha, Via } from "../../../compartilhado/tipos.ts";
import type { ImpressaoRow, Repositorio } from "../banco/repositorio.ts";
import type { MontarFolha } from "../bling/montar-folha.ts";

export const MAX_TENTATIVAS = 4; // 1 tentativa + 3 novas
export const LIMITE_TRAVADA_MS = 5 * 60_000;

export type TrabalhoImpressao = { impressaoId: number; dados: DadosFolha; via: Via };

export async function viaDaImpressao(repo: Repositorio, imp: ImpressaoRow): Promise<Via> {
  return { numero: imp.via, motivo: imp.motivo, usuario: await repo.nomeUsuario(imp.usuario_id), em: imp.criado_em };
}

export async function entregarProximo(repo: Repositorio, impressoraId: number, agora: Date): Promise<TrabalhoImpressao | null> {
  const imp = await repo.pegarProximaDaFila(impressoraId, agora);
  if (!imp) return null;
  return { impressaoId: imp.id, dados: JSON.parse(imp.dados_json) as DadosFolha, via: await viaDaImpressao(repo, imp) };
}

export async function registrarResultado(
  repo: Repositorio,
  impressaoId: number,
  r: { ok: true; salvo?: boolean } | { ok: false; erro: string },
  agora: Date,
): Promise<void> {
  const imp = await repo.buscarImpressao(impressaoId);
  if (!imp) throw new Error(`Impressão ${impressaoId} não existe`);

  if (r.ok) {
    // Vale mesmo se ela já tinha sido marcada como travada/erro: a folha saiu.
    await repo.registrarImpressa(imp.id, agora, r.salvo ? "salvo" : "impresso");
    return;
  }

  const tentativas = imp.tentativas + 1;
  if (tentativas < MAX_TENTATIVAS) {
    await repo.marcarFalha(imp.id, r.erro, "fila");
    return;
  }
  await repo.marcarFalha(imp.id, r.erro, "erro");
  const pedido = (await repo.buscarPedidoPorId(imp.pedido_id))!;
  await repo.criarAlerta({
    tipo: "falha_impressao", pedidoId: pedido.id, agora,
    mensagem: `Pedido ${pedido.numero}: a impressão falhou ${tentativas} vezes (${r.erro}). Verifique a impressora e clique em "Imprimir pendentes".`,
  });
}

export async function recuperarTravadas(repo: Repositorio, agora: Date): Promise<number> {
  const travadas = await repo.listarTravadas(new Date(agora.getTime() - LIMITE_TRAVADA_MS));
  for (const imp of travadas) {
    await repo.marcarFalha(imp.id, "Sem resposta do agente durante a impressão", "erro");
    const pedido = (await repo.buscarPedidoPorId(imp.pedido_id))!;
    await repo.criarAlerta({
      tipo: "falha_impressao", pedidoId: pedido.id, agora,
      mensagem: `Pedido ${pedido.numero}: o agente parou de responder durante a impressão. Confira se a folha saiu antes de clicar em "Imprimir pendentes".`,
    });
  }
  return travadas.length;
}

export function imprimirPendentes(repo: Repositorio, impressoraId: number): Promise<number> {
  return repo.reenfileirarErros(impressoraId);
}

export async function reimprimir(
  repo: Repositorio,
  montarFolha: MontarFolha,
  p: { pedidoId: number; impressoraId: number; motivo: string; usuarioId: number; agora: Date },
): Promise<number> {
  const pedido = await repo.buscarPedidoPorId(p.pedidoId);
  if (!pedido) throw new Error(`Pedido ${p.pedidoId} não existe`);
  const dados = await montarFolha(pedido.id_bling, new Date(pedido.detectado_em));
  return repo.criarProximaVia({
    pedidoId: pedido.id, impressoraId: p.impressoraId, dados, motivo: p.motivo, usuarioId: p.usuarioId, agora: p.agora,
  });
}
