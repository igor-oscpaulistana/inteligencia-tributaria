import { redirect } from "next/navigation";
import { Suspense } from "react";
import { MarcaEalex } from "@/components/MarcaEalex";
import { Escritorio } from "@/components/Escritorio";
import { obterUsuario } from "@/lib/auth/sessao";
import { obterConfiguracao, obterRepositorio } from "@/lib/servicos";
import { sair } from "./login/acoes";

export default function Pagina() {
  return (
    <Suspense
      fallback={
        <main className="access-loading">
          <MarcaEalex />
          <p className="muted" role="status">
            Abrindo o E-Alex…
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

  if (!usuario.autorizado) {
    return (
      <div className="login">
        <div className="card login-card">
          <MarcaEalex />
          <h1>Sem acesso</h1>
          <p className="muted small" style={{ marginBottom: 16 }}>
            A conta {usuario.email ?? usuario.nome} não está autorizada a usar o E-Alex. Peça a
            liberação a quem administra o sistema.
          </p>
          <form action={sair}>
            <button className="secondary" type="submit">
              Sair
            </button>
          </form>
        </div>
      </div>
    );
  }

  const config = obterConfiguracao();
  const repositorio = obterRepositorio(config);
  const [emFoco, auditorias, fila] = await Promise.all([
    repositorio.execucaoEmFoco(usuario),
    repositorio.listarAuditorias(usuario),
    repositorio.situacaoDaFila(usuario),
  ]);

  return (
    <Escritorio
      nomeUsuario={usuario.nome}
      execucaoInicial={emFoco}
      auditoriasIniciais={auditorias}
      filaInicial={fila}
      ambiente={{
        fonte: config.fonte,
        avisos: config.avisos,
      }}
      sair={config.supabase ? sair : undefined}
    />
  );
}
