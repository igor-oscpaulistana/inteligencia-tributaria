import { createHash } from "node:crypto";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { formatHuman, utcToLocalIso } from "../time";
import type { Calendar, CalendarEvent, Contact, Messenger, Store } from "../types";

export interface Settings {
  tz: string;
  workStart: string;
  workEnd: string;
  workDays: number[];
  clientMinNoticeHours: number;
  ceoName: string;
  companyName: string;
  /** Chave canônica do telefone do CEO (ver typedPhoneKey). */
  ceoPhoneKey: string;
}

export interface AgentContext {
  store: Store;
  calendar: Calendar;
  messenger: Messenger;
  settings: Settings;
  /** Quem está conversando com o agente neste turno. */
  contact: Contact;
  now: Date;
  refs: EventRefs;
}

const DAY = 86_400_000;

/**
 * Os IDs de evento do Graph têm ~150 caracteres. O modelo trabalha com uma
 * referência curta e estável (hash do ID), resolvida aqui de volta ao ID real.
 */
export class EventRefs {
  private byRef = new Map<string, string>();

  constructor(
    private calendar: Calendar,
    private now: Date,
  ) {}

  refFor(eventId: string): string {
    const ref = createHash("sha256").update(eventId).digest("hex").slice(0, 8);
    this.byRef.set(ref, eventId);
    return ref;
  }

  async resolve(ref: string): Promise<string> {
    const key = ref.trim().toLowerCase();
    const known = this.byRef.get(key);
    if (known) return known;
    // Referência vinda de um turno anterior: reconstrói o índice pela agenda.
    const events = await this.calendar.listEvents(
      new Date(this.now.getTime() - 7 * DAY),
      new Date(this.now.getTime() + 180 * DAY),
    );
    for (const e of events) this.refFor(e.id);
    const found = this.byRef.get(key);
    if (!found) throw new Error(`Compromisso "${ref}" não encontrado. Consulte a agenda para obter a referência.`);
    return found;
  }
}

export function describeEvent(e: CalendarEvent, ctx: Pick<AgentContext, "refs" | "settings">) {
  const tz = ctx.settings.tz;
  return {
    ref: ctx.refs.refFor(e.id),
    assunto: e.subject,
    inicio: utcToLocalIso(e.start, tz).slice(0, 16),
    fim: utcToLocalIso(e.end, tz).slice(0, 16),
    quando: formatHuman(e.start, tz),
    dia_inteiro: e.isAllDay || undefined,
    local: e.location ?? undefined,
    participantes: e.attendees.length ? e.attendees.map((a) => a.name ?? a.email) : undefined,
    link_online: e.onlineUrl ?? undefined,
    situacao: e.showAs === "tentative" ? "a confirmar" : e.showAs === "free" ? "livre" : undefined,
    resumo: e.preview ?? undefined,
  };
}

export function contactLabel(c: Contact): string {
  return c.name ? `${c.name} (+${c.waId})` : `+${c.waId}`;
}

/** Texto curto vindo de terceiros, achatado para citação segura em avisos. */
export function quote(text: string, max = 300): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Define uma ferramenta cujo resultado é JSON e cujos erros voltam ao modelo
 * como texto (em vez de derrubar o turno), para que ele possa se corrigir.
 */
export function defineTool<S extends z.ZodType>(def: {
  name: string;
  description: string;
  inputSchema: S;
  run: (input: z.infer<S>) => Promise<unknown>;
}) {
  return betaZodTool({
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    run: async (input) => {
      try {
        return JSON.stringify(await def.run(input));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[agente] ferramenta ${def.name} falhou: ${message}`);
        return JSON.stringify({ erro: message });
      }
    },
  });
}
