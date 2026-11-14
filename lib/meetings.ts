import { contactLabel, quote, type AgentContext } from "./agent/context";
import { freeSlots } from "./slots";
import { formatHuman } from "./time";
import type { Contact, MeetingRequest, Store } from "./types";

const DAY = 86_400_000;
export const MAX_PENDING_PER_CONTACT = 2;

export async function getCeo(store: Store, ceoPhoneKey: string): Promise<Contact> {
  const ceo = await store.getContactByPhoneKey(ceoPhoneKey);
  if (!ceo) throw new Error("Contato do CEO ainda não registrado (ele precisa enviar a primeira mensagem).");
  return ceo;
}

/** Horários livres para um cliente: só expediente e com antecedência mínima. */
export async function clientSlots(
  ctx: Pick<AgentContext, "calendar" | "settings" | "now">,
  from: Date,
  to: Date,
  durationMin: number,
): Promise<Date[]> {
  const s = ctx.settings;
  const start = new Date(Math.max(from.getTime(), ctx.now.getTime()));
  const end = new Date(Math.min(to.getTime(), ctx.now.getTime() + 45 * DAY));
  if (end <= start) return [];
  const events = await ctx.calendar.listEvents(start, end);
  return freeSlots({
    events,
    from: start,
    to: end,
    durationMin,
    tz: s.tz,
    workStart: s.workStart,
    workEnd: s.workEnd,
    workDays: s.workDays,
    notBefore: new Date(ctx.now.getTime() + s.clientMinNoticeHours * 3_600_000),
  });
}

/**
 * Registra o pedido de reunião de um cliente: reserva o horário como
 * "a confirmar" na agenda e avisa o CEO, que aprova ou recusa.
 */
export async function requestMeeting(
  ctx: AgentContext,
  input: { start: Date; durationMin: number; subject: string; modality: "presencial" | "online" },
): Promise<MeetingRequest> {
  const { store, calendar, messenger, settings, contact } = ctx;
  const end = new Date(input.start.getTime() + input.durationMin * 60_000);

  const pending = await store.listMeetingRequests({ status: "pendente", contactId: contact.id });
  if (pending.length >= MAX_PENDING_PER_CONTACT) {
    throw new Error(
      `Este contato já tem ${pending.length} pedidos aguardando confirmação. É preciso aguardar a resposta ou cancelar um deles.`,
    );
  }

  const available = await clientSlots(ctx, input.start, end, input.durationMin);
  if (!available.some((d) => d.getTime() === input.start.getTime())) {
    throw new Error("Esse horário não está disponível. Consulte os horários livres e ofereça outra opção.");
  }

  const who = contact.name ?? `+${contact.waId}`;
  const subject = quote(input.subject, 120);
  const hold = await calendar.createEvent({
    subject: `[A confirmar] ${who} — ${subject}`,
    start: input.start,
    end,
    showAs: "tentative",
    body: `Pedido de reunião recebido pelo WhatsApp de ${contactLabel(contact)}. Modalidade: ${input.modality}. Aguardando aprovação.`,
  });

  const request = await store.createMeetingRequest({
    contactId: contact.id,
    subject,
    startAt: input.start,
    endAt: end,
    modality: input.modality,
    holdEventId: hold.id,
  });

  const ceo = await getCeo(store, settings.ceoPhoneKey);
  await messenger.send(
    ceo,
    [
      `📅 *Pedido de reunião nº ${request.id}*`,
      `De: ${contactLabel(contact)}${contact.role === "desconhecido" ? " — contato não cadastrado" : ""}`,
      `Quando: ${formatHuman(input.start, settings.tz)} (${input.durationMin} min, ${input.modality})`,
      `Assunto informado: "${subject}"`,
      "",
      `Deixei o horário reservado como "a confirmar". Responda *aprovar ${request.id}* ou *recusar ${request.id}*.`,
    ].join("\n"),
    "notification",
  );
  return request;
}

/** Decisão do CEO sobre um pedido pendente; avisa o cliente do resultado. */
export async function decideRequest(
  ctx: AgentContext,
  id: number,
  approve: boolean,
  noteToClient?: string,
): Promise<{ request: MeetingRequest; clientNotified: boolean; notifyError?: string }> {
  const { store, calendar, messenger, settings } = ctx;
  const request = await store.getMeetingRequest(id);
  if (!request) throw new Error(`Pedido nº ${id} não existe.`);
  if (request.status !== "pendente") throw new Error(`Pedido nº ${id} já está "${request.status}".`);
  const client = await store.getContactById(request.contactId);
  if (!client) throw new Error("Contato do pedido não encontrado.");

  const when = formatHuman(request.startAt, settings.tz);
  let text: string;
  if (approve) {
    if (request.holdEventId) {
      await calendar.updateEvent(request.holdEventId, {
        subject: `Reunião com ${client.name ?? `+${client.waId}`} — ${request.subject}`,
        showAs: "busy",
        online: request.modality === "online" ? true : undefined,
        attendees: client.email ? [{ name: client.name ?? undefined, email: client.email }] : undefined,
        body: `Reunião confirmada pelo WhatsApp com ${contactLabel(client)}. Modalidade: ${request.modality}.`,
      });
    }
    await store.setMeetingRequestStatus(id, "aprovada");
    text = `✅ Sua reunião com ${settings.ceoName} está confirmada para ${when} (${request.modality}).`;
  } else {
    if (request.holdEventId) await calendar.cancelEvent(request.holdEventId);
    await store.setMeetingRequestStatus(id, "recusada");
    text = `Infelizmente ${settings.ceoName} não poderá atender em ${when}. Se quiser, posso verificar outros horários.`;
  }
  if (noteToClient?.trim()) text += `\n\n${noteToClient.trim()}`;

  const sent = await messenger.send(client, text, "notification");
  return {
    request: { ...request, status: approve ? "aprovada" : "recusada" },
    clientNotified: sent.ok,
    notifyError: sent.error,
  };
}

/** Cancelamento pelo próprio cliente; libera a agenda e avisa o CEO. */
export async function cancelOwnRequest(ctx: AgentContext, id: number): Promise<MeetingRequest> {
  const { store, calendar, messenger, settings, contact } = ctx;
  const request = await store.getMeetingRequest(id);
  if (!request || request.contactId !== contact.id) throw new Error(`Pedido nº ${id} não encontrado para este contato.`);
  if (request.status !== "pendente" && request.status !== "aprovada") {
    throw new Error(`Pedido nº ${id} já está "${request.status}".`);
  }
  if (request.holdEventId) await calendar.cancelEvent(request.holdEventId, "Cancelado pelo cliente via WhatsApp.");
  await store.setMeetingRequestStatus(id, "cancelada");
  const ceo = await getCeo(store, settings.ceoPhoneKey);
  await messenger.send(
    ceo,
    `ℹ️ ${contactLabel(contact)} cancelou a reunião de ${formatHuman(request.startAt, settings.tz)} (pedido nº ${id}, antes "${request.status}"). O horário foi liberado na agenda.`,
    "notification",
  );
  return { ...request, status: "cancelada" };
}
