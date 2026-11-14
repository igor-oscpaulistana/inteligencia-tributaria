import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { Deps } from "./deps";
import { getCeo } from "./meetings";
import { composeDigest } from "./news";
import { addDays, formatHuman, localDate, localTime, localToUtc } from "./time";
import type { CalendarEvent } from "./types";

export const HOLD_PREFIX = "[A confirmar]";

export interface DueReminder {
  event: CalendarEvent;
  lead: number;
  key: string;
}

/**
 * Lembretes devidos agora. Para cada compromisso futuro escolhe a menor
 * antecedência já atingida, de modo que um evento criado em cima da hora
 * gera um único lembrete (e não um para cada antecedência configurada).
 */
export function pickReminders(events: CalendarEvent[], now: Date, leads: number[]): DueReminder[] {
  const due: DueReminder[] = [];
  for (const event of events) {
    if (event.isAllDay || event.isCancelled || event.showAs === "free") continue;
    if (event.subject.startsWith(HOLD_PREFIX)) continue;
    const minutesLeft = (event.start.getTime() - now.getTime()) / 60_000;
    if (minutesLeft <= 0) continue;
    const reached = leads.filter((l) => minutesLeft <= l);
    if (reached.length === 0) continue;
    const lead = Math.min(...reached);
    const hash = createHash("sha256").update(`${event.id}|${event.start.toISOString()}`).digest("hex").slice(0, 20);
    due.push({ event, lead, key: `lembrete:${hash}:${lead}` });
  }
  return due;
}

function eventLine(e: CalendarEvent, tz: string): string {
  const time = e.isAllDay ? "dia todo" : `${localTime(e.start, tz)}–${localTime(e.end, tz)}`;
  const extras = [e.location, e.onlineUrl ? "online" : null, e.showAs === "tentative" ? "a confirmar" : null]
    .filter(Boolean)
    .join(", ");
  return `• *${time}* ${e.subject}${extras ? ` (${extras})` : ""}`;
}

export function reminderText(r: DueReminder, now: Date, tz: string): string {
  const minutes = Math.max(1, Math.round((r.event.start.getTime() - now.getTime()) / 60_000));
  const lines = [`⏰ *Em ${minutes} min:* ${r.event.subject}`, `Horário: ${formatHuman(r.event.start, tz)}`];
  if (r.event.location) lines.push(`Local: ${r.event.location}`);
  if (r.event.attendees.length) {
    lines.push(`Com: ${r.event.attendees.slice(0, 5).map((a) => a.name ?? a.email).join(", ")}`);
  }
  if (r.event.onlineUrl) lines.push(`Link: ${r.event.onlineUrl}`);
  return lines.join("\n");
}

/** true entre `hhmm` e 3 horas depois, no fuso local. */
export function inWindow(now: Date, hhmm: string, tz: string): boolean {
  const target = localToUtc(`${localDate(now, tz)}T${hhmm}`, tz).getTime();
  return now.getTime() >= target && now.getTime() < target + 3 * 3_600_000;
}

export interface TickOptions {
  leads: number[];
  briefingTime: string;
  newsDigestTime: string | null;
  newsFocus: string;
  anthropic: () => Anthropic;
}

export interface TickResult {
  lembretes: number;
  briefing: boolean;
  noticias: boolean;
  erros: string[];
}

/** Uma passada do agendador: lembretes, agenda do dia e resumo de notícias. */
export async function runTick(deps: Deps, now: Date, opts: TickOptions): Promise<TickResult> {
  const { store, calendar, messenger, settings } = deps;
  const tz = settings.tz;
  const result: TickResult = { lembretes: 0, briefing: false, noticias: false, erros: [] };
  const ceo = await getCeo(store, settings.ceoPhoneKey);

  /** Reivindica a chave, envia e devolve a chave se o envio falhar. */
  const sendOnce = async (key: string, build: () => Promise<string | null>, kind: "reminder" | "briefing") => {
    if (!(await store.claimNotification(key))) return false;
    try {
      const text = await build();
      if (text === null) return false; // nada a enviar; a chave fica marcada
      const sent = await messenger.send(ceo, text, kind);
      if (!sent.ok) throw new Error(sent.error ?? "envio falhou");
      return true;
    } catch (err) {
      await store.releaseNotification(key);
      result.erros.push(`${key}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  };

  const digest = async (): Promise<string | null> => {
    const items = await store.undigestedNews(40);
    const text = await composeDigest(opts.anthropic(), items, opts.newsFocus);
    await store.markDigested(items.map((i) => i.id));
    return text;
  };

  // 1. Lembretes de compromissos próximos.
  try {
    const horizon = new Date(now.getTime() + (Math.max(0, ...opts.leads) + 1) * 60_000);
    const events = await calendar.listEvents(now, horizon);
    for (const r of pickReminders(events, now, opts.leads)) {
      if (await sendOnce(r.key, async () => reminderText(r, now, tz), "reminder")) result.lembretes++;
    }
  } catch (err) {
    result.erros.push(`lembretes: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2. Agenda do dia + notícias, uma vez por dia.
  const today = localDate(now, tz);
  if (inWindow(now, opts.briefingTime, tz)) {
    result.briefing = await sendOnce(
      `briefing:${today}`,
      async () => {
        const dayStart = localToUtc(`${today}T00:00`, tz);
        const dayEnd = localToUtc(`${addDays(today, 1)}T00:00`, tz);
        const events = (await calendar.listEvents(dayStart, dayEnd)).filter((e) => e.start < dayEnd && e.end > dayStart);
        const pending = await store.listMeetingRequests({ status: "pendente" });
        const [, m, d] = today.split("-");
        const parts = [
          `☀️ *Bom dia! Agenda de hoje (${d}/${m})*`,
          events.length ? events.map((e) => eventLine(e, tz)).join("\n") : "Nenhum compromisso na agenda.",
        ];
        if (pending.length) {
          parts.push(`Há ${pending.length} pedido(s) de reunião aguardando sua decisão. Responda "pedidos" para ver.`);
        }
        const news = await digest().catch(() => null);
        if (news) parts.push(news);
        return parts.join("\n\n");
      },
      "briefing",
    );
  }

  // 3. Resumo extra de notícias (só se houver novidades).
  if (opts.newsDigestTime && inWindow(now, opts.newsDigestTime, tz)) {
    result.noticias = await sendOnce(`noticias:${today}`, digest, "briefing");
  }

  return result;
}
