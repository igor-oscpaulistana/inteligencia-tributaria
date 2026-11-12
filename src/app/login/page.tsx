import type { Metadata } from "next";
import { FormularioEntrada } from "./FormularioEntrada";

export const metadata: Metadata = { title: "Entrar · Inteligência Tributária" };

export default function PaginaEntrada() {
  return (
    <div className="login">
      <div className="card login-card">
        <div className="brand" style={{ marginBottom: 18 }}>
          <span className="brand-mark" aria-hidden="true">
            ▦
          </span>
          Inteligência Tributária
        </div>
        <h1>Entrar</h1>
        <p className="muted small">Acesso restrito aos analistas autorizados.</p>
        <FormularioEntrada />
      </div>
    </div>
  );
}
