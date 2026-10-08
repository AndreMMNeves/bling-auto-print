// Uso: npm run criar-usuario -- --nome "Fulano" --email f@x.com --senha "********" --papel supervisor
import { parseArgs } from "node:util";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { carregarConfig, RAIZ } from "../config.ts";
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
  console.error('Uso: npm run criar-usuario -- --nome "Fulano" --email f@x.com --senha "minimo8" --papel supervisor|operador');
  process.exit(1);
}
const config = carregarConfig(a.config!);
mkdirSync(dirname(config.arquivoBanco), { recursive: true });
const repo = new Repositorio(abrirBanco(config.arquivoBanco));
const id = repo.criarUsuario({ nome: a.nome, email: a.email, senhaHash: hashSenha(a.senha), papel: a.papel === "supervisor" ? "supervisor" : "operador" });
console.log(`Usuário ${a.email} criado (id ${id}).`);
