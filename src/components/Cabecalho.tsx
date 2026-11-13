import Link from "next/link";
import { MarcaEalex } from "./MarcaEalex";

interface Props {
  nomeUsuario: string;
  dadosFicticios: boolean;
  /** Ação de saída; ausente no modo de demonstração. */
  sair?: () => Promise<void>;
}

/** Barra superior comum às telas: marca, usuário, troca de senha e saída. */
export function Cabecalho({ nomeUsuario, dadosFicticios, sair }: Props) {
  return (
    <header className="top">
      <div className="top-inner">
        <Link className="brand-link" href="/" aria-label="E-Alex: voltar ao escritório">
          <MarcaEalex />
        </Link>
        <div className="top-side">
          {dadosFicticios && <span className="demo">Dados demonstrativos</span>}
          <span className="user">{nomeUsuario}</span>
          {sair && (
            <Link className="top-link" href="/senha">
              Alterar senha
            </Link>
          )}
          {sair && (
            <form action={sair}>
              <button className="secondary" type="submit">
                Sair
              </button>
            </form>
          )}
        </div>
      </div>
    </header>
  );
}
