import { after } from "next/server";
import { runAgent } from "@/lib/agent/run";
import { config } from "@/lib/config";
import { productionDeps } from "@/lib/deps";
import { handleInbound } from "@/lib/inbound";
import { markRead, parseWebhook, verifySignature } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Verificação do webhook pela Meta (feita uma vez, no cadastro). */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const challenge = params.get("hub.challenge");
  if (
    params.get("hub.mode") === "subscribe" &&
    challenge &&
    params.get("hub.verify_token") === config.whatsappVerifyToken()
  ) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifySignature(raw, request.headers.get("x-hub-signature-256"), config.whatsappAppSecret())) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const messages = parseWebhook(payload);
  if (messages.length > 0) {
    // A Meta reenvia o evento se não receber 200 em poucos segundos; por isso
    // a resposta sai já e o atendimento roda depois, na mesma invocação.
    after(async () => {
      const deps = productionDeps();
      const allowUnknown = config.allowUnknownContacts();
      await Promise.all(
        messages.map(async (msg) => {
          try {
            void markRead(msg.waMessageId);
            const outcome = await handleInbound(msg, deps, { allowUnknown, runAgent });
            console.log(`[webhook] ${msg.waMessageId}: ${outcome}`);
          } catch (err) {
            console.error(`[webhook] falha ao processar ${msg.waMessageId}:`, err);
          }
        }),
      );
    });
  }
  return new Response("OK", { status: 200 });
}
