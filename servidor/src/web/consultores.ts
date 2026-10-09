import type { FastifyInstance } from "fastify";
import type { Repositorio } from "../banco/repositorio.ts";
import { escaparHtml } from "../../../compartilhado/html-util.ts";
import { exigirSupervisor } from "./auth.ts";
import { pagina } from "./layout.ts";

type DepsConsultores = {
  repo: Repositorio;
  bling: { listarVendedores(): Promise<Array<{ id: number; nome: string }>> };
};

// Cada vendedor do Bling aponta para uma expedição (ou "Não imprime").
// O monitor só lê os pedidos dos vendedores ligados a uma expedição.
export function registrarConsultores(app: FastifyInstance, d: DepsConsultores): void {
  app.get<{ Querystring: { ok?: string } }>("/consultores", { preHandler: exigirSupervisor }, async (req, reply) => {
    const expedicoes = (await d.repo.listarExpedicoes()).filter((e) => e.ativo);
    const salvos = new Map((await d.repo.todosConsultores()).map((c) => [c.vendedor_id, c]));
    let vendedores: Array<{ id: number; nome: string }>;
    let aviso = "";
    try {
      vendedores = await d.bling.listarVendedores();
    } catch (e) {
      // Sem Bling: mostra ao menos os já configurados.
      vendedores = [...salvos.values()].map((c) => ({ id: c.vendedor_id, nome: c.nome }));
      aviso = `<p class="erro">Não consegui buscar a lista de vendedores no Bling (${escaparHtml(e instanceof Error ? e.message : String(e))}). Mostrando só os já configurados.</p>`;
    }
    const opcoes = (atual: number | null | undefined) => [`<option value="">Não imprime</option>`,
      ...expedicoes.map((e) => `<option value="${e.usuario_id}"${atual === e.usuario_id ? " selected" : ""}>${escaparHtml(e.nome)}</option>`)].join("");
    // Configurados primeiro, depois os demais em ordem alfabética.
    const configurado = (id: number) => (salvos.get(id)?.usuario_id ? 1 : 0);
    const ordenados = [...vendedores].sort((a, b) => configurado(b.id) - configurado(a.id) || a.nome.localeCompare(b.nome, "pt-BR"));
    const linhas = ordenados.map((v) => `<tr>
      <td>${escaparHtml(v.nome)}<input type="hidden" name="n_${v.id}" value="${escaparHtml(v.nome)}"></td>
      <td><select name="v_${v.id}">${opcoes(salvos.get(v.id)?.usuario_id)}</select></td>
    </tr>`).join("");
    const semExpedicao = expedicoes.length
      ? ""
      : `<p class="erro">Nenhuma expedição cadastrada. Crie primeiro um usuário com papel "Expedição" em <a href="/usuarios">Usuários</a>.</p>`;
    return reply.type("text/html").send(pagina(req.usuario, "Consultores", `
<p class="contagem">Escolha em qual expedição sai a folha de cada consultor. "Não imprime" = o sistema ignora os pedidos dele.</p>
${semExpedicao}${aviso}
<form method="post" action="/consultores">
  <div class="cartao tabela"><table><thead><tr><th>Consultor (vendedor no Bling)</th><th>Imprime na expedição</th></tr></thead><tbody>${linhas}</tbody></table></div>
  <button>Salvar</button>
</form>`, { mensagem: req.query.ok ? "Consultores salvos." : undefined }));
  });

  app.post<{ Body: Record<string, string> }>("/consultores", { preHandler: exigirSupervisor }, async (req, reply) => {
    const corpo = req.body ?? {};
    const expedicoes = new Set((await d.repo.listarExpedicoes()).map((e) => e.usuario_id));
    for (const [chave, valor] of Object.entries(corpo)) {
      const m = /^v_(\d+)$/.exec(chave);
      if (!m) continue;
      const vendedorId = Number(m[1]);
      const usuarioId = valor ? Number(valor) : null;
      if (usuarioId !== null && !expedicoes.has(usuarioId)) continue; // ignora valor forjado
      await d.repo.definirConsultor(vendedorId, String(corpo[`n_${m[1]}`] ?? `Vendedor ${vendedorId}`), usuarioId);
    }
    return reply.redirect("/consultores?ok=1");
  });
}
