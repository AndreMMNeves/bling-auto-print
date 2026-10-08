import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Papel, Repositorio } from "../banco/repositorio.ts";
import { escaparHtml } from "../html-util.ts";
import { pagina } from "./layout.ts";

export type UsuarioSessao = { id: number; nome: string; papel: Papel };

declare module "fastify" {
  interface FastifyRequest {
    usuario: UsuarioSessao | null;
  }
}

const COOKIE = "sessao";
const DURACAO_S = 12 * 3600;

export function hashSenha(senha: string): string {
  const sal = randomBytes(16);
  return `scrypt$${sal.toString("hex")}$${scryptSync(senha, sal, 32).toString("hex")}`;
}

export function verificarSenha(senha: string, armazenado: string): boolean {
  const [alg, salHex, hHex] = armazenado.split("$");
  if (alg !== "scrypt" || !salHex || !hHex) return false;
  const esperado = Buffer.from(hHex, "hex");
  const h = scryptSync(senha, Buffer.from(salHex, "hex"), esperado.length);
  return timingSafeEqual(h, esperado);
}

function paginaLogin(erro: string | null): string {
  return pagina(null, "Entrar", `
<form method="post" action="/login" class="cartao estreito entrada">
  <span class="marca">Ônix HOF<small>Expedição</small></span>
  ${erro ? `<p class="erro">${escaparHtml(erro)}</p>` : ""}
  <label>E-mail <input name="email" type="email" required autofocus></label>
  <label>Senha <input name="senha" type="password" required></label>
  <button>Entrar</button>
</form>`, { semTitulo: true });
}

export function registrarAuth(app: FastifyInstance, d: { repo: Repositorio; agora: () => Date }): void {
  app.decorateRequest("usuario", null);

  app.addHook("preHandler", async (req) => {
    req.usuario = null;
    const bruto = req.cookies[COOKIE];
    if (!bruto) return;
    const r = req.unsignCookie(bruto);
    if (!r.valid || !r.value) return;
    const [idStr, expStr] = r.value.split(":");
    if (Number(expStr) < d.agora().getTime()) return;
    const u = d.repo.buscarUsuarioPorId(Number(idStr));
    if (u && u.ativo) req.usuario = { id: u.id, nome: u.nome, papel: u.papel };
  });

  app.get("/login", async (_req, reply) => reply.type("text/html").send(paginaLogin(null)));

  app.post<{ Body: { email?: string; senha?: string } }>("/login", async (req, reply) => {
    const u = d.repo.buscarUsuarioPorEmail(String(req.body?.email ?? ""));
    if (!u || !u.ativo || !verificarSenha(String(req.body?.senha ?? ""), u.senha_hash)) {
      return reply.code(401).type("text/html").send(paginaLogin("E-mail ou senha incorretos."));
    }
    const exp = d.agora().getTime() + DURACAO_S * 1000;
    reply.setCookie(COOKIE, `${u.id}:${exp}`, { signed: true, httpOnly: true, sameSite: "strict", path: "/", maxAge: DURACAO_S });
    return reply.redirect("/");
  });

  app.post("/logout", async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: "/" });
    return reply.redirect("/login");
  });
}

export async function exigirLogin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.usuario) return reply.redirect("/login");
}

export async function exigirSupervisor(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.usuario) return reply.redirect("/login");
  if (req.usuario.papel !== "supervisor") {
    return reply.code(403).type("text/html").send(pagina(req.usuario, "Sem permissão", "<p>Só supervisores podem fazer isso.</p>"));
  }
}
