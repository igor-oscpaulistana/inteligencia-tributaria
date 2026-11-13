import type { Metadata } from "next";
import { MarcaEalex } from "@/components/MarcaEalex";
import Link from "next/link";
import { FormularioSenha } from "./FormularioSenha";

export const metadata: Metadata = { title: "Alterar senha · E-Alex" };

export default function PaginaSenha() {
  return (
    <div className="login">
      <div className="card login-card">
        <MarcaEalex />
        <span className="ea-kicker">Sua conta</span>
        <h1>Alterar senha</h1>
        <p className="muted small">A nova senha passa a valer no próximo acesso.</p>
        <FormularioSenha />
        <Link className="back" href="/">
          Voltar ao E-Alex
        </Link>
      </div>
    </div>
  );
}
