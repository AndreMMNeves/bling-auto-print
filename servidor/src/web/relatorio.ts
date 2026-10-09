import type { FastifyInstance } from "fastify";
import type { FiltroRelatorio, Repositorio } from "../banco/repositorio.ts";
import { escaparHtml } from "../../../compartilhado/html-util.ts";
import { COLUNAS_RELATORIO, gerarCsv, linhaParaColunas } from "../relatorio.ts";
import { diaLocal } from "../../../compartilhado/tempo.ts";
import { escopoFila, exigirLogin } from "./auth.ts";
import { pagina } from "./layout.ts";

type Query = { de?: string; ate?: string; vendedor?: string; pedido?: string; so?: string; p?: string };
const POR_PAGINA = 50;
const DIA = /^\d{4}-\d{2}-\d{2}$/;

function lerFiltro(q: Query, hoje: string): FiltroRelatorio {
  return {
    de: q.de && DIA.test(q.de) ? q.de : hoje,
    ate: q.ate && DIA.test(q.ate) ? q.ate : hoje,
    vendedor: q.vendedor?.trim() || undefined,
    pedido: q.pedido?.trim() || undefined,
    soReimpressoes: q.so === "1",
  };
}

export function registrarRelatorio(app: FastifyInstance, d: { repo: Repositorio; agora: () => Date }): void {
  app.get<{ Querystring: Query }>("/relatorio", { preHandler: exigirLogin }, async (req, reply) => {
    const f = { ...lerFiltro(req.query, diaLocal(d.agora())), impressoraId: escopoFila(req.usuario) };
    const todas = await d.repo.relatorio(f);
    const qs = new URLSearchParams({ de: f.de, ate: f.ate, vendedor: f.vendedor ?? "", pedido: f.pedido ?? "", so: f.soReimpressoes ? "1" : "" });
    const totalPaginas = Math.max(1, Math.ceil(todas.length / POR_PAGINA));
    const atual = Math.min(Math.max(1, Math.floor(Number(req.query.p)) || 1), totalPaginas);
    const linhas = todas.slice((atual - 1) * POR_PAGINA, atual * POR_PAGINA);
    const link = (n: number) => `/relatorio?${qs}&p=${n}`;
    const navegacao = totalPaginas > 1 ? `<nav class="paginas">
  ${atual > 1 ? `<a class="botao secundario" href="${link(atual - 1)}">Anterior</a>` : ""}
  <span>Página ${atual} de ${totalPaginas}</span>
  ${atual < totalPaginas ? `<a class="botao secundario" href="${link(atual + 1)}">Próxima</a>` : ""}
</nav>` : "";
    const corpo = linhas.map((l) => `<tr>${linhaParaColunas(l).map((c, i) =>
      i === 1 ? `<td><a href="/pedidos?numero=${encodeURIComponent(c)}">${escaparHtml(c)}</a></td>` : `<td>${escaparHtml(c)}</td>`).join("")}</tr>`).join("");
    return reply.type("text/html").send(pagina(req.usuario, "Relatório de impressões", `
<form class="cartao filtros" method="get">
  <label>De <input type="date" name="de" value="${f.de}"></label>
  <label>Até <input type="date" name="ate" value="${f.ate}"></label>
  <label>Vendedor <input name="vendedor" value="${escaparHtml(f.vendedor)}"></label>
  <label>Pedido <input name="pedido" value="${escaparHtml(f.pedido)}"></label>
  <label><input type="checkbox" name="so" value="1" ${f.soReimpressoes ? "checked" : ""} style="display:inline;width:auto"> Só reimpressões</label>
  <button>Filtrar</button>
  <a class="botao" href="/relatorio.csv?${qs}">Exportar para Excel</a>
</form>
<p class="contagem">${todas.length === 1 ? "1 impressão" : `${todas.length} impressões`}</p>
<div class="cartao tabela"><table><thead><tr>${COLUNAS_RELATORIO.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${corpo}</tbody></table></div>
${navegacao}`));
  });

  app.get<{ Querystring: Query }>("/relatorio.csv", { preHandler: exigirLogin }, async (req, reply) => {
    const f = { ...lerFiltro(req.query, diaLocal(d.agora())), impressoraId: escopoFila(req.usuario) };
    return reply
      .type("text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="relatorio-${f.de}-a-${f.ate}.csv"`)
      .send(gerarCsv(await d.repo.relatorio(f)));
  });
}
