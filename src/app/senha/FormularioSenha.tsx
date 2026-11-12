"use client";

import { useActionState } from "react";
import { TAMANHO_MINIMO_SENHA } from "@/lib/auth/senha";
import { alterarSenha, type EstadoSenha } from "./acoes";

const INICIAL: EstadoSenha = { erro: null, alterada: false };

export function FormularioSenha() {
  const [estado, acao, enviando] = useActionState(alterarSenha, INICIAL);

  if (estado.alterada) {
    return (
      <p className="notice" role="status" style={{ marginTop: 16 }}>
        Senha alterada. Use a nova senha no próximo acesso.
      </p>
    );
  }

  return (
    <form action={acao}>
      <div className="fields">
        <label>
          Nova senha
          <input
            name="senha"
            type="password"
            autoComplete="new-password"
            minLength={TAMANHO_MINIMO_SENHA}
            required
          />
          <span className="field-hint">Pelo menos {TAMANHO_MINIMO_SENHA} caracteres.</span>
        </label>
        <label>
          Confirmar nova senha
          <input
            name="confirmacao"
            type="password"
            autoComplete="new-password"
            minLength={TAMANHO_MINIMO_SENHA}
            required
          />
        </label>
      </div>
      {estado.erro && (
        <p className="notice error" role="alert">
          {estado.erro}
        </p>
      )}
      <button className="primary" disabled={enviando}>
        {enviando ? "Alterando…" : "Alterar senha"}
      </button>
    </form>
  );
}
