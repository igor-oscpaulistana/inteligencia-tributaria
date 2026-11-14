import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "./config";
import type {
  Contact,
  ContactRole,
  MeetingRequest,
  MeetingRequestStatus,
  MessageKind,
  NewsItem,
  NewsSource,
  Store,
  StoredMessage,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const toDate = (v: string | null): Date | null => (v ? new Date(v) : null);

function contactFromRow(r: Row): Contact {
  return {
    id: r.id,
    phoneKey: r.phone_key,
    waId: r.wa_id,
    name: r.name,
    email: r.email,
    role: r.role as ContactRole,
    notes: r.notes,
    lastInboundAt: toDate(r.last_inbound_at),
  };
}

function requestFromRow(r: Row): MeetingRequest {
  return {
    id: Number(r.id),
    contactId: r.contact_id,
    subject: r.subject,
    startAt: new Date(r.start_at),
    endAt: new Date(r.end_at),
    modality: r.modality,
    holdEventId: r.hold_event_id,
    status: r.status as MeetingRequestStatus,
    createdAt: new Date(r.created_at),
  };
}

function newsFromRow(r: Row): NewsItem {
  return {
    id: r.id,
    sourceName: r.news_sources?.name ?? "",
    url: r.url,
    title: r.title,
    summary: r.summary,
    publishedAt: toDate(r.published_at),
    fetchedAt: new Date(r.fetched_at),
  };
}

function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Supabase (${what}): ${res.error.message}`);
  return res.data;
}

export class SupabaseStore implements Store {
  constructor(private db: SupabaseClient) {}

  async getContactByPhoneKey(key: string) {
    const r = check(await this.db.from("contacts").select("*").eq("phone_key", key).maybeSingle(), "contato");
    return r ? contactFromRow(r) : null;
  }

  async getContactById(id: string) {
    const r = check(await this.db.from("contacts").select("*").eq("id", id).maybeSingle(), "contato");
    return r ? contactFromRow(r) : null;
  }

  async findContacts(query: string) {
    const digits = query.replace(/\D/g, "");
    // Evita que vírgulas/parênteses do texto alterem o filtro `or` do PostgREST.
    const safe = query.replace(/[,()%*\\":]/g, " ").trim();
    const filters = [`name.ilike.%${safe}%`, `email.ilike.%${safe}%`];
    if (digits.length >= 4) filters.push(`phone_key.ilike.%${digits.slice(-8)}%`);
    const rows = check(await this.db.from("contacts").select("*").or(filters.join(",")).limit(10), "busca de contatos");
    return (rows ?? []).map(contactFromRow);
  }

  async listContacts() {
    const rows = check(await this.db.from("contacts").select("*").order("name").limit(200), "contatos");
    return (rows ?? []).map(contactFromRow);
  }

  async upsertContact(c: Parameters<Store["upsertContact"]>[0]) {
    const row: Row = { phone_key: c.phoneKey, wa_id: c.waId };
    if (c.name !== undefined) row.name = c.name;
    if (c.email !== undefined) row.email = c.email;
    if (c.role !== undefined) row.role = c.role;
    if (c.notes !== undefined) row.notes = c.notes;
    const r = check(
      await this.db.from("contacts").upsert(row, { onConflict: "phone_key" }).select("*").single(),
      "salvar contato",
    );
    return contactFromRow(r);
  }

  async touchInbound(contactId: string, waId: string, profileName: string | null, at: Date) {
    check(
      await this.db.from("contacts").update({ wa_id: waId, last_inbound_at: at.toISOString() }).eq("id", contactId),
      "atualizar contato",
    );
    if (profileName) {
      // Só preenche o nome do perfil se ainda não houver um nome cadastrado.
      check(
        await this.db.from("contacts").update({ name: profileName }).eq("id", contactId).is("name", null),
        "nome do contato",
      );
    }
  }

  async insertInbound(contactId: string, waMessageId: string, body: string, at: Date) {
    const res = await this.db.from("messages").insert({
      contact_id: contactId,
      role: "user",
      kind: "chat",
      body,
      wa_message_id: waMessageId,
      created_at: at.toISOString(),
    });
    if (res.error) {
      if (res.error.code === "23505") return false; // reentrega do webhook
      throw new Error(`Supabase (mensagem recebida): ${res.error.message}`);
    }
    return true;
  }

  async insertOutbound(contactId: string, body: string, kind: MessageKind) {
    check(
      await this.db.from("messages").insert({ contact_id: contactId, role: "assistant", kind, body }),
      "mensagem enviada",
    );
  }

  async recentMessages(contactId: string, limit: number): Promise<StoredMessage[]> {
    const rows = check(
      await this.db
        .from("messages")
        .select("role, body, created_at")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit),
      "histórico",
    );
    return (rows ?? [])
      .map((r: Row) => ({ role: r.role, body: r.body, createdAt: new Date(r.created_at) }))
      .reverse();
  }

  async countInboundSince(contactId: string, since: Date) {
    const res = await this.db
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("contact_id", contactId)
      .eq("role", "user")
      .gte("created_at", since.toISOString());
    if (res.error) throw new Error(`Supabase (contagem): ${res.error.message}`);
    return res.count ?? 0;
  }

  async createMeetingRequest(r: Omit<MeetingRequest, "id" | "status" | "createdAt">) {
    const row = check(
      await this.db
        .from("meeting_requests")
        .insert({
          contact_id: r.contactId,
          subject: r.subject,
          start_at: r.startAt.toISOString(),
          end_at: r.endAt.toISOString(),
          modality: r.modality,
          hold_event_id: r.holdEventId,
        })
        .select("*")
        .single(),
      "criar solicitação",
    );
    return requestFromRow(row);
  }

  async getMeetingRequest(id: number) {
    const r = check(await this.db.from("meeting_requests").select("*").eq("id", id).maybeSingle(), "solicitação");
    return r ? requestFromRow(r) : null;
  }

  async listMeetingRequests(filter: { status?: MeetingRequestStatus; contactId?: string }) {
    let q = this.db.from("meeting_requests").select("*").order("start_at").limit(50);
    if (filter.status) q = q.eq("status", filter.status);
    if (filter.contactId) q = q.eq("contact_id", filter.contactId);
    return (check(await q, "solicitações") ?? []).map(requestFromRow);
  }

  async setMeetingRequestStatus(id: number, status: MeetingRequestStatus) {
    check(await this.db.from("meeting_requests").update({ status }).eq("id", id), "status da solicitação");
  }

  async claimNotification(key: string) {
    const res = await this.db.from("sent_notifications").insert({ key });
    if (res.error) {
      if (res.error.code === "23505") return false;
      throw new Error(`Supabase (notificação): ${res.error.message}`);
    }
    return true;
  }

  async releaseNotification(key: string) {
    check(await this.db.from("sent_notifications").delete().eq("key", key), "liberar notificação");
  }

  async listNewsSources(onlyActive: boolean): Promise<NewsSource[]> {
    let q = this.db.from("news_sources").select("id, name, url, active").order("name");
    if (onlyActive) q = q.eq("active", true);
    return (check(await q, "fontes") ?? []) as NewsSource[];
  }

  async addNewsSource(name: string, url: string): Promise<NewsSource> {
    const r = check(
      await this.db
        .from("news_sources")
        .upsert({ name, url, active: true }, { onConflict: "url" })
        .select("id, name, url, active")
        .single(),
      "adicionar fonte",
    );
    return r as NewsSource;
  }

  async removeNewsSource(id: string) {
    check(await this.db.from("news_sources").delete().eq("id", id), "remover fonte");
  }

  async sourceHasItems(sourceId: string) {
    const res = await this.db
      .from("news_items")
      .select("id", { count: "exact", head: true })
      .eq("source_id", sourceId);
    if (res.error) throw new Error(`Supabase (itens da fonte): ${res.error.message}`);
    return (res.count ?? 0) > 0;
  }

  async insertNewsItems(
    sourceId: string,
    items: { url: string; title: string; summary?: string | null; publishedAt?: Date | null }[],
    markDigested: boolean,
  ) {
    if (items.length === 0) return 0;
    const now = new Date().toISOString();
    const rows = items.map((i) => ({
      source_id: sourceId,
      url: i.url,
      title: i.title,
      summary: i.summary ?? null,
      published_at: i.publishedAt ? i.publishedAt.toISOString() : null,
      digested_at: markDigested ? now : null,
    }));
    const inserted = check(
      await this.db.from("news_items").upsert(rows, { onConflict: "url", ignoreDuplicates: true }).select("id"),
      "inserir notícias",
    );
    return inserted?.length ?? 0;
  }

  async undigestedNews(limit: number) {
    const rows = check(
      await this.db
        .from("news_items")
        .select("id, url, title, summary, published_at, fetched_at, news_sources(name)")
        .is("digested_at", null)
        .order("fetched_at", { ascending: false })
        .limit(limit),
      "notícias pendentes",
    );
    return (rows ?? []).map(newsFromRow);
  }

  async markDigested(ids: string[]) {
    if (ids.length === 0) return;
    check(
      await this.db.from("news_items").update({ digested_at: new Date().toISOString() }).in("id", ids),
      "marcar notícias",
    );
  }

  async recentNews(since: Date, limit: number) {
    const rows = check(
      await this.db
        .from("news_items")
        .select("id, url, title, summary, published_at, fetched_at, news_sources(name)")
        .gte("fetched_at", since.toISOString())
        .order("fetched_at", { ascending: false })
        .limit(limit),
      "notícias recentes",
    );
    return (rows ?? []).map(newsFromRow);
  }
}

let cached: SupabaseStore | null = null;

export function getStore(): SupabaseStore {
  if (!cached) {
    const { url, serviceRoleKey } = config.supabase();
    cached = new SupabaseStore(createClient(url, serviceRoleKey, { auth: { persistSession: false } }));
  }
  return cached;
}
