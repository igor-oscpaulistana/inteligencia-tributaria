import type { AgenteId } from "@/lib/execucoes/tipos";

export interface DefinicaoAgente {
  id: AgenteId;
  nome: string;
  cor: string;
  descricao: string;
  tarefaPadrao: string;
}

export const DEFINICOES_AGENTES: DefinicaoAgente[] = [
  {
    id: "triagem",
    nome: "Triagem",
    cor: "#79c8ff",
    descricao:
      "Localiza cliente e competência no OneDrive, confere CNPJ e período e registra arquivos ausentes ou incompatíveis.",
    tarefaPadrao: "Localizar XMLs e SPEDs da competência",
  },
  {
    id: "auditoria",
    nome: "Auditoria",
    cor: "#72e0bd",
    descricao:
      "Cruza notas de saída, EFD-Contribuições e EFD ICMS/IPI e calcula as diferenças de PIS e COFINS.",
    tarefaPadrao: "Cruzar notas de saída e escriturações",
  },
  {
    id: "relatorio",
    nome: "Relatório",
    cor: "#ffd08a",
    descricao: "Organiza valores por contribuição, competências e memória de cálculo para avaliação.",
    tarefaPadrao: "Montar relatório e memória de cálculo",
  },
  {
    id: "retificacao",
    nome: "Retificação",
    cor: "#bda9fa",
    descricao:
      "Recebe somente o relatório aprovado por um analista e gera a EFD-Contribuições retificadora para validação no PVA.",
    tarefaPadrao: "Gerar a EFD-Contribuições retificadora",
  },
];
