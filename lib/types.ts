export type ContactRole = "ceo" | "cliente" | "desconhecido" | "bloqueado";

export interface Contact {
  id: string;
  phoneKey: string;
  waId: string;
  name: string | null;
  email: string | null;
  role: ContactRole;
  notes: string | null;
  lastInboundAt: Date | null;
}

export interface StoredMessage {
  role: "user" | "assistant";
  body: string;
  createdAt: Date;
}

export type MessageKind = "chat" | "reminder" | "briefing" | "notification";

export type MeetingRequestStatus = "pendente" | "aprovada" | "recusada" | "cancelada";

export interface MeetingRequest {
  id: number;
  contactId: string;
  subject: string;
  startAt: Date;
  endAt: Date;
  modality: "presencial" | "online";
  holdEventId: string | null;
  status: MeetingRequestStatus;
  createdAt: Date;
}

export interface NewsSource {
  id: string;
  name: string;
  url: string;
  active: boolean;
}

export interface NewsItem {
  id: string;
  sourceName: string;
  url: string;
  title: string;
  summary: string | null;
  publishedAt: Date | null;
  fetchedAt: Date;
}

export interface CalendarEvent {
  id: string;
  subject: string;
  start: Date;
  end: Date;
  isAllDay: boolean;
  location: string | null;
  attendees: { name: string | null; email: string }[];
  /** free | tentative | busy | oof | workingElsewhere | unknown */
  showAs: string;
  isCancelled: boolean;
  onlineUrl: string | null;
  preview: string | null;
}

export interface EventInput {
  subject: string;
  start: Date;
  end: Date;
  location?: string;
  body?: string;
  attendees?: { name?: string; email: string }[];
  online?: boolean;
  showAs?: "busy" | "tentative" | "free";
}

export interface Calendar {
  listEvents(from: Date, to: Date): Promise<CalendarEvent[]>;
  createEvent(input: EventInput): Promise<CalendarEvent>;
  updateEvent(id: string, patch: Partial<EventInput>): Promise<CalendarEvent>;
  /** Cancela (avisando participantes, se houver) ou apaga o evento. */
  cancelEvent(id: string, comment?: string): Promise<void>;
}

export interface SendResult {
  ok: boolean;
  /** "text" dentro da janela de 24h; "template" fora dela. */
  via: "text" | "template" | "none";
  error?: string;
}

export interface Messenger {
  /** Envia respeitando a janela de 24h do WhatsApp e registra no histórico. */
  send(contact: Contact, text: string, kind: MessageKind): Promise<SendResult>;
}

export interface Store {
  getContactByPhoneKey(key: string): Promise<Contact | null>;
  getContactById(id: string): Promise<Contact | null>;
  findContacts(query: string): Promise<Contact[]>;
  listContacts(): Promise<Contact[]>;
  upsertContact(c: {
    phoneKey: string;
    waId: string;
    name?: string | null;
    email?: string | null;
    role?: ContactRole;
    notes?: string | null;
  }): Promise<Contact>;
  touchInbound(contactId: string, waId: string, profileName: string | null, at: Date): Promise<void>;

  /** Retorna false quando a mensagem (wa_message_id) já foi registrada. */
  insertInbound(contactId: string, waMessageId: string, body: string, at: Date): Promise<boolean>;
  insertOutbound(contactId: string, body: string, kind: MessageKind): Promise<void>;
  recentMessages(contactId: string, limit: number): Promise<StoredMessage[]>;
  countInboundSince(contactId: string, since: Date): Promise<number>;

  createMeetingRequest(r: Omit<MeetingRequest, "id" | "status" | "createdAt">): Promise<MeetingRequest>;
  getMeetingRequest(id: number): Promise<MeetingRequest | null>;
  listMeetingRequests(filter: { status?: MeetingRequestStatus; contactId?: string }): Promise<MeetingRequest[]>;
  setMeetingRequestStatus(id: number, status: MeetingRequestStatus): Promise<void>;

  /** Marca uma chave de notificação; false se já existia (idempotência). */
  claimNotification(key: string): Promise<boolean>;
  releaseNotification(key: string): Promise<void>;

  listNewsSources(onlyActive: boolean): Promise<NewsSource[]>;
  addNewsSource(name: string, url: string): Promise<NewsSource>;
  removeNewsSource(id: string): Promise<void>;
  sourceHasItems(sourceId: string): Promise<boolean>;
  /** Insere ignorando URLs repetidas; retorna quantos eram novos. */
  insertNewsItems(
    sourceId: string,
    items: { url: string; title: string; summary?: string | null; publishedAt?: Date | null }[],
    markDigested: boolean,
  ): Promise<number>;
  undigestedNews(limit: number): Promise<NewsItem[]>;
  markDigested(ids: string[]): Promise<void>;
  recentNews(since: Date, limit: number): Promise<NewsItem[]>;
}
