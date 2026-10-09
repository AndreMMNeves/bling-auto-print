// Ponto de entrada na Vercel: todas as rotas caem aqui (ver vercel.json).
// A config vem das variáveis de ambiente do projeto na Vercel.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import { carregarConfigDoAmbiente } from "../servidor/src/config.ts";
import { montarServidor } from "../servidor/src/iniciar.ts";

// A Vercel corta em 60 s; a primeira ativação para em 40 s e continua na chamada seguinte.
const ORCAMENTO_MS = 40_000;

let pronto: Promise<FastifyInstance> | null = null;

function obterApp(): Promise<FastifyInstance> {
  pronto ??= montarServidor(carregarConfigDoAmbiente(process.env), { orcamentoMs: ORCAMENTO_MS })
    .then(async ({ app }) => {
      await app.ready();
      return app;
    })
    .catch((e) => {
      pronto = null;
      throw e;
    });
  return pronto;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const app = await obterApp();
    app.server.emit("request", req, res);
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(`Erro ao iniciar o sistema: ${e instanceof Error ? e.message : String(e)}`);
  }
}
