"use server";

import { redirect } from "next/navigation";
import { lerConfiguracao } from "@/lib/config";
import { supabaseDoUsuario } from "@/lib/supabase/clientes";

export interface EstadoEntrada {
  erro: string | null;
}

export async function entrar(_anterior: EstadoEntrada, formulario: FormData): Promise<EstadoEntrada> {
  const config = lerConfiguracao();
  if (!config.supabase) redirect("/");

  const email = String(formulario.get("email") ?? "").trim();
  const senha = String(formulario.get("senha") ?? "");
  if (!email || !senha) return { erro: "Informe e-mail e senha." };

  const supabase = await supabaseDoUsuario(config.supabase);
  const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
  if (error) return { erro: "E-mail ou senha incorretos." };
  redirect("/");
}

export async function sair(): Promise<void> {
  const config = lerConfiguracao();
  if (config.supabase) {
    const supabase = await supabaseDoUsuario(config.supabase);
    await supabase.auth.signOut();
  }
  redirect("/login");
}
