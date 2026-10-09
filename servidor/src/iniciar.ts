import type { FastifyInstance } from "fastify";
import { criarApp } from "./app.ts";
import { abrirBanco } from "./banco/banco.ts";
import { Repositorio } from "./banco/repositorio.ts";
import { armazemNoBanco } from "./bling/armazem.ts";
import { ClienteBling } from "./bling/cliente.ts";
import { criarMontadorFolha } from "./bling/montar-folha.ts";
import type { Config } from "./config.ts";
import { criarEnviadorSheets } from "./planilha/planilha.ts";
import { criarTarefasPeriodicas } from "./tarefas.ts";

// Monta tudo a partir da config. Usado pelo PC local (main.ts) e pela Vercel (api/index.ts).
export async function montarServidor(config: Config, opts: { orcamentoMs?: number } = {}): Promise<{
  app: FastifyInstance; repo: Repositorio; tarefasPeriodicas: () => Promise<unknown>; bling: ClienteBling;
}> {
  const repo = new Repositorio(await abrirBanco(config.banco.url));
  const agora = () => new Date();
  const filialId = await repo.garantirFilial(config.filial.codigo, config.filial.nome);
  const registros = [];
  for (const a of config.agentes) registros.push(await repo.garantirAgente(filialId, a));
  const impressoraId = registros[0].impressoraId; // Etapa 1: uma impressora

  const bling = new ClienteBling({
    clientId: config.bling.clientId, clientSecret: config.bling.clientSecret,
    armazem: armazemNoBanco(repo, config.filial.codigo),
  });
  const montarFolha = criarMontadorFolha(bling, { filialNome: config.filial.nome, campoCodigoBarras: config.bling.campoCodigoBarras });
  const tarefasPeriodicas = criarTarefasPeriodicas({
    repo, bling, montarFolha, config, filialId, agora,
    enviarPlanilha: config.google ? criarEnviadorSheets(config.google) : null,
    orcamentoMs: opts.orcamentoMs,
  });
  const app = await criarApp({ repo, config, filialId, impressoraId, agora, montarFolha, bling, tarefasPeriodicas });
  return { app, repo, tarefasPeriodicas, bling };
}
