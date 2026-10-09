import type { LinhaRelatorio, StatusImpressao } from "./banco/repositorio.ts";
import { formatarDataHora } from "../../compartilhado/tempo.ts";

export const ROTULO_STATUS: Record<StatusImpressao, string> = {
  fila: "Na fila", imprimindo: "Imprimindo", impresso: "Impresso", salvo: "Salvo (impressão desligada)", erro: "Erro",
};

export const COLUNAS_RELATORIO = ["Horário", "Pedido", "Cliente", "Vendedor", "Itens", "Via", "Status", "Impressora", "Reimpresso por", "Motivo"];

export function linhaParaColunas(l: LinhaRelatorio): string[] {
  return [
    formatarDataHora(l.impressoEm ?? l.criadoEm), l.numero, l.cliente ?? "", l.vendedor ?? "", String(l.itens),
    `${l.via}ª`, ROTULO_STATUS[l.status], l.impressora, l.usuario ?? "", l.motivo ?? "",
  ];
}

const celula = (s: string) => (/[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

// Excel em português abre direto: BOM UTF-8 + ponto e vírgula.
export function gerarCsv(linhas: LinhaRelatorio[]): string {
  const todas = [COLUNAS_RELATORIO, ...linhas.map(linhaParaColunas)];
  return "﻿" + todas.map((l) => l.map(celula).join(";")).join("\r\n") + "\r\n";
}
