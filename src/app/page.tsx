import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Escritorio } from "@/components/Escritorio";
import { obterUsuario } from "@/lib/auth/sessao";
import { obterConfiguracao, obterRepositorio } from "@/lib/servicos";
import { sair } from "./login/acoes";

export default function Pagina() {
  return (
    <Suspense
      fallback={
        <main>
          <p className="muted" role="status">
            Abrindo o escritório…
          </p>
        </main>
      }
    >
      <EscritorioDoUsuario />
    </Suspense>
  );
}

/** Lê a sessão e os dados iniciais no servidor; o restante da tela acompanha pela API. */
async function EscritorioDoUsuario() {
  const usuario = await obterUsuario();
  if (!usuario) redirect("/login");

  const config = obterConfiguracao();
  const repositorio = obterRepositorio(config);
  const [clientes, ultima] = await Promise.all([
    repositorio.listarClientes(usuario),
    repositorio.ultimaExecucao(usuario),
  ]);

  return (
    <Escritorio
      nomeUsuario={usuario.nome}
      clientes={clientes.map(({ id, nome }) => ({ id, nome }))}
      execucaoInicial={ultima}
      ambiente={{
        fonte: config.fonte,
        cenaSpline: process.env.NEXT_PUBLIC_SPLINE_SCENE_URL?.trim() || null,
        avisos: config.avisos,
      }}
      sair={config.supabase ? sair : undefined}
    />
  );
}
