import { EventRefs, contactLabel, type AgentContext } from "./agent/context";
import type { Deps } from "./deps";
import { phoneKey } from "./phone";
import type { Contact, StoredMessage } from "./types";
import type { InboundMessage } from "./whatsapp";

export type AgentRunner = (ctx: AgentContext, history: StoredMessage[]) => Promise<string>;

export interface InboundOptions {
  allowUnknown: boolean;
  runAgent: AgentRunner;
  now?: Date;
  historySize?: number;
  /** Limite de mensagens por hora para quem não é o CEO (controle de custo e abuso). */
  maxPerHour?: number;
}

export type InboundOutcome =
  | "respondido"
  | "duplicada"
  | "bloqueado"
  | "desconhecido_ignorado"
  | "limite_excedido"
  | "tipo_nao_suportado"
  | "erro";

/** Processa uma mensagem recebida do WhatsApp do início ao fim. */
export async function handleInbound(msg: InboundMessage, deps: Deps, opts: InboundOptions): Promise<InboundOutcome> {
  const { store, messenger, settings } = deps;
  const now = opts.now ?? new Date();
  const key = phoneKey(msg.from);
  const isCeo = key === settings.ceoPhoneKey;

  let contact = await store.getContactByPhoneKey(key);
  const isNew = !contact;
  if (!contact) {
    contact = await store.upsertContact({
      phoneKey: key,
      waId: msg.from,
      name: isCeo ? settings.ceoName : msg.profileName,
      role: isCeo ? "ceo" : "desconhecido",
    });
  } else if (isCeo && contact.role !== "ceo") {
    contact = await store.upsertContact({ phoneKey: key, waId: msg.from, role: "ceo" });
  } else if (!isCeo && contact.role === "ceo") {
    // O número do CEO mudou na configuração: o antigo perde o acesso.
    contact = await store.upsertContact({ phoneKey: key, waId: msg.from, role: "desconhecido" });
  }

  const body = msg.text ?? `[mensagem do tipo "${msg.type}", sem texto]`;
  if (!(await store.insertInbound(contact.id, msg.waMessageId, body, msg.timestamp))) return "duplicada";
  await store.touchInbound(contact.id, msg.from, msg.profileName, now);
  const current: Contact = { ...contact, waId: msg.from, name: contact.name ?? msg.profileName, lastInboundAt: now };

  if (current.role === "bloqueado") return "bloqueado";
  if (current.role === "desconhecido" && !opts.allowUnknown) return "desconhecido_ignorado";

  if (current.role !== "ceo") {
    const recent = await store.countInboundSince(current.id, new Date(now.getTime() - 3_600_000));
    if (recent > (opts.maxPerHour ?? 40)) return "limite_excedido";
  }

  if (isNew && current.role === "desconhecido") {
    const ceo = await store.getContactByPhoneKey(settings.ceoPhoneKey);
    if (ceo) {
      await messenger.send(
        ceo,
        `👤 Novo contato escreveu para o assistente: ${contactLabel(current)}. Ele será atendido com acesso restrito (horários livres e recados). Para cadastrar como cliente ou bloquear, é só me pedir.`,
        "notification",
      );
    }
  }

  if (msg.text === null) {
    await messenger.send(
      current,
      "Por enquanto só consigo ler mensagens de texto. Pode escrever o que precisa?",
      "chat",
    );
    return "tipo_nao_suportado";
  }

  try {
    const history = await store.recentMessages(current.id, opts.historySize ?? 30);
    const reply = await opts.runAgent(
      { ...deps, contact: current, now, refs: new EventRefs(deps.calendar, now) },
      history,
    );
    await messenger.send(current, reply, "chat");
    return "respondido";
  } catch (err) {
    console.error(`[inbound] erro ao atender contato ${current.id}:`, err);
    await messenger.send(
      current,
      "Tive um problema técnico ao processar sua mensagem. Pode tentar de novo em instantes?",
      "chat",
    );
    return "erro";
  }
}
