import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import type { Repositorio } from "./banco/repositorio.ts";
import type { MontarFolha } from "./bling/montar-folha.ts";
import type { Config } from "./config.ts";
import { registrarApiAgente } from "./web/api-agente.ts";
import { SELO_ONIX_JPG_BASE64 } from "../../compartilhado/marca.ts";
import { registrarAuth } from "./web/auth.ts";
import { registrarConfig } from "./web/config.ts";
import { registrarConsultores } from "./web/consultores.ts";
import { registrarAlertas } from "./web/alertas.ts";
import { registrarPainel } from "./web/painel.ts";
import { registrarPedidos } from "./web/pedidos.ts";
import { registrarRelatorio } from "./web/relatorio.ts";
import { registrarUsuarios } from "./web/usuarios.ts";

export type DepsApp = {
  repo: Repositorio;
  config: Config;
  filialId: number;
  impressoraId: number;
  agora: () => Date;
  montarFolha: MontarFolha;
  bling: {
    urlAutorizacao(state: string): string; trocarCodigo(code: string): Promise<void>; estaConectado(): Promise<boolean>;
    listarVendedores(): Promise<Array<{ id: number; nome: string }>>;
  };
  tarefasPeriodicas: () => Promise<unknown>;
};

export async function criarApp(d: DepsApp): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(formbody);
  await app.register(cookie, { secret: d.config.segredoSessao });
  registrarAuth(app, d); // primeiro: o hook de sessão precisa valer para todas as rotas
  const selo = Buffer.from(SELO_ONIX_JPG_BASE64, "base64");
  app.get("/marca/selo.jpg", async (_req, reply) =>
    reply.type("image/jpeg").header("Cache-Control", "public, max-age=31536000, immutable").send(selo));
  registrarApiAgente(app, d);
  registrarUsuarios(app, d);
  registrarRelatorio(app, d);
  registrarPainel(app, d);
  registrarAlertas(app, d);
  registrarPedidos(app, d);
  registrarConfig(app, d);
  registrarConsultores(app, d);
  return app;
}
