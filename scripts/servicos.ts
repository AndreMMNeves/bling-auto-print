// Instala/remove os serviços do Windows (sobem com o PC, sem login, e reiniciam se caírem).
// Com o servidor na Vercel, só o agente roda no PC (padrão). "todos" instala também o servidor local.
//   node scripts/servicos.ts instalar [agente|todos]
//   node scripts/servicos.ts desinstalar [agente|todos]
// O Windows pede confirmação de administrador (UAC) na primeira vez.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import nodeWindows from "node-windows";

const RAIZ = fileURLToPath(new URL("../", import.meta.url));
const acao = process.argv[2];
const quais = process.argv[3] ?? "agente";
if ((acao !== "instalar" && acao !== "desinstalar") || (quais !== "agente" && quais !== "todos")) {
  console.error("Uso: node scripts/servicos.ts instalar|desinstalar [agente|todos]");
  process.exit(1);
}

const servicos = [
  { name: "Onix Expedicao - Agente", script: join(RAIZ, "agente/src/main.ts") },
  ...(quais === "todos" ? [{ name: "Onix Expedicao - Servidor", script: join(RAIZ, "servidor/src/main.ts") }] : []),
];

for (const s of servicos) {
  const svc = new nodeWindows.Service({
    name: s.name,
    description: "Ônix - impressão automática da expedição (Bling → folha de separação)",
    script: s.script,
    workingDirectory: RAIZ,
    wait: 5,
    grow: 0.5,
    maxRestarts: 1000,
  });
  svc.on("install", () => { console.log(`instalado: ${s.name}`); svc.start(); });
  svc.on("start", () => console.log(`rodando: ${s.name}`));
  svc.on("alreadyinstalled", () => console.log(`já instalado: ${s.name}`));
  svc.on("uninstall", () => console.log(`removido: ${s.name}`));
  svc.on("error", (e: unknown) => console.error(`erro em ${s.name}:`, e));
  if (acao === "instalar") svc.install(); else svc.uninstall();
}
