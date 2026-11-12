/** Regra de senha do sistema: e-mail e senha, com pelo menos 8 caracteres. */
export const TAMANHO_MINIMO_SENHA = 8;

/** Devolve a mensagem de erro da nova senha, ou null quando ela é aceita. */
export function validarNovaSenha(senha: string, confirmacao: string): string | null {
  if (senha.length < TAMANHO_MINIMO_SENHA) {
    return `A senha precisa ter pelo menos ${TAMANHO_MINIMO_SENHA} caracteres.`;
  }
  if (senha !== confirmacao) return "A confirmação não confere com a nova senha.";
  return null;
}
