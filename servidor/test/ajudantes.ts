import { abrirBanco } from "../src/banco/banco.ts";
import { Repositorio } from "../src/banco/repositorio.ts";
import type { DadosFolha } from "../../compartilhado/tipos.ts";

export const AGORA = new Date("2026-10-08T17:32:00.000Z"); // 14:32 em São Paulo

export function bancoDeTeste() {
  const repo = new Repositorio(abrirBanco(":memory:"));
  const filialId = repo.garantirFilial("ES", "Espírito Santo");
  const { agenteId, impressoraId } = repo.garantirAgente(filialId, {
    nome: "expedicao-es", token: "token-teste", impressora: "HP A4",
  });
  return { repo, filialId, agenteId, impressoraId };
}

export function dadosFolhaExemplo(qtdItens = 2, numero = "12345"): DadosFolha {
  return {
    filial: "Espírito Santo",
    pedido: {
      numero, numeroLoja: null, idBling: 9000 + Number(numero), data: "2026-10-08",
      atendidoEm: AGORA.toISOString(), vendedor: "Fulano", observacoes: null, codigoBarras: numero,
    },
    cliente: { nome: "Clínica X", documento: "12.345.678/0001-90" },
    entrega: { endereco: "Rua A, 10", cidadeUf: "Vitória/ES", cep: "29000-000" },
    transporte: "SEDEX",
    itens: Array.from({ length: qtdItens }, (_, i) => ({
      quantidade: i + 1,
      sku: `SKU-${String(i + 1).padStart(3, "0")}`,
      descricao: `Produto ${i + 1}`,
      ean: `78900000${String(i + 1).padStart(5, "0")}`,
    })),
  };
}
