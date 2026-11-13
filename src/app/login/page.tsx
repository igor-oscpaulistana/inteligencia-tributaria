import type { Metadata } from "next";
import { MarcaEalex } from "@/components/MarcaEalex";
import { FormularioEntrada } from "./FormularioEntrada";

export const metadata: Metadata = { title: "Entrar · E-Alex" };

export default function PaginaEntrada() {
  return (
    <div className="login">
      <div className="login-shell">
        <aside className="login-story" aria-label="Sobre o E-Alex">
          <MarcaEalex />
          <div>
            <span className="ea-kicker">Inteligência tributária</span>
            <h2>Clareza em cada etapa da sua análise.</h2>
          </div>
          <p>Um espaço de trabalho para acompanhar a conferência de arquivos e a auditoria de PIS e COFINS.</p>
          <p className="story-caption">Do documento à decisão, com o analista no controle.</p>
        </aside>
        <div className="card login-card">
          <span className="ea-kicker">Bem-vindo de volta</span>
        <h1>Entrar</h1>
        <p className="muted small">Acesso restrito aos analistas autorizados.</p>
        <FormularioEntrada />
        <p className="form-note">Use as credenciais fornecidas pela administração. Para solicitar acesso, fale com o responsável pelo sistema.</p>
        </div>
      </div>
    </div>
  );
}
