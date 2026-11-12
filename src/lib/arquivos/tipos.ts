/**
 * Origem dos arquivos fiscais.
 *
 * A navegação sempre parte da pasta raiz "Inteligência Tributária" e desce por
 * listagem: os identificadores usados em `listarFilhos` e `baixar` precisam ter
 * vindo de uma listagem anterior da mesma instância. Nenhum identificador vem
 * do navegador.
 */

export interface ItemArquivo {
  id: string;
  nome: string;
  pasta: boolean;
  /** Tamanho em bytes (0 para pastas). */
  tamanho: number;
  modificadoEm: string | null;
}

export type TipoFonte = "onedrive" | "ficticia";

export interface FonteArquivos {
  readonly tipo: TipoFonte;
  /** Lista as pastas de clientes dentro de "Inteligência Tributária". */
  listarRaiz(): Promise<ItemArquivo[]>;
  listarFilhos(itemId: string): Promise<ItemArquivo[]>;
  baixar(itemId: string): Promise<Uint8Array>;
}

export class ErroFonteArquivos extends Error {
  constructor(
    mensagem: string,
    readonly codigo:
      | "sem_permissao"
      | "nao_encontrado"
      | "credenciais"
      | "limite_de_requisicoes"
      | "fora_da_arvore"
      | "indisponivel",
    readonly status?: number,
  ) {
    super(mensagem);
    this.name = "ErroFonteArquivos";
  }
}
