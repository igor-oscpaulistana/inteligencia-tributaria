import type { Metadata } from "next";
import Link from "next/link";
import { FormularioSenha } from "./FormularioSenha";

export const metadata: Metadata = { title: "Alterar senha · Inteligência Tributária" };

export default function PaginaSenha() {
  return (
    <div className="login">
      <div className="card login-card">
        <h1>Alterar senha</h1>
        <p className="muted small">A nova senha passa a valer no próximo acesso.</p>
        <FormularioSenha />
        <Link className="back" href="/">
          Voltar ao escritório
        </Link>
      </div>
    </div>
  );
}
