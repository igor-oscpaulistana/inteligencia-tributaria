"use server";

import { redirect } from "next/navigation";
import { validarNovaSenha } from "@/lib/auth/senha";
import { lerConfiguracao } from "@/lib/config";
import { supabaseDoUsuario } from "@/lib/supabase/clientes";

export interface EstadoSenha {
  erro: string | null;
  alterada: boolean;
}

export async function alterarSenha(_anterior: EstadoSenha, formulario: FormData): Promise<EstadoSenha> {
  const config = lerConfiguracao();
  if (!config.supabase) redirect("/");

  const senha = String(formulario.get("senha") ?? "");
  const invalida = validarNovaSenha(senha, String(formulario.get("confirmacao") ?? ""));
  if (invalida) return { erro: invalida, alterada: false };

  const supabase = await supabaseDoUsuario(config.supabase);
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const { error } = await supabase.auth.updateUser({ password: senha });
  if (error) {
    return {
      erro:
        error.code === "same_password"
          ? "A nova senha precisa ser diferente da atual."
          : "Não foi possível alterar a senha. Tente novamente.",
      alterada: false,
    };
  }
  return { erro: null, alterada: true };
}
