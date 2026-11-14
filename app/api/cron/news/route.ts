import { isAuthorizedCron } from "@/lib/cron-auth";
import { collectNews } from "@/lib/news";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** De hora em hora: coleta manchetes novas das fontes cadastradas. */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return new Response("Unauthorized", { status: 401 });
  try {
    return Response.json({ fontes: await collectNews(getStore(), new Date()) });
  } catch (err) {
    console.error("[cron/news] falha:", err);
    return Response.json({ erro: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
