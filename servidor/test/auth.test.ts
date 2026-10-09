import { test } from "node:test";
import assert from "node:assert/strict";
import { hashSenha, verificarSenha } from "../src/web/auth.ts";
import { appDeTeste, entrar } from "./ajudantes.ts";

test("hash de senha confere só com a senha certa", async () => {
  const h = hashSenha("abc123");
  assert.ok(h.startsWith("scrypt$"));
  assert.equal(verificarSenha("abc123", h), true);
  assert.equal(verificarSenha("errada", h), false);
  assert.equal(verificarSenha("abc123", "lixo"), false);
});

test("login certo redireciona e cria cookie; errado dá 401", async () => {
  const { app } = await appDeTeste();
  const ok = await app.inject({ method: "POST", url: "/login", payload: { email: "SUP@x.com ", senha: "senha-sup" } });
  assert.equal(ok.statusCode, 302);
  assert.ok(ok.headers["set-cookie"]);
  const ruim = await app.inject({ method: "POST", url: "/login", payload: { email: "sup@x.com", senha: "x" } });
  assert.equal(ruim.statusCode, 401);
  assert.match(ruim.body, /E-mail ou senha incorretos/);
});

test("sem login vai para /login", async () => {
  const { app } = await appDeTeste();
  const r = await app.inject({ url: "/usuarios" });
  assert.equal(r.statusCode, 302);
  assert.equal(r.headers.location, "/login");
});

test("cookie adulterado não autentica", async () => {
  const { app } = await appDeTeste();
  const r = await app.inject({ url: "/usuarios", headers: { cookie: "sessao=1:9999999999999.assinatura-falsa" } });
  assert.equal(r.statusCode, 302);
});

test("operador não acessa usuários; supervisor acessa e cria", async () => {
  const { app, repo } = await appDeTeste();
  const op = await entrar(app, "op@x.com", "senha-op");
  assert.equal((await app.inject({ url: "/usuarios", headers: { cookie: op } })).statusCode, 403);

  const sup = await entrar(app, "sup@x.com", "senha-sup");
  const lista = await app.inject({ url: "/usuarios", headers: { cookie: sup } });
  assert.equal(lista.statusCode, 200);
  assert.match(lista.body, /op@x\.com/);

  const criar = await app.inject({ method: "POST", url: "/usuarios", headers: { cookie: sup }, payload: { nome: "Novo <b>", email: "Novo@X.com", senha: "12345678", papel: "operador" } });
  assert.equal(criar.statusCode, 302);
  assert.equal((await repo.buscarUsuarioPorEmail("novo@x.com"))?.papel, "operador");
  const depois = await app.inject({ url: "/usuarios", headers: { cookie: sup } });
  assert.match(depois.body, /Novo &lt;b&gt;/);
});

test("senha curta ou e-mail repetido são recusados", async () => {
  const { app } = await appDeTeste();
  const sup = await entrar(app, "sup@x.com", "senha-sup");
  const curta = await app.inject({ method: "POST", url: "/usuarios", headers: { cookie: sup }, payload: { nome: "A", email: "a@x.com", senha: "123", papel: "operador" } });
  assert.equal(curta.statusCode, 400);
  const repetido = await app.inject({ method: "POST", url: "/usuarios", headers: { cookie: sup }, payload: { nome: "A", email: "op@x.com", senha: "12345678", papel: "operador" } });
  assert.equal(repetido.statusCode, 400);
});

test("usuário desativado não entra", async () => {
  const { app, repo, operadorId } = await appDeTeste();
  await repo.definirUsuarioAtivo(operadorId, false);
  const r = await app.inject({ method: "POST", url: "/login", payload: { email: "op@x.com", senha: "senha-op" } });
  assert.equal(r.statusCode, 401);
});
