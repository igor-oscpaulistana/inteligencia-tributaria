import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { ConfigSupabase } from "@/lib/config";

/**
 * Cliente do Supabase com a sessão do usuário (cookies). Tudo o que ele lê ou
 * grava passa pelas políticas de RLS. Crie um por requisição.
 */
export async function supabaseDoUsuario(config: ConfigSupabase): Promise<SupabaseClient> {
  const armazenados = await cookies();
  return createServerClient(config.url, config.chavePublica, {
    cookies: {
      getAll: () => armazenados.getAll(),
      setAll: (novos) => {
        try {
          for (const { name, value, options } of novos) armazenados.set(name, value, options);
        } catch {
          // Em Server Components os cookies são somente leitura; a renovação da
          // sessão é feita pelo proxy (src/proxy.ts).
        }
      },
    },
  });
}

/**
 * Cliente com a chave secreta, usado apenas pelo executor no servidor.
 * Ignora RLS: só chame depois que a execução já foi autorizada para o usuário.
 */
export function supabaseDoServidor(config: ConfigSupabase): SupabaseClient {
  return createClient(config.url, config.chaveSecreta, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
