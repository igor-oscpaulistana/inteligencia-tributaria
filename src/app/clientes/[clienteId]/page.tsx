import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { MarcaEalex } from "@/components/MarcaEalex";
import { TelaCliente } from "@/components/TelaCliente";
import { uuidValido } from "@/lib/api";
import { obterUsuario } from "@/lib/auth/sessao";
import { competenciaValida } from "@/lib/competencia";
import { obterConfiguracao, obterRepositorio } from "@/lib/servicos";
import { sair } from "../../login/acoes";

export const metadata: Metadata = { title: "Cliente · E-Alex" };

export default function PaginaCliente(props: PageProps<"/clientes/[clienteId]">) {
  return (
    <Suspense
      fallback={
        <main className="access-loading">
          <MarcaEalex />
          <p className="muted" role="status">
            Abrindo o cliente…
          </p>
        </main>
      }
    >
      <ClienteDoUsuario {...props} />
    </Suspense>
  );
}

/** Lê a sessão, o cliente e as auditorias dele no servidor; a tela acompanha o restante pela API. */
async function ClienteDoUsuario({ params, searchParams }: PageProps<"/clientes/[clienteId]">) {
  const usuario = await obterUsuario();
  if (!usuario) redirect("/login");
  // A tela inicial é quem explica a falta de autorização.
  if (!usuario.autorizado) redirect("/");

  const { clienteId } = await params;
  if (!uuidValido(clienteId)) notFound();

  const config = obterConfiguracao();
  const repositorio = obterRepositorio(config);
  const cliente = await repositorio.obterCliente(usuario, clienteId);
  if (!cliente) notFound();

  const [auditorias, fila, consulta] = await Promise.all([
    repositorio.listarAuditorias(usuario, { clienteId }),
    repositorio.situacaoDaFila(usuario),
    searchParams,
  ]);
  const competencia = typeof consulta.competencia === "string" ? consulta.competencia : null;

  return (
    <TelaCliente
      cliente={cliente}
      nomeUsuario={usuario.nome}
      fonte={config.fonte}
      auditoriasIniciais={auditorias}
      filaInicial={fila}
      competenciaInicial={competencia && competenciaValida(competencia) ? competencia : null}
      sair={config.supabase ? sair : undefined}
    />
  );
}
