import type { FastifyInstance } from "fastify";
import type { AlertaView, Repositorio } from "../banco/repositorio.ts";
import { escaparHtml } from "../../../compartilhado/html-util.ts";
import { formatarDataHora } from "../../../compartilhado/tempo.ts";
import { escopoFila, exigirLogin, exigirSupervisor, type UsuarioSessao } from "./auth.ts";
import { pagina } from "./layout.ts";

const TITULO: Record<AlertaView["tipo"], string> = {
  repetido: "Pedido repetido", cancelado: "Cancelado após impressão", falha_impressao: "Falha de impressão",
  retomada: "Retomada", bling_desconectado: "Bling desconectado",
};

// Na tela do próprio pedido não precisa do botão "Abrir pedido".
export function listaAlertas(alertas: AlertaView[], usuario: UsuarioSessao, noPedido = false): string {
  if (!alertas.length) return `<p class="nada">Nenhum alerta pendente.</p>`;
  return alertas.map((a) => `<div class="cartao alerta">
    <div class="titulo">${TITULO[a.tipo]}<span class="quando">${formatarDataHora(a.criado_em)}</span></div>
    <p>${escaparHtml(a.mensagem)}</p>
    <div class="acoes">
      ${a.pedido_id && !noPedido ? `<a class="botao" href="/pedidos/${a.pedido_id}">Abrir pedido ${escaparHtml(a.numero)}</a>` : ""}
      ${usuario.papel === "supervisor" ? `<form class="inline" method="post" action="/alertas/${a.id}/resolver"><button class="secundario">Marcar como resolvido</button></form>` : ""}
    </div>
  </div>`).join("");
}

export function registrarAlertas(app: FastifyInstance, d: { repo: Repositorio; agora: () => Date }): void {
  app.get("/alertas", { preHandler: exigirLogin }, async (req, reply) =>
    reply.type("text/html").send(pagina(req.usuario, "Alertas", `<div class="grade-alertas">${listaAlertas(await d.repo.alertasPendentes(escopoFila(req.usuario)), req.usuario!)}</div>`, { atualizarSegundos: 30 })));

  app.post<{ Params: { id: string } }>("/alertas/:id/resolver", { preHandler: exigirSupervisor }, async (req, reply) => {
    await d.repo.resolverAlerta(Number(req.params.id), req.usuario!.id, d.agora());
    return reply.redirect(String(req.headers.referer ?? "/alertas"));
  });
}
