import { config } from "./config";
import { localToUtc, utcToLocalIso } from "./time";
import type { Calendar, CalendarEvent, EventInput } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

const GRAPH = "https://graph.microsoft.com/v1.0";
const SELECT =
  "id,subject,start,end,isAllDay,location,attendees,showAs,isCancelled,onlineMeeting,bodyPreview";

let tokenCache: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;
  const { tenantId, clientId, clientSecret } = config.microsoft();
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Microsoft: falha na autenticação (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return tokenCache.value;
}

/**
 * Agenda do Outlook via Microsoft Graph (fluxo client credentials).
 * Todas as datas trafegam no fuso configurado; a conversão para UTC é local.
 */
export class OutlookCalendar implements Calendar {
  constructor(private tz: string) {}

  private get userPath(): string {
    return `/users/${encodeURIComponent(config.microsoft().calendarUser)}`;
  }

  private async request(method: string, pathOrUrl: string, body?: unknown): Promise<any> {
    const url = pathOrUrl.startsWith("https://") ? pathOrUrl : `${GRAPH}${pathOrUrl}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${await getToken()}`,
        "Content-Type": "application/json",
        Prefer: `outlook.timezone="${this.tz}"`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 204 || res.status === 202) return null;
    const text = await res.text();
    if (!res.ok) {
      let message = text.slice(0, 300);
      try {
        message = JSON.parse(text)?.error?.message ?? message;
      } catch {
        /* resposta não-JSON */
      }
      throw new Error(`Outlook (HTTP ${res.status}): ${message}`);
    }
    return text ? JSON.parse(text) : null;
  }

  private toEvent(e: any): CalendarEvent {
    return {
      id: e.id,
      subject: e.subject || "(sem assunto)",
      start: localToUtc(String(e.start.dateTime).slice(0, 19), this.tz),
      end: localToUtc(String(e.end.dateTime).slice(0, 19), this.tz),
      isAllDay: !!e.isAllDay,
      location: e.location?.displayName || null,
      attendees: (e.attendees ?? [])
        .filter((a: any) => a?.emailAddress?.address)
        .map((a: any) => ({ name: a.emailAddress.name ?? null, email: a.emailAddress.address })),
      showAs: e.showAs ?? "busy",
      isCancelled: !!e.isCancelled,
      onlineUrl: e.onlineMeeting?.joinUrl ?? null,
      preview: e.bodyPreview ? String(e.bodyPreview).slice(0, 300) : null,
    };
  }

  private toPayload(input: Partial<EventInput>): Record<string, unknown> {
    const p: Record<string, unknown> = {};
    if (input.subject !== undefined) p.subject = input.subject;
    if (input.start) p.start = { dateTime: utcToLocalIso(input.start, this.tz), timeZone: this.tz };
    if (input.end) p.end = { dateTime: utcToLocalIso(input.end, this.tz), timeZone: this.tz };
    if (input.location !== undefined) p.location = { displayName: input.location };
    if (input.body !== undefined) p.body = { contentType: "text", content: input.body };
    if (input.attendees !== undefined) {
      p.attendees = input.attendees.map((a) => ({
        emailAddress: { address: a.email, name: a.name ?? a.email },
        type: "required",
      }));
    }
    if (input.online !== undefined) {
      p.isOnlineMeeting = input.online;
      if (input.online) p.onlineMeetingProvider = "teamsForBusiness";
    }
    if (input.showAs !== undefined) p.showAs = input.showAs;
    return p;
  }

  async listEvents(from: Date, to: Date): Promise<CalendarEvent[]> {
    const qs = new URLSearchParams({
      startDateTime: from.toISOString(),
      endDateTime: to.toISOString(),
      $select: SELECT,
      $orderby: "start/dateTime",
      $top: "100",
    });
    const events: CalendarEvent[] = [];
    let next: string | null = `${this.userPath}/calendar/calendarView?${qs}`;
    for (let page = 0; next && page < 5; page++) {
      const json: any = await this.request("GET", next);
      for (const e of json?.value ?? []) events.push(this.toEvent(e));
      next = json?.["@odata.nextLink"] ?? null;
    }
    return events.filter((e) => !e.isCancelled);
  }

  async createEvent(input: EventInput): Promise<CalendarEvent> {
    return this.toEvent(await this.request("POST", `${this.userPath}/calendar/events`, this.toPayload(input)));
  }

  async updateEvent(id: string, patch: Partial<EventInput>): Promise<CalendarEvent> {
    return this.toEvent(
      await this.request("PATCH", `${this.userPath}/events/${encodeURIComponent(id)}`, this.toPayload(patch)),
    );
  }

  async cancelEvent(id: string, comment?: string): Promise<void> {
    const path = `${this.userPath}/events/${encodeURIComponent(id)}`;
    const event = await this.request("GET", `${path}?$select=id,attendees,isOrganizer`);
    if (event?.isOrganizer && (event.attendees ?? []).length > 0) {
      // Com participantes: cancela enviando o aviso de cancelamento.
      await this.request("POST", `${path}/cancel`, { comment: comment ?? "" });
    } else {
      await this.request("DELETE", path);
    }
  }
}
