import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { DepsApp } from "../app.ts";
import { escaparHtml } from "../../../compartilhado/html-util.ts";
import { statusSistema } from "../status.ts";
import { exigirSupervisor } from "./auth.ts";
import { pagina } from "./layout.ts";

const CHAVE_STATE = "bling:oauth_state";

export function registrarConfig(app: FastifyInstance, d: DepsApp): void {
  app.get<{ Querystring: { ok?: string } }>("/config", { preHandler: exigirSupervisor }, async (req, reply) => {
    const s = await statusSistema(d.repo, d.impressoraId, d.agora());
    const c = d.config;
    const conectado = await d.bling.estaConectado();
    return reply.type("text/html").send(pagina(req.usuario, "Configuração", `
<div class="cartao">
  <h2>Bling</h2>
  <p>${conectado ? "Conectado." : '<span class="ruim">Não conectado.</span>'} ${escaparHtml(s.bling.texto)}</p>
  <a class="botao" href="/bling/conectar">${conectado ? "Reconectar ao Bling" : "Conectar ao Bling"}</a>
</div>
<div class="cartao tabela"><table>
  <tr><th>Filial</th><td>${escaparHtml(c.filial.nome)} (${escaparHtml(c.filial.codigo)})</td></tr>
  <tr><th>Impressora</th><td>${c.agentes.map((a) => `${escaparHtml(a.impressora)} (agente ${escaparHtml(a.nome)})`).join("<br>")}</td></tr>
  <tr><th>Consulta ao Bling</th><td>a cada ${c.bling.intervaloSegundos}s, margem ${c.bling.margemMinutos} min</td></tr>
  <tr><th>Situação Atendido / Cancelado</th><td>${c.bling.situacaoAtendido} / ${c.bling.situacaoCancelado}</td></tr>
  <tr><th>Código de barras do pedido</th><td>${escaparHtml(c.bling.campoCodigoBarras)}</td></tr>
  <tr><th>Google Sheets</th><td>${c.google ? `planilha ${escaparHtml(c.google.planilhaId)}, aba ${escaparHtml(c.google.aba)}` : "desligado"}</td></tr>
</table><p>Para mudar estes valores, edite <code>servidor/config.json</code> e reinicie o serviço.</p></div>`,
      { mensagem: req.query.ok ? "Bling conectado com sucesso." : undefined }));
  });

  app.get("/bling/conectar", { preHandler: exigirSupervisor }, async (req, reply) => {
    const state = randomBytes(24).toString("hex");
    await d.repo.definirEstado(CHAVE_STATE, `${state}:${req.usuario!.id}`);
    return reply.redirect(d.bling.urlAutorizacao(state));
  });

  // Sem login: o cookie SameSite=Strict não volta no redirecionamento vindo do Bling.
  // Quem protege esta rota é o state de uso único.
  app.get<{ Querystring: { code?: string; state?: string } }>("/bling/callback", async (req, reply) => {
    const salvo = await d.repo.obterEstado(CHAVE_STATE);
    const [state, usuarioIdStr] = (salvo ?? "").split(":");
    if (!salvo || !req.query.state || req.query.state !== state) {
      return reply.code(400).type("text/html").send(pagina(null, "Link inválido", '<p>Este link de conexão expirou. Volte em <a href="/config">Configuração</a> e clique em conectar de novo.</p>'));
    }
    await d.repo.definirEstado(CHAVE_STATE, null); // uso único
    try {
      await d.bling.trocarCodigo(String(req.query.code ?? ""));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(502).type("text/html").send(pagina(null, "Falha ao conectar", `<p class="erro">${escaparHtml(msg)}</p><p><a href="/config">Tentar de novo</a></p>`));
    }
    await d.repo.resolverAlertasDoTipo("bling_desconectado", Number(usuarioIdStr) || null, d.agora());
    await d.repo.definirEstado("bling:erro_desde", null);
    await d.repo.definirEstado("bling:erro_msg", null);
    return reply.redirect("/config?ok=1");
  });
}
