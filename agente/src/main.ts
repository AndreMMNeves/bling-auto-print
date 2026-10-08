import { join } from "node:path";
import { repetir } from "../../compartilhado/loop.ts";
import { esvaziarFila } from "./agente.ts";
import { carregarConfigAgente, RAIZ_AGENTE } from "./config.ts";
import { ImpressoraPasta, ImpressoraWindows } from "./impressora.ts";

const c = carregarConfigAgente(process.argv[2] ?? join(RAIZ_AGENTE, "agente/config.json"));
const impressora = c.modo === "pasta" ? new ImpressoraPasta(c.pasta) : new ImpressoraWindows();
console.info(`[agente] iniciado: modo=${c.modo}${c.modo === "pasta" ? ` (${c.pasta})` : ""}, servidor=${c.servidorUrl}`);

repetir(c.intervaloSegundos * 1000, async () => {
  try {
    const n = await esvaziarFila({ servidorUrl: c.servidorUrl, token: c.token, impressora });
    if (n) console.info(`[agente] ${n} trabalho(s) processado(s)`);
  } catch (e) {
    console.error(`[agente] ${e instanceof Error ? e.message : String(e)}`);
  }
});
