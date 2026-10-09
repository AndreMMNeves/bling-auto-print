export const FUSO = "America/Sao_Paulo";

const fmtDataHora = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const fmtHora = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const fmtDia = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" });

export function formatarDataHora(iso: string | null): string {
  if (!iso) return "—";
  return fmtDataHora.format(new Date(iso)).replace(",", "");
}

export function formatarHora(iso: string | null): string {
  if (!iso) return "—";
  return fmtHora.format(new Date(iso));
}

// "YYYY-MM-DD" do dia em São Paulo.
export function diaLocal(d: Date): string {
  return fmtDia.format(d);
}

// O Brasil não tem horário de verão desde 2019: o offset é sempre -03:00.
export function inicioDoDia(dia: string): string {
  return new Date(`${dia}T00:00:00.000-03:00`).toISOString();
}

export function fimDoDia(dia: string): string {
  return new Date(`${dia}T23:59:59.999-03:00`).toISOString();
}
