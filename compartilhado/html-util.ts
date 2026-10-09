const MAPA: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escaparHtml(s: string | number | null | undefined): string {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[&<>"']/g, (c) => MAPA[c]);
}
