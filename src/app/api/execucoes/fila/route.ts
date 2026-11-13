import { after } from "next/server";
import { comUsuario } from "@/lib/api";
import { processarFila } from "@/lib/execucoes/fila";
import { criarFonteArquivos, obterConfiguracao, obterRepositorio } from "@/lib/servicos";

export const maxDuration = 300;

/**
 * Retoma a fila de execuções. A tela chama esta rota quando vê competências
 * aguardando e nenhuma em andamento: é o que acontece quando um período não
 * coube no tempo de uma única função. Chamadas repetidas são inofensivas — a
 * fila não começa outra competência enquanto houver uma em andamento, e cada
 * execução só pode ser assumida por um processo.
 */
export async function POST() {
  return comUsuario(async (usuario) => {
    const config = obterConfiguracao();
    const repositorio = obterRepositorio(config);
    // Uma execução que parou no meio (função encerrada pela plataforma) é
    // fechada aqui, para não ficar "em andamento" nem travar a fila.
    await repositorio.sistemaEncerrarInterrompidas();
    const fila = await repositorio.situacaoDaFila(usuario);
    if (fila.naFila > 0) {
      after(() => processarFila({ repositorio, criarFonte: () => criarFonteArquivos(config) }));
    }
    return Response.json({ fila }, { status: 202 });
  });
}
