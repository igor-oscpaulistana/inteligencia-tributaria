import type { AgenteId } from "@/lib/execucoes/tipos";

export interface DefinicaoAgente {
  id: AgenteId;
  nome: string;
  cor: string;
  /** Nome do objeto clicável da estação na cena do Spline. */
  objetoSpline: string;
  /** Variável numérica da cena que recebe o estado visual da estação. */
  variavelSpline: string;
  descricao: string;
  tarefaPadrao: string;
  /** Posição horizontal da estação na imagem de reserva, em %. */
  posicao: number;
}

export const DEFINICOES_AGENTES: DefinicaoAgente[] = [
  {
    id: "triagem",
    nome: "Triagem",
    cor: "#79c8ff",
    objetoSpline: "Estacao_Triagem",
    variavelSpline: "estado_triagem",
    descricao:
      "Localiza cliente e competência no OneDrive, confere CNPJ e período e registra arquivos ausentes ou incompatíveis.",
    tarefaPadrao: "Localizar XMLs e SPEDs da competência",
    posicao: 15.3,
  },
  {
    id: "auditoria",
    nome: "Auditoria",
    cor: "#72e0bd",
    objetoSpline: "Estacao_Auditoria",
    variavelSpline: "estado_auditoria",
    descricao:
      "Cruza notas de saída, EFD-Contribuições e EFD ICMS/IPI e calcula as diferenças de PIS e COFINS.",
    tarefaPadrao: "Cruzar notas de saída e escriturações",
    posicao: 38.6,
  },
  {
    id: "relatorio",
    nome: "Relatório",
    cor: "#ffd08a",
    objetoSpline: "Estacao_Relatorio",
    variavelSpline: "estado_relatorio",
    descricao: "Organiza valores por contribuição, competências e memória de cálculo para avaliação.",
    tarefaPadrao: "Montar relatório e memória de cálculo",
    posicao: 62.5,
  },
  {
    id: "retificacao",
    nome: "Retificação",
    cor: "#bda9fa",
    objetoSpline: "Estacao_Retificacao",
    variavelSpline: "estado_retificacao",
    descricao:
      "Recebe somente o relatório aprovado por um analista e gera a EFD-Contribuições retificadora para validação no PVA.",
    tarefaPadrao: "Gerar a EFD-Contribuições retificadora",
    posicao: 86.6,
  },
];
