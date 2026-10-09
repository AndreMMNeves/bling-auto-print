// Servidor no PC local (sem Vercel). Na Vercel o ponto de entrada é api/index.ts.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { repetir } from "../../compartilhado/loop.ts";
import { carregarConfig, RAIZ } from "./config.ts";
import { montarServidor } from "./iniciar.ts";

const config = carregarConfig(process.argv[2] ?? join(RAIZ, "servidor/config.json"));
mkdirSync(join(RAIZ, "dados"), { recursive: true });
const { app, tarefasPeriodicas, bling } = await montarServidor(config);

await app.listen({ host: "0.0.0.0", port: config.porta });
console.info(`[servidor] página em ${config.urlPublica} (porta ${config.porta})`);
if (!(await bling.estaConectado())) console.info(`[servidor] Bling ainda não conectado: entre como supervisor em ${config.urlPublica}/config`);

// No PC o próprio servidor dispara as tarefas; o agente também pode disparar (o que chegar primeiro vale).
repetir(config.bling.intervaloSegundos * 1000, async () => { await tarefasPeriodicas(); });

const encerrar = async () => {
  await app.close();
  process.exit(0);
};
process.on("SIGINT", encerrar);
process.on("SIGTERM", encerrar);
