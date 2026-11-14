import { timingSafeEqual } from "node:crypto";
import { config } from "./config";

/** A Vercel Cron envia "Authorization: Bearer <CRON_SECRET>". */
export function isAuthorizedCron(request: Request): boolean {
  const expected = Buffer.from(`Bearer ${config.cronSecret()}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
