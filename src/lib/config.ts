/**
 * Configuração por variáveis de ambiente e modo de operação.
 *
 * O OneDrive real só é usado quando a autenticação (Supabase) também está
 * configurada. Sem autenticação o painel fica aberto, então ele só pode
 * mostrar dados fictícios.
 */

import type { ConfigGraph } from "@/lib/arquivos/graph";
import type { TipoFonte } from "@/lib/arquivos/tipos";

export interface ConfigSupabase {
  url: string;
  chavePublica: string;
  /** Chave secreta (service role) usada só no servidor, pelo executor. */
  chaveSecreta: string;
}

export interface Configuracao {
  supabase: ConfigSupabase | null;
  graph: ConfigGraph | null;
  fonte: TipoFonte;
  armazenamento: "supabase" | "memoria";
  /** Situações que o operador precisa conhecer (configuração parcial etc.). */
  avisos: string[];
}

type Ambiente = Record<string, string | undefined>;

const VARIAVEIS_GRAPH = {
  tenantId: "MS_TENANT_ID",
  clientId: "MS_CLIENT_ID",
  clientSecret: "MS_CLIENT_SECRET",
  driveId: "ONEDRIVE_DRIVE_ID",
  pastaRaizItemId: "ONEDRIVE_PASTA_RAIZ_ITEM_ID",
} as const;

function valor(env: Ambiente, ...nomes: string[]): string | null {
  for (const nome of nomes) {
    const lido = env[nome]?.trim();
    if (lido) return lido;
  }
  return null;
}

export function lerConfiguracao(env: Ambiente = process.env): Configuracao {
  const avisos: string[] = [];

  const url = valor(env, "NEXT_PUBLIC_SUPABASE_URL");
  const chavePublica = valor(
    env,
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  );
  const chaveSecreta = valor(env, "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
  const informadasSupabase = [url, chavePublica, chaveSecreta].filter(Boolean).length;
  const supabase =
    url && chavePublica && chaveSecreta ? { url, chavePublica, chaveSecreta } : null;
  if (informadasSupabase > 0 && !supabase) {
    avisos.push(
      "Supabase com configuração incompleta: informe a URL, a chave pública e a chave secreta.",
    );
  }

  const lidasGraph = Object.entries(VARIAVEIS_GRAPH).map(
    ([campo, nome]) => [campo, nome, valor(env, nome)] as const,
  );
  const faltantes = lidasGraph.filter(([, , lido]) => !lido).map(([, nome]) => nome);
  let graph: ConfigGraph | null = null;
  if (faltantes.length === 0) {
    graph = Object.fromEntries(lidasGraph.map(([campo, , lido]) => [campo, lido])) as unknown as ConfigGraph;
  } else if (faltantes.length < lidasGraph.length) {
    avisos.push(`OneDrive com configuração incompleta: faltam ${faltantes.join(", ")}.`);
  }

  if (graph && !supabase) {
    avisos.push(
      "OneDrive configurado, mas ignorado: sem autenticação (Supabase) o painel só usa dados fictícios.",
    );
  }

  return {
    supabase,
    graph,
    fonte: graph && supabase ? "onedrive" : "ficticia",
    armazenamento: supabase ? "supabase" : "memoria",
    avisos,
  };
}
