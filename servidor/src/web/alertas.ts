import type { FastifyInstance } from "fastify";
import type { AlertaView, Repositorio } from "../banco/repositorio.ts";
import { escaparHtml } from "../html-util.ts";
import { formatarDataHora } from "../tempo.ts";
import { exigirLogin, exigirSupervisor, type UsuarioSessao } from "./auth.ts";
import { pagina } from "./layout.ts";

const TITULO: Record<AlertaView["tipo"], string> = {
  repetido: "Pedido repetido", cancelado: "Cancelado após impressão", falha_impressao: "Falha de impressão",
  retomada: "Retomada", bling_desconectado: "Bling desconectado",
};

export function listaAlertas(alertas: AlertaView[], usuario: UsuarioSessao): string {
  if (!alertas.length) return `<p class="ok">Nenhum alerta pendente.</p>`;
  return alertas.map((a) => `<div class="cartao alerta">
    <b>${TITULO[a.tipo]}</b> · ${formatarDataHora(a.criado_em)}
    <p>${escaparHtml(a.mensagem)}</p>
    ${a.pedido_id ? `<a class="botao" href="/pedidos/${a.pedido_id}">Abrir pedido ${escaparHtml(a.numero)}</a> ` : ""}
    ${usuario.papel === "supervisor" ? `<form class="inline" method="post" action="/alertas/${a.id}/resolver"><button>Marcar como resolvido</button></form>` : ""}
  </div>`).join("");
}

export function registrarAlertas(app: FastifyInstance, d: { repo: Repositorio; agora: () => Date }): void {
  app.get("/alertas", { preHandler: exigirLogin }, async (req, reply) =>
    reply.type("text/html").send(pagina(req.usuario, "Alertas", listaAlertas(d.repo.alertasPendentes(), req.usuario!), { atualizarSegundos: 30 })));

  app.post<{ Params: { id: string } }>("/alertas/:id/resolver", { preHandler: exigirSupervisor }, async (req, reply) => {
    d.repo.resolverAlerta(Number(req.params.id), req.usuario!.id, d.agora());
    return reply.redirect(String(req.headers.referer ?? "/alertas"));
  });
}
