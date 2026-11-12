import { RedatorClaude, redatorConfigurado } from "./claude";
import { RedatorSimulado } from "./simulador";
import type { RedatorRelatorio } from "./tipos";

/** Claude Opus quando há ANTHROPIC_API_KEY; sem a chave, o simulador. */
export function obterRedator(env: Record<string, string | undefined> = process.env): RedatorRelatorio {
  return redatorConfigurado(env) ? new RedatorClaude() : new RedatorSimulado();
}
