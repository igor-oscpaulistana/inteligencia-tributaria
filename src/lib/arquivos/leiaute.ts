/**
 * Localização das pastas de cliente e de competência dentro de
 * "Inteligência Tributária".
 *
 * Dois leiautes são aceitos:
 *  - "<Cliente>/<MM-AAAA>/" com "XMLs/", "Sped_Contribuicoes.txt" e "Sped_Fiscal.txt";
 *  - "<Cliente>/<AAAA>/<MM>/" com subpastas como "a. XML", "b. SPED Contribuições"
 *    e "c. SPED Fiscal".
 *
 * Os nomes de pasta e de arquivo servem só para chegar à competência. O tipo de
 * cada arquivo é decidido pelo conteúdo, na triagem.
 */

import { compararCompetenciasDesc, normalizarCompetencia, partesCompetencia } from "@/lib/competencia";
import type { FonteArquivos, ItemArquivo } from "./tipos";

export type LeiautePasta = "mm-aaaa" | "aaaa/mm";

export interface PastaCompetencia {
  item: ItemArquivo;
  caminho: string;
  leiaute: LeiautePasta;
}

export interface ArquivoEncontrado {
  item: ItemArquivo;
  /** Caminho relativo à pasta "Inteligência Tributária". */
  caminho: string;
  extensao: string;
}

const ANO = /^\d{4}$/;
const MES = /^(0?[1-9]|1[0-2])(?!\d)/;
const PROFUNDIDADE_MAXIMA = 3;

export function normalizarNome(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

export function localizarPastaCliente(raiz: ItemArquivo[], nomePasta: string): ItemArquivo | null {
  const alvo = normalizarNome(nomePasta);
  return raiz.find((item) => item.pasta && normalizarNome(item.nome) === alvo) ?? null;
}

function mesDaPasta(nome: string): string | null {
  const mes = MES.exec(nome.trim());
  return mes ? mes[1].padStart(2, "0") : null;
}

/** Competências que têm pasta no OneDrive, da mais recente para a mais antiga. */
export async function listarCompetencias(
  fonte: FonteArquivos,
  pastaCliente: ItemArquivo,
): Promise<string[]> {
  const encontradas = new Set<string>();
  const filhos = await fonte.listarFilhos(pastaCliente.id);

  for (const filho of filhos) {
    if (!filho.pasta) continue;
    const direta = normalizarCompetencia(filho.nome);
    if (direta) {
      encontradas.add(direta);
      continue;
    }
    if (ANO.test(filho.nome.trim())) {
      for (const pastaMes of await fonte.listarFilhos(filho.id)) {
        const mes = pastaMes.pasta ? mesDaPasta(pastaMes.nome) : null;
        if (mes) encontradas.add(`${filho.nome.trim()}-${mes}`);
      }
    }
  }
  return [...encontradas].sort(compararCompetenciasDesc);
}

export async function localizarPastaCompetencia(
  fonte: FonteArquivos,
  pastaCliente: ItemArquivo,
  competencia: string,
): Promise<PastaCompetencia | null> {
  const { ano, mes } = partesCompetencia(competencia);
  const mesTexto = String(mes).padStart(2, "0");
  const filhos = await fonte.listarFilhos(pastaCliente.id);

  const direta = filhos.find((f) => f.pasta && normalizarCompetencia(f.nome) === competencia);
  if (direta) {
    return { item: direta, caminho: `${pastaCliente.nome}/${direta.nome}`, leiaute: "mm-aaaa" };
  }

  const pastaAno = filhos.find((f) => f.pasta && f.nome.trim() === String(ano));
  if (pastaAno) {
    const meses = await fonte.listarFilhos(pastaAno.id);
    const pastaMes = meses.find((f) => f.pasta && mesDaPasta(f.nome) === mesTexto);
    if (pastaMes) {
      return {
        item: pastaMes,
        caminho: `${pastaCliente.nome}/${pastaAno.nome}/${pastaMes.nome}`,
        leiaute: "aaaa/mm",
      };
    }
  }
  return null;
}

/** Percorre a pasta da competência e devolve todos os arquivos encontrados. */
export async function coletarArquivos(
  fonte: FonteArquivos,
  pasta: PastaCompetencia,
): Promise<ArquivoEncontrado[]> {
  const arquivos: ArquivoEncontrado[] = [];

  async function percorrer(itemId: string, caminho: string, profundidade: number): Promise<void> {
    for (const item of await fonte.listarFilhos(itemId)) {
      const caminhoItem = `${caminho}/${item.nome}`;
      if (item.pasta) {
        if (profundidade < PROFUNDIDADE_MAXIMA) await percorrer(item.id, caminhoItem, profundidade + 1);
        continue;
      }
      const ponto = item.nome.lastIndexOf(".");
      arquivos.push({
        item,
        caminho: caminhoItem,
        extensao: ponto >= 0 ? item.nome.slice(ponto + 1).toLowerCase() : "",
      });
    }
  }

  await percorrer(pasta.item.id, pasta.caminho, 1);
  return arquivos;
}
