import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RAIZ_AGENTE = fileURLToPath(new URL("../../", import.meta.url));

export type ConfigAgente = {
  servidorUrl: string;
  token: string;
  modo: "imprimir" | "pasta";
  pasta: string;
  intervaloSegundos: number;
  // A cada quantos segundos pede ao servidor para consultar o Bling (necessário na Vercel).
  cicloSegundos: number;
  chromePath: string;
};

export function carregarConfigAgente(arquivo: string): ConfigAgente {
  const c = JSON.parse(readFileSync(arquivo, "utf8")) as ConfigAgente;
  if (!c.servidorUrl || !c.token) throw new Error("agente/config.json: servidorUrl e token são obrigatórios");
  if (c.modo !== "imprimir" && c.modo !== "pasta") throw new Error('agente/config.json: modo deve ser "imprimir" ou "pasta"');
  c.pasta = resolve(RAIZ_AGENTE, c.pasta || "dados/folhas");
  c.intervaloSegundos ||= 5;
  c.cicloSegundos ||= 30;
  c.chromePath ||= "C:/Program Files/Google/Chrome/Application/chrome.exe";
  return c;
}
