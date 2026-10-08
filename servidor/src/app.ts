import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import type { Repositorio } from "./banco/repositorio.ts";
import type { MontarFolha } from "./bling/montar-folha.ts";
import type { Config } from "./config.ts";
import { registrarApiAgente, type GerarPdf } from "./web/api-agente.ts";
import { registrarAuth } from "./web/auth.ts";
import { registrarAlertas } from "./web/alertas.ts";
import { registrarPainel } from "./web/painel.ts";
import { registrarRelatorio } from "./web/relatorio.ts";
import { registrarUsuarios } from "./web/usuarios.ts";

export type DepsApp = {
  repo: Repositorio;
  config: Config;
  filialId: number;
  impressoraId: number;
  agora: () => Date;
  gerarPdf: GerarPdf;
  montarFolha: MontarFolha;
  bling: { urlAutorizacao(state: string): string; trocarCodigo(code: string): Promise<void>; estaConectado(): boolean };
};

export async function criarApp(d: DepsApp): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(formbody);
  await app.register(cookie, { secret: d.config.segredoSessao });
  registrarAuth(app, d); // primeiro: o hook de sessão precisa valer para todas as rotas
  registrarApiAgente(app, d);
  registrarUsuarios(app, d);
  registrarRelatorio(app, d);
  registrarPainel(app, d);
  registrarAlertas(app, d);
  return app;
}
