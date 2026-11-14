import { EventRefs, type AgentContext, type Settings } from "@/lib/agent/context";
import type { Deps } from "@/lib/deps";
import { phoneKey, typedPhoneKey } from "@/lib/phone";
import type {
  Calendar,
  CalendarEvent,
  Contact,
  EventInput,
  MeetingRequest,
  MeetingRequestStatus,
  MessageKind,
  Messenger,
  NewsItem,
  NewsSource,
  SendResult,
  Store,
  StoredMessage,
} from "@/lib/types";

export const TZ = "America/Sao_Paulo";
export const CEO_PHONE = "5511987654321";

export const settings: Settings = {
  tz: TZ,
  workStart: "09:00",
  workEnd: "18:00",
  workDays: [1, 2, 3, 4, 5],
  clientMinNoticeHours: 4,
  ceoName: "Marina",
  companyName: "Empresa Exemplo",
  ceoPhoneKey: typedPhoneKey(CEO_PHONE),
};

export class MemoryStore implements Store {
  contacts: Contact[] = [];
  messages: (StoredMessage & { contactId: string; waMessageId?: string; kind: MessageKind })[] = [];
  requests: MeetingRequest[] = [];
  notifications = new Set<string>();
  sources: NewsSource[] = [];
  news: (NewsItem & { sourceId: string; digested: boolean })[] = [];
  private seq = 0;

  async getContactByPhoneKey(key: string) {
    return this.contacts.find((c) => c.phoneKey === key) ?? null;
  }
  async getContactById(id: string) {
    return this.contacts.find((c) => c.id === id) ?? null;
  }
  async findContacts(query: string) {
    const q = query.toLowerCase();
    return this.contacts.filter((c) => c.name?.toLowerCase().includes(q) || c.phoneKey.includes(q));
  }
  async listContacts() {
    return [...this.contacts];
  }
  async upsertContact(c: Parameters<Store["upsertContact"]>[0]) {
    let existing = this.contacts.find((x) => x.phoneKey === c.phoneKey);
    if (!existing) {
      existing = {
        id: `c${++this.seq}`,
        phoneKey: c.phoneKey,
        waId: c.waId,
        name: null,
        email: null,
        role: "desconhecido",
        notes: null,
        lastInboundAt: null,
      };
      this.contacts.push(existing);
    }
    existing.waId = c.waId;
    if (c.name !== undefined) existing.name = c.name;
    if (c.email !== undefined) existing.email = c.email;
    if (c.role !== undefined) existing.role = c.role;
    if (c.notes !== undefined) existing.notes = c.notes;
    return { ...existing };
  }
  async touchInbound(contactId: string, waId: string, profileName: string | null, at: Date) {
    const c = this.contacts.find((x) => x.id === contactId)!;
    c.waId = waId;
    c.lastInboundAt = at;
    if (!c.name && profileName) c.name = profileName;
  }
  async insertInbound(contactId: string, waMessageId: string, body: string, at: Date) {
    if (this.messages.some((m) => m.waMessageId === waMessageId)) return false;
    this.messages.push({ contactId, waMessageId, role: "user", body, createdAt: at, kind: "chat" });
    return true;
  }
  async insertOutbound(contactId: string, body: string, kind: MessageKind) {
    this.messages.push({ contactId, role: "assistant", body, createdAt: new Date(), kind });
  }
  async recentMessages(contactId: string, limit: number) {
    return this.messages.filter((m) => m.contactId === contactId).slice(-limit);
  }
  async countInboundSince(contactId: string, since: Date) {
    return this.messages.filter((m) => m.contactId === contactId && m.role === "user" && m.createdAt >= since).length;
  }
  async createMeetingRequest(r: Omit<MeetingRequest, "id" | "status" | "createdAt">) {
    const created: MeetingRequest = { ...r, id: this.requests.length + 1, status: "pendente", createdAt: new Date() };
    this.requests.push(created);
    return { ...created };
  }
  async getMeetingRequest(id: number) {
    const r = this.requests.find((x) => x.id === id);
    return r ? { ...r } : null;
  }
  async listMeetingRequests(f: { status?: MeetingRequestStatus; contactId?: string }) {
    return this.requests
      .filter((r) => (!f.status || r.status === f.status) && (!f.contactId || r.contactId === f.contactId))
      .map((r) => ({ ...r }));
  }
  async setMeetingRequestStatus(id: number, status: MeetingRequestStatus) {
    this.requests.find((r) => r.id === id)!.status = status;
  }
  async claimNotification(key: string) {
    if (this.notifications.has(key)) return false;
    this.notifications.add(key);
    return true;
  }
  async releaseNotification(key: string) {
    this.notifications.delete(key);
  }
  async listNewsSources(onlyActive: boolean) {
    return this.sources.filter((s) => !onlyActive || s.active);
  }
  async addNewsSource(name: string, url: string) {
    const s = { id: `s${++this.seq}`, name, url, active: true };
    this.sources.push(s);
    return s;
  }
  async removeNewsSource(id: string) {
    this.sources = this.sources.filter((s) => s.id !== id);
  }
  async sourceHasItems(sourceId: string) {
    return this.news.some((n) => n.sourceId === sourceId);
  }
  async insertNewsItems(
    sourceId: string,
    items: { url: string; title: string; summary?: string | null; publishedAt?: Date | null }[],
    markDigested: boolean,
  ) {
    let added = 0;
    for (const i of items) {
      if (this.news.some((n) => n.url === i.url)) continue;
      added++;
      this.news.push({
        id: `n${++this.seq}`,
        sourceId,
        sourceName: this.sources.find((s) => s.id === sourceId)?.name ?? "",
        url: i.url,
        title: i.title,
        summary: i.summary ?? null,
        publishedAt: i.publishedAt ?? null,
        fetchedAt: new Date(),
        digested: markDigested,
      });
    }
    return added;
  }
  async undigestedNews(limit: number) {
    return this.news.filter((n) => !n.digested).slice(0, limit);
  }
  async markDigested(ids: string[]) {
    for (const n of this.news) if (ids.includes(n.id)) n.digested = true;
  }
  async recentNews(since: Date, limit: number) {
    return this.news.filter((n) => n.fetchedAt >= since).slice(0, limit);
  }
}

export class FakeCalendar implements Calendar {
  events: CalendarEvent[] = [];
  cancelled: string[] = [];
  private seq = 0;

  add(subject: string, start: Date, end: Date, extra: Partial<CalendarEvent> = {}): CalendarEvent {
    const e: CalendarEvent = {
      id: `AAMkAG-evento-com-id-bem-longo-${++this.seq}`,
      subject,
      start,
      end,
      isAllDay: false,
      location: null,
      attendees: [],
      showAs: "busy",
      isCancelled: false,
      onlineUrl: null,
      preview: null,
      ...extra,
    };
    this.events.push(e);
    return e;
  }
  async listEvents(from: Date, to: Date) {
    return this.events
      .filter((e) => e.start < to && e.end > from)
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }
  async createEvent(i: EventInput) {
    return this.add(i.subject, i.start, i.end, {
      location: i.location ?? null,
      showAs: i.showAs ?? "busy",
      attendees: (i.attendees ?? []).map((a) => ({ name: a.name ?? null, email: a.email })),
    });
  }
  async updateEvent(id: string, patch: Partial<EventInput>) {
    const e = this.events.find((x) => x.id === id);
    if (!e) throw new Error("evento não existe");
    if (patch.subject !== undefined) e.subject = patch.subject;
    if (patch.start) e.start = patch.start;
    if (patch.end) e.end = patch.end;
    if (patch.showAs) e.showAs = patch.showAs;
    if (patch.location !== undefined) e.location = patch.location;
    if (patch.attendees) e.attendees = patch.attendees.map((a) => ({ name: a.name ?? null, email: a.email }));
    return e;
  }
  async cancelEvent(id: string) {
    if (!this.events.some((e) => e.id === id)) throw new Error("evento não existe");
    this.events = this.events.filter((e) => e.id !== id);
    this.cancelled.push(id);
  }
}

export class FakeMessenger implements Messenger {
  sent: { to: Contact; text: string; kind: MessageKind }[] = [];
  fail = false;
  constructor(private store: Store) {}
  async send(contact: Contact, text: string, kind: MessageKind): Promise<SendResult> {
    if (this.fail) return { ok: false, via: "none", error: "falha simulada" };
    this.sent.push({ to: contact, text, kind });
    await this.store.insertOutbound(contact.id, text, kind);
    return { ok: true, via: "text" };
  }
  to(contact: Contact) {
    return this.sent.filter((s) => s.to.id === contact.id).map((s) => s.text);
  }
}

export async function world() {
  const store = new MemoryStore();
  const calendar = new FakeCalendar();
  const messenger = new FakeMessenger(store);
  const deps: Deps = { store, calendar, messenger, settings };
  const ceo = await store.upsertContact({ phoneKey: phoneKey(CEO_PHONE), waId: CEO_PHONE, name: "Marina", role: "ceo" });
  const client = await store.upsertContact({
    phoneKey: phoneKey("5521999990000"),
    waId: "5521999990000",
    name: "Rafael Souza",
    email: "rafael@cliente.example",
    role: "cliente",
  });
  const ctxFor = (contact: Contact, now: Date): AgentContext => ({
    ...deps,
    contact,
    now,
    refs: new EventRefs(calendar, now),
  });
  return { store, calendar, messenger, deps, ceo, client, ctxFor };
}

/** Executa uma ferramenta do agente pelo nome e devolve o JSON de resultado. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function callTool(tools: any[], name: string, input: unknown): Promise<any> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`ferramenta ${name} não existe`);
  return JSON.parse(await tool.run(tool.parse(input)));
}
