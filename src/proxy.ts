import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { lerConfiguracao } from "@/lib/config";

/**
 * Renova a sessão do Supabase a cada requisição e barra quem não está
 * autenticado. É uma primeira barreira: páginas, rotas e o banco (RLS)
 * conferem a sessão e a permissão por cliente de novo.
 */
export async function proxy(requisicao: NextRequest) {
  const { supabase: config } = lerConfiguracao();
  if (!config) return NextResponse.next();

  let resposta = NextResponse.next({ request: requisicao });
  const supabase = createServerClient(config.url, config.chavePublica, {
    cookies: {
      getAll: () => requisicao.cookies.getAll(),
      setAll: (novos, cabecalhos) => {
        for (const { name, value } of novos) requisicao.cookies.set(name, value);
        resposta = NextResponse.next({ request: requisicao });
        for (const { name, value, options } of novos) resposta.cookies.set(name, value, options);
        for (const [nome, valor] of Object.entries(cabecalhos)) resposta.headers.set(nome, valor);
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  const caminho = requisicao.nextUrl.pathname;
  if (!data.user && !caminho.startsWith("/login")) {
    if (caminho.startsWith("/api/")) {
      return NextResponse.json({ erro: "Sessão expirada. Entre novamente." }, { status: 401 });
    }
    const destino = requisicao.nextUrl.clone();
    destino.pathname = "/login";
    destino.search = "";
    return NextResponse.redirect(destino);
  }
  return resposta;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
