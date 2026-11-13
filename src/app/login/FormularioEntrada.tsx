"use client";

import { useActionState } from "react";
import { entrar, type EstadoEntrada } from "./acoes";

const INICIAL: EstadoEntrada = { erro: null };

export function FormularioEntrada() {
  const [estado, acao, enviando] = useActionState(entrar, INICIAL);

  return (
    <form action={acao} aria-busy={enviando}>
      <div className="fields">
        <label>
          E-mail
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          Senha
          <input name="senha" type="password" autoComplete="current-password" required />
        </label>
      </div>
      {estado.erro && (
        <p className="notice error" role="alert">
          {estado.erro}
        </p>
      )}
      <button className="primary" disabled={enviando}>
        {enviando ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
