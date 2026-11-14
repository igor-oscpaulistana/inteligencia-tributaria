import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config";
import { toWaId } from "./phone";
import type { Contact, MessageKind, Messenger, SendResult, Store } from "./types";

/** Valida o cabeçalho X-Hub-Signature-256 enviado pela Meta. */
export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  let received: Buffer;
  try {
    received = Buffer.from(header.slice(7), "hex");
  } catch {
    return false;
  }
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export interface InboundMessage {
  from: string;
  waMessageId: string;
  profileName: string | null;
  /** null quando o tipo não é texto (áudio, imagem, figurinha…). */
  text: string | null;
  type: string;
  timestamp: Date;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Extrai as mensagens recebidas do payload do webhook (ignora status de entrega). */
export function parseWebhook(payload: any): InboundMessage[] {
  const out: InboundMessage[] = [];
  if (payload?.object !== "whatsapp_business_account") return out;
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change?.value;
      if (change?.field !== "messages" || !Array.isArray(value?.messages)) continue;
      const names = new Map<string, string>();
      for (const c of value.contacts ?? []) {
        if (c?.wa_id && c?.profile?.name) names.set(String(c.wa_id), String(c.profile.name));
      }
      for (const m of value.messages) {
        if (!m?.from || !m?.id) continue;
        let text: string | null = null;
        if (m.type === "text") text = m.text?.body ?? null;
        else if (m.type === "button") text = m.button?.text ?? null;
        else if (m.type === "interactive") {
          text = m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null;
        }
        const ts = Number(m.timestamp);
        out.push({
          from: String(m.from),
          waMessageId: String(m.id),
          profileName: names.get(String(m.from)) ?? null,
          text: text && text.trim() ? text.trim() : null,
          type: String(m.type ?? "unknown"),
          timestamp: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date(),
        });
      }
    }
  }
  return out;
}

const MAX_TEXT = 4000; // o limite da API é 4096

/** Divide textos longos em blocos, preferindo quebrar em parágrafos. */
export function chunkText(text: string, max = MAX_TEXT): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n\n", max);
    if (cut < max * 0.5) cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(" ", max);
    if (cut < max * 0.5) cut = max;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/** Variáveis de template não aceitam quebras de linha, tabs nem 5+ espaços. */
export function templateParam(text: string): string {
  const flat = text.replace(/\s*\n+\s*/g, " | ").replace(/\t/g, " ").replace(/ {2,}/g, " ").trim();
  return flat.length > 1000 ? `${flat.slice(0, 997)}...` : flat;
}

const WINDOW_MS = 24 * 60 * 60 * 1000;

export function insideServiceWindow(lastInboundAt: Date | null, now: Date): boolean {
  // Margem de 2 minutos para não disputar com o relógio da Meta.
  return !!lastInboundAt && now.getTime() - lastInboundAt.getTime() < WINDOW_MS - 120_000;
}

async function post(body: unknown): Promise<{ ok: boolean; error?: string }> {
  const { accessToken, phoneNumberId, graphVersion } = config.whatsapp();
  try {
    const res = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return { ok: true };
    const detail = await res.text();
    return { ok: false, error: `HTTP ${res.status}: ${detail.slice(0, 300)}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function sendText(to: string, text: string): Promise<{ ok: boolean; error?: string }> {
  for (const chunk of chunkText(text)) {
    const r = await post({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: toWaId(to),
      type: "text",
      text: { body: chunk, preview_url: false },
    });
    if (!r.ok) return r;
  }
  return { ok: true };
}

export async function sendTemplate(to: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const { templateName, templateLang } = config.whatsapp();
  if (!templateName) {
    return { ok: false, error: "janela de 24h fechada e WHATSAPP_TEMPLATE_NAME não configurado" };
  }
  return post({
    messaging_product: "whatsapp",
    to: toWaId(to),
    type: "template",
    template: {
      name: templateName,
      language: { code: templateLang },
      components: [{ type: "body", parameters: [{ type: "text", text: templateParam(text) }] }],
    },
  });
}

export async function markRead(waMessageId: string): Promise<void> {
  await post({ messaging_product: "whatsapp", status: "read", message_id: waMessageId });
}

/**
 * Envia pelo WhatsApp escolhendo texto livre (janela de 24h aberta) ou o
 * template aprovado (janela fechada), e registra a mensagem no histórico.
 */
export class WhatsAppMessenger implements Messenger {
  constructor(
    private store: Store,
    private now: () => Date = () => new Date(),
  ) {}

  async send(contact: Contact, text: string, kind: MessageKind): Promise<SendResult> {
    const open = insideServiceWindow(contact.lastInboundAt, this.now());
    const result = open ? await sendText(contact.waId, text) : await sendTemplate(contact.waId, text);
    if (!result.ok) {
      console.error(`[whatsapp] falha ao enviar para contato ${contact.id}: ${result.error}`);
      return { ok: false, via: "none", error: result.error };
    }
    await this.store.insertOutbound(contact.id, text, kind);
    return { ok: true, via: open ? "text" : "template" };
  }
}
