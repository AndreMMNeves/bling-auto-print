import type { FastifyInstance } from "fastify";
import type { Papel, Repositorio } from "../banco/repositorio.ts";
import { escaparHtml } from "../../../compartilhado/html-util.ts";
import { exigirSupervisor, hashSenha, type UsuarioSessao } from "./auth.ts";
import { pagina } from "./layout.ts";

async function tela(repo: Repositorio, usuario: UsuarioSessao, erro: string | null, mensagem?: string): Promise<string> {
  const linhas = (await repo.listarUsuarios()).map((u) => `<tr>
    <td>${escaparHtml(u.nome)}</td><td>${escaparHtml(u.email)}</td><td>${ROTULO_PAPEL[u.papel]}</td>
    <td>${u.ativo ? "Ativo" : "Desativado"}</td>
    <td>${u.id === usuario.id ? "" : `<form class="inline" method="post" action="/usuarios/${u.id}/ativo">
      <input type="hidden" name="ativo" value="${u.ativo ? "0" : "1"}"><button class="${u.ativo ? "perigo" : ""}">${u.ativo ? "Desativar" : "Reativar"}</button></form>`}</td>
  </tr>`).join("");
  return pagina(usuario, "Usuários", `
<div class="cartao tabela"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Situação</th><th></th></tr></thead><tbody>${linhas}</tbody></table></div>
<form class="cartao estreito" method="post" action="/usuarios">
  <h2>Novo usuário</h2>
  ${erro ? `<p class="erro">${escaparHtml(erro)}</p>` : ""}
  <label>Nome <input name="nome" required></label>
  <label>E-mail <input name="email" type="email" required></label>
  <label>Senha (mínimo 8 caracteres) <input name="senha" type="password" minlength="8" required></label>
  <label>Papel <select name="papel">
    <option value="expedicao">Expedição (login de uma expedição: ES, PR...)</option>
    <option value="operador">Operador (só consulta, vê tudo)</option>
    <option value="supervisor">Supervisor (configura e reimprime)</option>
  </select></label>
  <button>Criar</button>
</form>`, { mensagem });
}

const ROTULO_PAPEL: Record<Papel, string> = { supervisor: "Supervisor", operador: "Operador", expedicao: "Expedição" };

export function registrarUsuarios(app: FastifyInstance, d: { repo: Repositorio; filialId: number }): void {
  app.get("/usuarios", { preHandler: exigirSupervisor }, async (req, reply) =>
    reply.type("text/html").send(await tela(d.repo, req.usuario!, null)));

  app.post<{ Body: { nome?: string; email?: string; senha?: string; papel?: string } }>(
    "/usuarios", { preHandler: exigirSupervisor }, async (req, reply) => {
      const nome = String(req.body?.nome ?? "").trim();
      const email = String(req.body?.email ?? "").trim().toLowerCase();
      const senha = String(req.body?.senha ?? "");
      const papel: Papel = req.body?.papel === "supervisor" ? "supervisor" : req.body?.papel === "expedicao" ? "expedicao" : "operador";
      let erro: string | null = null;
      if (!nome || !email) erro = "Preencha nome e e-mail.";
      else if (senha.length < 8) erro = "A senha precisa ter pelo menos 8 caracteres.";
      else if (await d.repo.buscarUsuarioPorEmail(email)) erro = "Já existe um usuário com esse e-mail.";
      if (erro) return reply.code(400).type("text/html").send(await tela(d.repo, req.usuario!, erro));
      const id = await d.repo.criarUsuario({ nome, email, senhaHash: hashSenha(senha), papel });
      if (papel === "expedicao") await d.repo.garantirFilaDoUsuario(id, d.filialId); // fila de impressão própria
      return reply.redirect("/usuarios");
    });

  app.post<{ Params: { id: string }; Body: { ativo?: string } }>(
    "/usuarios/:id/ativo", { preHandler: exigirSupervisor }, async (req, reply) => {
      const id = Number(req.params.id);
      if (id !== req.usuario!.id) await d.repo.definirUsuarioAtivo(id, req.body?.ativo === "1");
      return reply.redirect("/usuarios");
    });
}
