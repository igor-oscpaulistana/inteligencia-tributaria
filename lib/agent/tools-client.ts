import { z } from "zod";
import { cancelOwnRequest, clientSlots, getCeo, requestMeeting } from "../meetings";
import { formatHuman, parseDateTime, utcToLocalIso } from "../time";
import { contactLabel, defineTool, quote, type AgentContext } from "./context";

/**
 * Ferramentas disponíveis para clientes e contatos não cadastrados.
 * O limite do que um cliente pode fazer é imposto aqui, no código: nenhuma
 * destas ferramentas lê detalhes da agenda nem altera compromissos de terceiros.
 */
export function clientTools(ctx: AgentContext) {
  const { store, messenger, settings } = ctx;
  const tz = settings.tz;

  return [
    defineTool({
      name: "consultar_horarios_livres",
      description:
        "Retorna horários de início disponíveis para uma reunião, dentro do expediente e respeitando a antecedência mínima. Não revela os compromissos existentes.",
      inputSchema: z.object({
        inicio: z.string().describe("Início do intervalo, hora local AAAA-MM-DDTHH:MM"),
        fim: z.string().describe("Fim do intervalo, hora local AAAA-MM-DDTHH:MM"),
        duracao_min: z.number().int().min(15).max(120),
      }),
      run: async ({ inicio, fim, duracao_min }) => {
        const slots = await clientSlots(ctx, parseDateTime(inicio, tz), parseDateTime(fim, tz), duracao_min);
        return {
          horarios: slots.map((d) => ({ inicio: utcToLocalIso(d, tz).slice(0, 16), descricao: formatHuman(d, tz) })),
          observacao: slots.length ? undefined : "Nenhum horário livre no intervalo; tente outro período.",
        };
      },
    }),

    defineTool({
      name: "solicitar_reuniao",
      description:
        "Registra um pedido de reunião em um dos horários livres. O horário fica reservado e a reunião só é confirmada depois que o CEO aprovar; o contato é avisado pelo WhatsApp quando houver resposta.",
      inputSchema: z.object({
        inicio: z.string().describe("Horário escolhido, exatamente como retornado em consultar_horarios_livres"),
        duracao_min: z.number().int().min(15).max(120),
        assunto: z.string().min(3).max(200).describe("Assunto informado pelo contato"),
        modalidade: z.enum(["presencial", "online"]),
      }),
      run: async (i) => {
        const r = await requestMeeting(ctx, {
          start: parseDateTime(i.inicio, tz),
          durationMin: i.duracao_min,
          subject: i.assunto,
          modality: i.modalidade,
        });
        return { numero_do_pedido: r.id, situacao: "aguardando confirmação", quando: formatHuman(r.startAt, tz) };
      },
    }),

    defineTool({
      name: "meus_pedidos",
      description: "Lista os pedidos de reunião deste contato e a situação de cada um.",
      inputSchema: z.object({}),
      run: async () => {
        const list = await store.listMeetingRequests({ contactId: ctx.contact.id });
        return list.map((r) => ({
          numero: r.id,
          quando: formatHuman(r.startAt, tz),
          assunto: r.subject,
          modalidade: r.modality,
          situacao: r.status,
        }));
      },
    }),

    defineTool({
      name: "cancelar_pedido",
      description: "Cancela um pedido de reunião deste contato (pendente ou já confirmado) e libera o horário.",
      inputSchema: z.object({ numero: z.number().int() }),
      run: async ({ numero }) => {
        const r = await cancelOwnRequest(ctx, numero);
        return { numero: r.id, situacao: r.status };
      },
    }),

    defineTool({
      name: "deixar_recado",
      description:
        "Encaminha um recado deste contato ao CEO. Use para assuntos que o assistente não resolve: dúvidas técnicas, comerciais, urgências, pedidos fora do agendamento.",
      inputSchema: z.object({ recado: z.string().min(3).max(1500) }),
      run: async ({ recado }) => {
        const ceo = await getCeo(store, settings.ceoPhoneKey);
        const sent = await messenger.send(
          ceo,
          `✉️ *Recado de ${contactLabel(ctx.contact)}*${ctx.contact.role === "desconhecido" ? " (contato não cadastrado)" : ""}\n"${quote(recado, 1500)}"`,
          "notification",
        );
        if (!sent.ok) throw new Error("Não foi possível encaminhar o recado agora.");
        return { encaminhado: true };
      },
    }),
  ];
}
