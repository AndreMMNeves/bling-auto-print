import type { FastifyInstance } from "fastify";
import type { Repositorio } from "../banco/repositorio.ts";
import type { MontarFolha } from "../bling/montar-folha.ts";
import { reimprimir } from "../fila/fila.ts";
import { escaparHtml } from "../../../compartilhado/html-util.ts";
import { formatarDataHora } from "../../../compartilhado/tempo.ts";
import { listaAlertas } from "./alertas.ts";
import { escopoFila, exigirLogin, exigirSupervisor, type UsuarioSessao } from "./auth.ts";
import { etiquetaStatus, pagina } from "./layout.ts";

export const MOTIVOS_REIMPRESSAO = ["Folha perdida", "Folha danificada", "Pedido alterado", "Erro na impressora", "Outro"];

type DepsPedidos = { repo: Repositorio; filialId: number; impressoraId: number; montarFolha: MontarFolha; agora: () => Date };

// Login de expedição só abre pedidos que passaram pela fila dela.
async function visivel(d: DepsPedidos, pedidoId: number, usuario: UsuarioSessao | null): Promise<boolean> {
  const fila = escopoFila(usuario);
  return fila === undefined || (await d.repo.pedidoDaFila(pedidoId, fila));
}

async function telaPedido(d: DepsPedidos, pedidoId: number, usuario: UsuarioSessao, erro: string | null): Promise<string | null> {
  const p = await d.repo.buscarPedidoPorId(pedidoId);
  if (!p || !(await visivel(d, p.id, usuario))) return null;
  const imps = await d.repo.impressoesDoPedido(p.id);
  const linhas = imps.map((i) => `<tr><td>${i.via}ª via</td><td>${etiquetaStatus(i.status)}</td>
    <td>${formatarDataHora(i.impresso_em ?? i.criado_em)}</td><td>${escaparHtml(i.usuario) || "Automática"}</td>
    <td>${escaparHtml(i.motivo)}</td><td>${escaparHtml(i.ultimo_erro)}</td></tr>`).join("");
  const form = usuario.papel === "supervisor" ? `
<form class="cartao" method="post" action="/pedidos/${p.id}/reimprimir">
  <h2>Reimprimir</h2>
  ${erro ? `<p class="erro">${escaparHtml(erro)}</p>` : ""}
  <label>Motivo <select name="motivo">${MOTIVOS_REIMPRESSAO.map((m) => `<option>${m}</option>`).join("")}</select></label>
  <label>Se for "Outro", explique <input name="outro" maxlength="200"></label>
  <button>Reimprimir (sai como ${await d.repo.proximaVia(p.id)}ª via)</button>
</form>` : "";
  const alertas = await d.repo.alertasDoPedido(p.id);
  return pagina(usuario, `Pedido ${p.numero}`, `
<div class="colunas">
<section>
<div class="cartao tabela ficha"><table>
  <tr><th>Detectado em</th><td>${formatarDataHora(p.detectado_em)} ${p.origem === "baseline" ? "(já estava Atendido quando o sistema foi ligado)" : ""}</td></tr>
  <tr><th>Situação no Bling (id)</th><td>${p.situacao}</td></tr>
</table></div>
<h2>Impressões</h2>
<div class="cartao tabela"><table><thead><tr><th>Via</th><th>Status</th><th>Quando</th><th>Por</th><th>Motivo</th><th>Erro</th></tr></thead>
<tbody>${linhas || `<tr><td class="vazio" colspan="6">Nenhuma impressão deste pedido.</td></tr>`}</tbody></table></div>
</section>
<aside>${alertas.length ? `<section class="secao"><h2>Alertas</h2>${listaAlertas(alertas, usuario, true)}</section>` : ""}${form ? `<section class="secao">${form}</section>` : ""}</aside>
</div>`);
}

export function registrarPedidos(app: FastifyInstance, d: DepsPedidos): void {
  app.get<{ Querystring: { numero?: string } }>("/pedidos", { preHandler: exigirLogin }, async (req, reply) => {
    const numero = req.query.numero?.trim();
    if (numero) {
      const p = await d.repo.buscarPedido(d.filialId, numero);
      if (p && (await visivel(d, p.id, req.usuario))) return reply.redirect(`/pedidos/${p.id}`);
    }
    return reply.type("text/html").send(pagina(req.usuario, "Pedidos", `
${numero ? `<p class="erro">Pedido ${escaparHtml(numero)} não encontrado no sistema.</p>` : ""}
<form class="cartao filtros estreito" method="get"><label>Número do pedido <input name="numero" inputmode="numeric" autofocus></label><button>Buscar</button></form>`));
  });

  app.get<{ Params: { id: string } }>("/pedidos/:id", { preHandler: exigirLogin }, async (req, reply) => {
    const html = await telaPedido(d, Number(req.params.id), req.usuario!, null);
    if (!html) return reply.code(404).type("text/html").send(pagina(req.usuario, "Não encontrado", "<p>Pedido não encontrado.</p>"));
    return reply.type("text/html").send(html);
  });

  app.post<{ Params: { id: string }; Body: { motivo?: string; outro?: string } }>(
    "/pedidos/:id/reimprimir", { preHandler: exigirSupervisor }, async (req, reply) => {
      const pedidoId = Number(req.params.id);
      if (!(await d.repo.buscarPedidoPorId(pedidoId))) return reply.code(404).send();
      const escolhido = String(req.body?.motivo ?? "");
      const outro = String(req.body?.outro ?? "").trim();
      let erro: string | null = null;
      if (!MOTIVOS_REIMPRESSAO.includes(escolhido)) erro = "Escolha um motivo da lista.";
      else if (escolhido === "Outro" && !outro) erro = 'Explique o motivo quando escolher "Outro".';
      if (erro) return reply.code(400).type("text/html").send(await telaPedido(d, pedidoId, req.usuario!, erro));

      const motivo = escolhido === "Outro" ? `Outro: ${outro}` : escolhido;
      try {
        // Sai na mesma fila (expedição) da impressão anterior do pedido.
        const impressoraId = (await d.repo.ultimaImpressao(pedidoId))?.impressora_id ?? d.impressoraId;
        await reimprimir(d.repo, d.montarFolha, { pedidoId, impressoraId, motivo, usuarioId: req.usuario!.id, agora: d.agora() });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return reply.code(502).type("text/html").send(await telaPedido(d, pedidoId, req.usuario!, `Não foi possível buscar o pedido no Bling: ${msg}`));
      }
      await d.repo.resolverAlertasDoTipo("repetido", req.usuario!.id, d.agora(), pedidoId);
      return reply.redirect(`/pedidos/${pedidoId}`);
    });
}
