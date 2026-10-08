// Instala/remove servidor e agente como serviços do Windows (sobem com o PC e reiniciam se caírem).
// Rodar num terminal "Executar como administrador":
//   node scripts/servicos.ts instalar
//   node scripts/servicos.ts desinstalar
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import nodeWindows from "node-windows";

const RAIZ = fileURLToPath(new URL("../", import.meta.url));
const acao = process.argv[2];
if (acao !== "instalar" && acao !== "desinstalar") {
  console.error("Uso: node scripts/servicos.ts instalar|desinstalar");
  process.exit(1);
}

const servicos = [
  { name: "Onix Expedicao - Servidor", script: join(RAIZ, "servidor/src/main.ts") },
  { name: "Onix Expedicao - Agente", script: join(RAIZ, "agente/src/main.ts") },
];

for (const s of servicos) {
  const svc = new nodeWindows.Service({
    name: s.name,
    description: "Sistema de impressão da expedição (Bling → folha de separação)",
    script: s.script,
    workingDirectory: RAIZ,
    wait: 5,
    grow: 0.5,
    maxRestarts: 1000,
  });
  svc.on("install", () => { console.log(`instalado: ${s.name}`); svc.start(); });
  svc.on("alreadyinstalled", () => console.log(`já instalado: ${s.name}`));
  svc.on("uninstall", () => console.log(`removido: ${s.name}`));
  svc.on("error", (e: unknown) => console.error(`erro em ${s.name}:`, e));
  if (acao === "instalar") svc.install(); else svc.uninstall();
}
