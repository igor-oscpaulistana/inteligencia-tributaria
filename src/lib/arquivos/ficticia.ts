import { arvoreFicticia, type NoFicticio } from "./dados-ficticios";
import { ErroFonteArquivos, type FonteArquivos, type ItemArquivo } from "./tipos";

interface OpcoesFicticia {
  /** Atraso por download, em ms, para que o andamento seja visível na interface. */
  atrasoMs?: number;
  arvore?: NoFicticio;
}

/** Origem de arquivos em memória, com DADOS FICTÍCIOS. */
export class FonteFicticia implements FonteArquivos {
  readonly tipo = "ficticia" as const;

  private readonly nos = new Map<string, NoFicticio>();
  private readonly raiz: NoFicticio;
  private readonly atrasoMs: number;

  constructor(opcoes: OpcoesFicticia = {}) {
    this.raiz = opcoes.arvore ?? arvoreFicticia();
    this.atrasoMs = opcoes.atrasoMs ?? 0;
  }

  async listarRaiz(): Promise<ItemArquivo[]> {
    return this.listar(this.raiz, "raiz");
  }

  async listarFilhos(itemId: string): Promise<ItemArquivo[]> {
    return this.listar(this.obter(itemId), itemId);
  }

  async baixar(itemId: string): Promise<Uint8Array> {
    const no = this.obter(itemId);
    if (!no.conteudo) throw new ErroFonteArquivos("O item é uma pasta.", "nao_encontrado");
    if (this.atrasoMs > 0) await new Promise((r) => setTimeout(r, this.atrasoMs));
    return no.conteudo;
  }

  private obter(itemId: string): NoFicticio {
    const no = this.nos.get(itemId);
    if (!no) {
      throw new ErroFonteArquivos(
        "Item fora da árvore da pasta Inteligência Tributária.",
        "fora_da_arvore",
      );
    }
    return no;
  }

  private listar(pasta: NoFicticio, idPasta: string): ItemArquivo[] {
    return (pasta.filhos ?? []).map((filho, indice) => {
      const id = `${idPasta}/${indice}`;
      this.nos.set(id, filho);
      return {
        id,
        nome: filho.nome,
        pasta: filho.filhos !== undefined,
        tamanho: filho.conteudo?.byteLength ?? 0,
        modificadoEm: "2026-07-01T12:00:00Z",
      };
    });
  }
}
