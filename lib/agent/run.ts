import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import { formatNow } from "../time";
import type { StoredMessage } from "../types";
import { contactLabel, type AgentContext } from "./context";
import { ceoSystemPrompt, clientSystemPrompt } from "./prompts";
import { ceoTools } from "./tools-ceo";
import { clientTools } from "./tools-client";

let client: Anthropic | null = null;
export function anthropic(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

function buildMessages(history: StoredMessage[], turnContext: string): Anthropic.Beta.BetaMessageParam[] {
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of history) {
    if (messages.length === 0 && m.role !== "user") continue; // a conversa precisa começar pelo usuário
    messages.push({ role: m.role, content: m.body });
  }
  // A mensagem de sistema abaixo só é aceita logo após um turno do usuário.
  // Um aviso automático gravado depois da última mensagem dele (corrida entre
  // o webhook e o agendador) fica de fora deste turno e volta no próximo.
  while (messages.length > 0 && messages[messages.length - 1].role !== "user") messages.pop();
  if (messages.length === 0) throw new Error("Histórico sem mensagem do usuário.");
  // Contexto volátil no fim, como instrução do operador: mantém o prefixo em cache.
  messages.push({ role: "system", content: turnContext });
  return messages;
}

/**
 * Executa um turno do agente para o contato em `ctx` e devolve o texto da
 * resposta. `history` deve terminar com a mensagem que acabou de chegar.
 */
export async function runAgent(ctx: AgentContext, history: StoredMessage[]): Promise<string> {
  const isCeo = ctx.contact.role === "ceo";
  const { settings } = ctx;

  const who = isCeo
    ? `Interlocutor: ${settings.ceoName} (CEO).`
    : `Interlocutor: ${contactLabel(ctx.contact)}, ${
        ctx.contact.role === "cliente" ? "cliente cadastrado" : "contato ainda não cadastrado"
      }.`;

  const runner = anthropic().beta.messages.toolRunner({
    model: config.anthropicModel(),
    max_tokens: 16000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    output_config: { effort: "medium" },
    system: [
      {
        type: "text",
        text: isCeo ? ceoSystemPrompt(settings) : clientSystemPrompt(settings),
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: isCeo ? ceoTools(ctx) : clientTools(ctx),
    messages: buildMessages(history, `Agora: ${formatNow(ctx.now, settings.tz)}. ${who}`),
    max_iterations: 12,
  });

  const final = await runner.runUntilDone();

  if (final.stop_reason === "refusal") {
    return "Não consigo ajudar com esse pedido. Posso ajudar com a agenda, recados ou notícias.";
  }
  const text = final.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!text) {
    // Sem texto final: o limite de iterações foi atingido no meio de uma ação.
    return "Não consegui concluir esse pedido agora. Pode repetir ou detalhar o que precisa?";
  }
  return text;
}
