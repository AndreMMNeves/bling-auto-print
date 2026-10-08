// Executa fn, espera intervaloMs depois que ela TERMINA e repete.
// Nunca roda duas execuções ao mesmo tempo.
export function repetir(intervaloMs: number, fn: () => Promise<void>): () => void {
  let parado = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const rodada = async () => {
    try {
      await fn();
    } catch (e) {
      console.error(e);
    }
    if (!parado) timer = setTimeout(rodada, intervaloMs);
  };
  void rodada();
  return () => {
    parado = true;
    clearTimeout(timer);
  };
}
