import { comUsuario } from "@/lib/api";
import { obterRepositorio } from "@/lib/servicos";

/** Clientes que o usuário autenticado pode auditar. */
export async function GET() {
  return comUsuario(async (usuario) => {
    const clientes = await obterRepositorio().listarClientes(usuario);
    return Response.json({
      clientes: clientes.map(({ id, nome, cnpj }) => ({ id, nome, cnpj })),
    });
  });
}
