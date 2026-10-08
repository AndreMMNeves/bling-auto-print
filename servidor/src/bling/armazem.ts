import type { Repositorio } from "../banco/repositorio.ts";
import type { ArmazemTokens, Tokens } from "./cliente.ts";

export function armazemNoBanco(repo: Repositorio, filialCodigo: string): ArmazemTokens {
  const chave = `bling:tokens:${filialCodigo}`;
  return {
    ler: () => {
      const s = repo.obterEstado(chave);
      return s ? (JSON.parse(s) as Tokens) : null;
    },
    gravar: (t) => repo.definirEstado(chave, JSON.stringify(t)),
  };
}
