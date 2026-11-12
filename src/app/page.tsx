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

  if (!usuario.autorizado) {
    return (
      <div className="login">
        <div className="card login-card">
          <h1>Sem acesso</h1>
          <p className="muted small" style={{ marginBottom: 16 }}>
            A conta {usuario.email ?? usuario.nome} não está autorizada a usar o Inteligência Tributária. Peça a
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
  const ultima = await obterRepositorio(config).ultimaExecucao(usuario);

  return (
    <Escritorio
      nomeUsuario={usuario.nome}
      execucaoInicial={ultima}
      ambiente={{
        fonte: config.fonte,
        avisos: config.avisos,
      }}
      sair={config.supabase ? sair : undefined}
    />
  );
}
