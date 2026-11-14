import { anthropic } from "@/lib/agent/run";
import { config } from "@/lib/config";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { productionDeps } from "@/lib/deps";
import { runTick } from "@/lib/reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** A cada 5 minutos: lembretes, agenda do dia e resumo de notícias. */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return new Response("Unauthorized", { status: 401 });
  try {
    const result = await runTick(productionDeps(), new Date(), {
      leads: config.reminderLeads(),
      briefingTime: config.briefingTime(),
      newsDigestTime: config.newsDigestTime(),
      newsFocus: config.newsFocus(),
      anthropic,
    });
    if (result.erros.length) console.error("[cron/tick] erros:", result.erros);
    return Response.json(result);
  } catch (err) {
    console.error("[cron/tick] falha:", err);
    return Response.json({ erro: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
