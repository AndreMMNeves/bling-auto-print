import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { repetir } from "../../compartilhado/loop.ts";
import { criarApp } from "./app.ts";
import { abrirBanco } from "./banco/banco.ts";
import { Repositorio } from "./banco/repositorio.ts";
import { armazemNoBanco } from "./bling/armazem.ts";
import { ClienteBling } from "./bling/cliente.ts";
import { criarMontadorFolha } from "./bling/montar-folha.ts";
import { carregarConfig, RAIZ } from "./config.ts";
import { recuperarTravadas } from "./fila/fila.ts";
import { GeradorPdf } from "./folha/pdf.ts";
import { cicloMonitorado } from "./monitor/monitor.ts";
import { criarEnviadorSheets, processarFilaPlanilha } from "./planilha/planilha.ts";

const config = carregarConfig(process.argv[2] ?? join(RAIZ, "servidor/config.json"));
mkdirSync(dirname(config.arquivoBanco), { recursive: true });
const repo = new Repositorio(abrirBanco(config.arquivoBanco));
const agora = () => new Date();

const filialId = repo.garantirFilial(config.filial.codigo, config.filial.nome);
const registros = config.agentes.map((a) => repo.garantirAgente(filialId, a));
const impressoraId = registros[0].impressoraId; // Etapa 1: uma impressora

const bling = new ClienteBling({
  clientId: config.bling.clientId, clientSecret: config.bling.clientSecret,
  armazem: armazemNoBanco(repo, config.filial.codigo),
});
const montarFolha = criarMontadorFolha(bling, { filialNome: config.filial.nome, campoCodigoBarras: config.bling.campoCodigoBarras });
const gerador = new GeradorPdf(config.chromePath);

const app = await criarApp({
  repo, config, filialId, impressoraId, agora, montarFolha, bling,
  gerarPdf: (dados, via) => gerador.gerar(dados, via),
});
await app.listen({ host: "0.0.0.0", port: config.porta });
console.info(`[servidor] página em ${config.urlPublica} (porta ${config.porta})`);

const depsMonitor = {
  repo, bling, montarFolha, filialId, impressoraId, agora,
  situacaoAtendido: config.bling.situacaoAtendido, situacaoCancelado: config.bling.situacaoCancelado,
  margemMinutos: config.bling.margemMinutos,
};
repetir(config.bling.intervaloSegundos * 1000, async () => {
  if (!bling.estaConectado()) return; // espera alguém conectar em /config
  await cicloMonitorado(depsMonitor);
});

repetir(60_000, async () => {
  const n = recuperarTravadas(repo, agora());
  if (n) console.error(`[fila] ${n} impressão(ões) travada(s) marcada(s) como erro`);
});

if (config.google) {
  const enviar = criarEnviadorSheets(config.google);
  repetir(60_000, async () => { await processarFilaPlanilha(repo, enviar, agora()); });
}

if (!bling.estaConectado()) console.info(`[servidor] Bling ainda não conectado: entre como supervisor em ${config.urlPublica}/config`);

const encerrar = async () => {
  await app.close();
  await gerador.fechar();
  process.exit(0);
};
process.on("SIGINT", encerrar);
process.on("SIGTERM", encerrar);
