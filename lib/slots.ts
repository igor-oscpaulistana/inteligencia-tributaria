import { addDays, localDate, localToUtc, weekday } from "./time";
import type { CalendarEvent } from "./types";

export interface SlotOptions {
  events: Pick<CalendarEvent, "start" | "end" | "showAs" | "isCancelled">[];
  from: Date;
  to: Date;
  durationMin: number;
  tz: string;
  workStart: string; // "09:00"
  workEnd: string; // "18:00"
  workDays: number[]; // 0=domingo … 6=sábado
  /** Nenhum horário antes deste instante (antecedência mínima). */
  notBefore: Date;
  stepMin?: number;
  limit?: number;
}

/** Horários de início livres dentro do expediente, sem expor os compromissos. */
export function freeSlots(o: SlotOptions): Date[] {
  const step = (o.stepMin ?? 30) * 60_000;
  const duration = o.durationMin * 60_000;
  const limit = o.limit ?? 40;
  const busy = o.events
    .filter((e) => !e.isCancelled && e.showAs !== "free")
    .map((e) => [e.start.getTime(), e.end.getTime()] as const);

  const slots: Date[] = [];
  const lastDay = localDate(o.to, o.tz);
  for (let day = localDate(o.from, o.tz); day <= lastDay && slots.length < limit; day = addDays(day, 1)) {
    if (!o.workDays.includes(weekday(day))) continue;
    const open = localToUtc(`${day}T${o.workStart}`, o.tz).getTime();
    const close = localToUtc(`${day}T${o.workEnd}`, o.tz).getTime();
    for (let t = open; t + duration <= close && slots.length < limit; t += step) {
      if (t < o.notBefore.getTime() || t < o.from.getTime() || t + duration > o.to.getTime()) continue;
      const end = t + duration;
      if (busy.some(([s, e]) => s < end && e > t)) continue;
      slots.push(new Date(t));
    }
  }
  return slots;
}
