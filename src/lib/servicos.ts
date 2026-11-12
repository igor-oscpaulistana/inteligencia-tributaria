import "server-only";
import { FonteFicticia } from "@/lib/arquivos/ficticia";
import { FonteGraph } from "@/lib/arquivos/graph";
import type { FonteArquivos } from "@/lib/arquivos/tipos";
import { lerConfiguracao, type Configuracao } from "@/lib/config";
import { RepositorioMemoria } from "@/lib/execucoes/repositorio-memoria";
import { RepositorioSupabase } from "@/lib/execucoes/repositorio-supabase";
import type { Repositorio } from "@/lib/execucoes/tipos";

// Em desenvolvimento o Next recarrega os módulos; o repositório em memória
// precisa sobreviver a isso para a execução continuar visível.
const global = globalThis as typeof globalThis & { __repositorioMemoria?: RepositorioMemoria };

export function obterConfiguracao(): Configuracao {
  return lerConfiguracao();
}

export function obterRepositorio(config: Configuracao = lerConfiguracao()): Repositorio {
  if (config.supabase) return new RepositorioSupabase(config.supabase);
  global.__repositorioMemoria ??= new RepositorioMemoria();
  return global.__repositorioMemoria;
}

/** Uma origem nova por uso: ela guarda os itens já listados a partir da raiz. */
export function criarFonteArquivos(config: Configuracao = lerConfiguracao()): FonteArquivos {
  if (config.fonte === "onedrive" && config.graph) return new FonteGraph(config.graph);
  // O pequeno atraso deixa o andamento da leitura visível na demonstração.
  return new FonteFicticia({ atrasoMs: 700 });
}
