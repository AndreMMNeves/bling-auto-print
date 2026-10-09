// Uso: npm run criar-usuario -- --nome "Fulano" --email f@x.com --senha "********" --papel supervisor|operador|expedicao
import { parseArgs } from "node:util";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { carregarConfig, carregarConfigDoAmbiente, RAIZ, type Config } from "../config.ts";
import { abrirBanco } from "../banco/banco.ts";
import { Repositorio } from "../banco/repositorio.ts";
import { hashSenha } from "../web/auth.ts";

const { values: a } = parseArgs({
  options: {
    nome: { type: "string" }, email: { type: "string" }, senha: { type: "string" },
    papel: { type: "string", default: "operador" }, config: { type: "string", default: join(RAIZ, "servidor/config.json") },
  },
});
if (!a.nome || !a.email || !a.senha || a.senha.length < 8) {
  console.error('Uso: npm run criar-usuario -- --nome "Fulano" --email f@x.com --senha "minimo8" --papel supervisor|operador|expedicao');
  process.exit(1);
}
// Com servidor/config.json usa o banco local; sem ele, usa as variáveis de ambiente (DATABASE_URL do Supabase).
const config: Config = existsSync(a.config!) ? carregarConfig(a.config!) : carregarConfigDoAmbiente(process.env);
mkdirSync(join(RAIZ, "dados"), { recursive: true });
const repo = new Repositorio(await abrirBanco(config.banco.url));
const papel = a.papel === "supervisor" ? "supervisor" : a.papel === "expedicao" ? "expedicao" : "operador";
const id = await repo.criarUsuario({ nome: a.nome, email: a.email, senhaHash: hashSenha(a.senha), papel });
if (papel === "expedicao") await repo.garantirFilaDoUsuario(id, await repo.garantirFilial(config.filial.codigo, config.filial.nome));
console.log(`Usuário ${a.email} criado (id ${id}).`);
