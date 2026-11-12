import { comUsuario } from "@/lib/api";
import { criarFonteArquivos } from "@/lib/servicos";

/**
 * Clientes disponíveis para auditoria: as pastas de "Inteligência Tributária".
 * O cadastro no banco acontece quando a auditoria de uma pasta é pedida.
 */
export async function GET() {
  return comUsuario(async () => {
    const fonte = criarFonteArquivos();
    const pastas = (await fonte.listarRaiz())
      .filter((item) => item.pasta)
      .map((item) => item.nome)
      .sort((a, b) => a.localeCompare(b, "pt-BR"));
    return Response.json({ origem: fonte.tipo, clientes: pastas.map((pasta) => ({ pasta })) });
  });
}
