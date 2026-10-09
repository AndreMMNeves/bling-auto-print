import { join } from "node:path";
import { repetir } from "../../compartilhado/loop.ts";
import { GeradorPdf } from "../../compartilhado/folha/pdf.ts";
import { dispararCiclo, esvaziarFila } from "./agente.ts";
import { carregarConfigAgente, RAIZ_AGENTE } from "./config.ts";
import { ImpressoraPasta, ImpressoraWindows } from "./impressora.ts";

const c = carregarConfigAgente(process.argv[2] ?? join(RAIZ_AGENTE, "agente/config.json"));
const impressora = c.modo === "pasta" ? new ImpressoraPasta(c.pasta) : new ImpressoraWindows();
const gerador = new GeradorPdf(c.chromePath);
console.info(`[agente] iniciado: modo=${c.modo}${c.modo === "pasta" ? ` (${c.pasta})` : ""}, servidor=${c.servidorUrl}`);

const erro = (e: unknown) => console.error(`[agente] ${e instanceof Error ? e.message : String(e)}`);

// Pede ao servidor para consultar o Bling (na Vercel ninguém mais faz isso).
repetir(c.cicloSegundos * 1000, async () => {
  try {
    const r = (await dispararCiclo({ servidorUrl: c.servidorUrl, token: c.token })) as { executado: boolean; resultado?: unknown };
    if (r.executado) console.info(`[agente] ciclo: ${JSON.stringify(r.resultado)}`);
  } catch (e) {
    erro(e);
  }
});

// Busca e imprime o que estiver na fila.
repetir(c.intervaloSegundos * 1000, async () => {
  try {
    const n = await esvaziarFila({ servidorUrl: c.servidorUrl, token: c.token, impressora, gerarPdf: (d, v) => gerador.gerar(d, v) });
    if (n) console.info(`[agente] ${n} trabalho(s) processado(s)`);
  } catch (e) {
    erro(e);
  }
});
