// Gera a função da Vercel no formato "Build Output API" (.vercel/output).
// Todo o servidor vira um único arquivo; a Vercel só executa.
import { build } from "esbuild";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const saida = ".vercel/output";
const funcao = `${saida}/functions/index.func`;
rmSync(saida, { recursive: true, force: true });
mkdirSync(funcao, { recursive: true });

await build({
  entryPoints: ["servidor/src/vercel.ts"],
  outfile: `${funcao}/index.mjs`,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // Binário nativo do SQLite local: nunca é carregado na Vercel (lá o banco é o Turso via HTTP).
  external: ["libsql", "@libsql/linux-*", "@libsql/darwin-*", "@libsql/win32-*"],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "warning",
});

writeFileSync(`${funcao}/.vc-config.json`, JSON.stringify({
  runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", maxDuration: 60, shouldAddHelpers: false,
}, null, 2));
writeFileSync(`${saida}/config.json`, JSON.stringify({ version: 3, routes: [{ src: "/(.*)", dest: "/index" }] }, null, 2));
console.log(`Função gerada em ${funcao}`);
