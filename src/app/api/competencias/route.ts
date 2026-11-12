import { comUsuario, erro } from "@/lib/api";
import { listarCompetencias, localizarPastaCliente } from "@/lib/arquivos/leiaute";
import { formatarCompetencia } from "@/lib/competencia";
import { criarFonteArquivos } from "@/lib/servicos";

/** Competências que têm pasta no OneDrive para o cliente (pasta) escolhido. */
export async function GET(requisicao: Request) {
  return comUsuario(async () => {
    const nomePasta = new URL(requisicao.url).searchParams.get("pasta")?.trim();
    if (!nomePasta) return erro(400, "Escolha um cliente.");

    const fonte = criarFonteArquivos();
    // A pasta é sempre localizada pela listagem da raiz; o nome recebido só serve de busca.
    const pasta = localizarPastaCliente(await fonte.listarRaiz(), nomePasta);
    if (!pasta) return erro(404, "A pasta deste cliente não existe em Inteligência Tributária.");

    const competencias = await listarCompetencias(fonte, pasta);
    return Response.json({
      origem: fonte.tipo,
      competencias: competencias.map((valor) => ({ valor, rotulo: formatarCompetencia(valor) })),
    });
  });
}
