import { test } from "node:test";
import assert from "node:assert/strict";
import { diaLocal, fimDoDia, formatarDataHora, formatarHora, inicioDoDia } from "../src/tempo.ts";

test("formatarDataHora mostra no fuso de São Paulo", () => {
  assert.equal(formatarDataHora("2026-10-08T17:32:00.000Z"), "08/10/2026 14:32");
  assert.equal(formatarDataHora(null), "—");
});

test("formatarHora mostra só hora e minuto", () => {
  assert.equal(formatarHora("2026-10-08T17:32:00.000Z"), "14:32");
});

test("diaLocal usa o dia de São Paulo, não o de UTC", () => {
  // 02:50 UTC do dia 09 = 23:50 do dia 08 em São Paulo
  assert.equal(diaLocal(new Date("2026-10-09T02:50:00.000Z")), "2026-10-08");
});

test("inicioDoDia e fimDoDia convertem o dia local para UTC", () => {
  assert.equal(inicioDoDia("2026-10-08"), "2026-10-08T03:00:00.000Z");
  assert.equal(fimDoDia("2026-10-08"), "2026-10-09T02:59:59.999Z");
});
