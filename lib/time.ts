/** Utilitários de data/hora com fuso explícito, sem dependências. */

function parts(utc: Date, tz: string): Record<string, number> {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const out: Record<string, number> = {};
  for (const p of dtf.formatToParts(utc)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out;
}

function offsetMs(utc: Date, tz: string): number {
  const p = parts(utc, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(utc.getTime() / 1000) * 1000;
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?$/;

/** "2026-11-16T14:00" interpretado no fuso `tz` → instante UTC. */
export function localToUtc(local: string, tz: string): Date {
  const m = LOCAL_RE.exec(local.trim());
  if (!m) throw new Error(`Data/hora inválida: "${local}" (use AAAA-MM-DDTHH:MM)`);
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  if (Number.isNaN(guess)) throw new Error(`Data/hora inválida: "${local}"`);
  let utc = guess - offsetMs(new Date(guess), tz);
  // Segunda passada cobre viradas de horário de verão.
  utc = guess - offsetMs(new Date(utc), tz);
  return new Date(utc);
}

/** Aceita hora local sem offset (interpretada em `tz`) ou ISO com offset/Z. */
export function parseDateTime(input: string, tz: string): Date {
  const s = input.trim();
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(s) && s.includes("T")) {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) throw new Error(`Data/hora inválida: "${input}"`);
    return d;
  }
  return localToUtc(s, tz);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Instante UTC → "AAAA-MM-DDTHH:MM:SS" no fuso `tz`. */
export function utcToLocalIso(d: Date, tz: string): string {
  const p = parts(d, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

export function localDate(d: Date, tz: string): string {
  return utcToLocalIso(d, tz).slice(0, 10);
}

export function localTime(d: Date, tz: string): string {
  return utcToLocalIso(d, tz).slice(11, 16);
}

/** Soma dias a uma data local "AAAA-MM-DD". */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** 0=domingo … 6=sábado para uma data local "AAAA-MM-DD". */
export function weekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** "segunda, 16/11 às 14:00" */
export function formatHuman(d: Date, tz: string): string {
  const date = localDate(d, tz);
  const [, m, day] = date.split("-");
  return `${WEEKDAYS[weekday(date)]}, ${day}/${m} às ${localTime(d, tz)}`;
}

/** "segunda-feira, 16/11/2026, 14:05" — usado no contexto do agente. */
export function formatNow(d: Date, tz: string): string {
  const date = localDate(d, tz);
  const [y, m, day] = date.split("-");
  return `${WEEKDAYS[weekday(date)]}, ${day}/${m}/${y}, ${localTime(d, tz)} (${tz})`;
}
