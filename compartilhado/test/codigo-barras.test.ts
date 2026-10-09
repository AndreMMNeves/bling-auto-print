import { test } from "node:test";
import assert from "node:assert/strict";
import { codigoBarrasDataUri } from "../folha/codigo-barras.ts";

test("gera PNG em data URI", async () => {
  const uri = await codigoBarrasDataUri("12345");
  assert.match(uri, /^data:image\/png;base64,/);
  const png = Buffer.from(uri.split(",")[1], "base64");
  assert.equal(png.subarray(1, 4).toString(), "PNG");
});
