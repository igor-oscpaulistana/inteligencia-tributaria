"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { competenciasDoPeriodo } from "@/lib/competencia";
import { LIMITE_COMPETENCIAS_POR_PEDIDO } from "@/lib/execucoes/tipos";

interface OpcaoCompetencia {
  valor: string;
  rotulo: string;
}

interface Props {
  aberto: boolean;
  dadosFicticios: boolean;
  /** Pasta que já vem escolhida (na tela de um cliente). */
  pastaInicial?: string;
  aoFechar: () => void;
  /** Inicia a auditoria do período; devolve uma mensagem de erro ou null quando deu certo. */
  aoIniciar: (pasta: string, competenciaInicial: string, competenciaFinal: string) => Promise<string | null>;
}

type Carga<T> = { estado: "carregando" } | { estado: "pronta"; itens: T[] } | { estado: "erro"; mensagem: string };

async function buscar<T>(url: string, sinal: AbortSignal, campo: string): Promise<T[]> {
  const resposta = await fetch(url, { signal: sinal, cache: "no-store" });
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(corpo.erro ?? "Não foi possível consultar o OneDrive.");
  return corpo[campo] as T[];
}

/**
 * Escolha do cliente e do período. Os clientes são as pastas de "Inteligência
 * Tributária"; as competências, as subpastas de cada cliente. O período pode
 * ser de um mês só ou de vários: cada competência é conferida separadamente.
 */
export function DialogoNovaAuditoria({ aberto, dadosFicticios, pastaInicial, aoFechar, aoIniciar }: Props) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const titulo = useId();
  const [clientes, setClientes] = useState<Carga<{ pasta: string }>>({ estado: "carregando" });
  const [pasta, setPasta] = useState(pastaInicial ?? "");
  const [competencias, setCompetencias] = useState<Carga<OpcaoCompetencia>>({ estado: "carregando" });
  const [inicial, setInicial] = useState("");
  const [final, setFinal] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const elemento = dialogo.current;
    if (!elemento) return;
    if (aberto && !elemento.open) elemento.showModal();
    if (!aberto && elemento.open) elemento.close();
  }, [aberto]);

  // Pastas de clientes, lidas a cada abertura: uma pasta nova aparece sem recarregar a página.
  useEffect(() => {
    if (!aberto) return;
    const controle = new AbortController();
    buscar<{ pasta: string }>("/api/clientes", controle.signal, "clientes")
      .then((itens) => {
        setClientes({ estado: "pronta", itens });
        setPasta((atual) => (itens.some((c) => c.pasta === atual) ? atual : (itens[0]?.pasta ?? "")));
      })
      .catch((falha: Error) => {
        if (falha.name !== "AbortError") setClientes({ estado: "erro", mensagem: falha.message });
      });
    return () => controle.abort();
  }, [aberto]);

  // Competências com pasta no OneDrive para o cliente escolhido.
  useEffect(() => {
    if (!aberto || !pasta) return;
    const controle = new AbortController();
    buscar<OpcaoCompetencia>(`/api/competencias?pasta=${encodeURIComponent(pasta)}`, controle.signal, "competencias")
      .then((itens) => {
        setCompetencias({ estado: "pronta", itens });
        setInicial(itens[0]?.valor ?? "");
        setFinal(itens[0]?.valor ?? "");
      })
      .catch((falha: Error) => {
        if (falha.name !== "AbortError") setCompetencias({ estado: "erro", mensagem: falha.message });
      });
    return () => controle.abort();
  }, [aberto, pasta]);

  function escolherCliente(nova: string) {
    setPasta(nova);
    setInicial("");
    setFinal("");
    setCompetencias({ estado: "carregando" });
    setErro(null);
  }

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (!pasta || !inicial || !final || enviando || acimaDoLimite) return;
    setEnviando(true);
    setErro(null);
    const falha = await aoIniciar(pasta, inicial, final);
    setEnviando(false);
    if (falha) setErro(falha);
  }

  const listaClientes = clientes.estado === "pronta" ? clientes.itens : [];
  const listaCompetencias = competencias.estado === "pronta" ? competencias.itens : [];
  const semClientes = clientes.estado === "pronta" && listaClientes.length === 0;
  const semCompetencias = competencias.estado === "pronta" && listaCompetencias.length === 0;
  const falhaDeLeitura =
    clientes.estado === "erro" ? clientes.mensagem : competencias.estado === "erro" ? competencias.mensagem : null;

  // As duas pontas se ajustam uma à outra: a final nunca fica antes da inicial.
  function escolherInicial(valor: string) {
    setInicial(valor);
    if (final < valor) setFinal(valor);
    setErro(null);
  }
  function escolherFinal(valor: string) {
    setFinal(valor);
    if (inicial > valor) setInicial(valor);
    setErro(null);
  }
  // Atalho para o ano inteiro: da primeira à última competência do ano que tem pasta.
  const anos = [...new Set(listaCompetencias.map((c) => c.valor.slice(0, 4)))].sort().reverse();
  function escolherAno(ano: string) {
    const doAno = listaCompetencias.map((c) => c.valor).filter((v) => v.startsWith(ano)).sort();
    if (doAno.length === 0) return;
    setInicial(doAno[0]);
    setFinal(doAno[doAno.length - 1]);
    setErro(null);
  }
  const anoEscolhido = (ano: string) => {
    const doAno = listaCompetencias.map((c) => c.valor).filter((v) => v.startsWith(ano)).sort();
    return doAno.length > 0 && inicial === doAno[0] && final === doAno[doAno.length - 1];
  };
  const quantidade = inicial && final ? competenciasDoPeriodo(inicial, final).length : 0;
  const acimaDoLimite = quantidade > LIMITE_COMPETENCIAS_POR_PEDIDO;

  return (
    <dialog className="audit-dialog" ref={dialogo} aria-labelledby={titulo} onClose={aoFechar}>
      <form onSubmit={enviar}>
        <div className="dialog-head">
          <div>
            <span className="ea-kicker">Cliente e período</span>
            <h2 id={titulo}>Nova auditoria</h2>
          </div>
          <button className="close" type="button" onClick={aoFechar} aria-label="Fechar">
            ×
          </button>
        </div>
        <p className="muted small">
          {dadosFicticios
            ? "Escolha um cliente fictício e o período para acompanhar o fluxo."
            : "Os clientes são as pastas de Inteligência Tributária no OneDrive. Escolha o cliente e o período."}
        </p>

        <div className="fields">
          <label>
            Cliente
            <select
              value={pasta}
              onChange={(e) => escolherCliente(e.target.value)}
              disabled={clientes.estado !== "pronta" || semClientes}
              required
            >
              {clientes.estado === "carregando" && <option value="">Carregando…</option>}
              {semClientes && <option value="">Nenhuma pasta de cliente</option>}
              {listaClientes.map((cliente) => (
                <option key={cliente.pasta} value={cliente.pasta}>
                  {cliente.pasta}
                </option>
              ))}
            </select>
            {semClientes && (
              <span className="field-hint" role="status">
                Crie a pasta do cliente dentro de Inteligência Tributária para ele aparecer aqui.
              </span>
            )}
          </label>
          <div className="period-fields">
            <label>
              Competência inicial
              <select
                value={inicial}
                onChange={(e) => escolherInicial(e.target.value)}
                disabled={!pasta || competencias.estado !== "pronta" || semCompetencias}
                required
              >
                {pasta && competencias.estado === "carregando" && <option value="">Carregando…</option>}
                {(!pasta || semCompetencias) && <option value="">Nenhuma competência encontrada</option>}
                {listaCompetencias.map((opcao) => (
                  <option key={opcao.valor} value={opcao.valor}>
                    {opcao.rotulo}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Competência final
              <select
                value={final}
                onChange={(e) => escolherFinal(e.target.value)}
                disabled={!pasta || competencias.estado !== "pronta" || semCompetencias}
                required
              >
                {pasta && competencias.estado === "carregando" && <option value="">Carregando…</option>}
                {(!pasta || semCompetencias) && <option value="">Nenhuma competência encontrada</option>}
                {listaCompetencias.map((opcao) => (
                  <option key={opcao.valor} value={opcao.valor}>
                    {opcao.rotulo}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {anos.length > 0 && (
            <div className="year-shortcuts" role="group" aria-label="Escolher o ano inteiro">
              <span>Ano inteiro</span>
              {anos.map((ano) => (
                <button
                  key={ano}
                  type="button"
                  className="chip"
                  aria-pressed={anoEscolhido(ano)}
                  onClick={() => escolherAno(ano)}
                >
                  {ano}
                </button>
              ))}
            </div>
          )}
          {pasta && semCompetencias && (
            <span className="field-hint" role="status">
              A pasta do cliente não tem subpastas de competência.
            </span>
          )}
          {quantidade > 0 && (
            <p className={`field-hint period-hint${acimaDoLimite ? " over" : ""}`} role="status">
              {acimaDoLimite
                ? `O período tem ${quantidade} competências; o máximo por pedido é ${LIMITE_COMPETENCIAS_POR_PEDIDO}.`
                : quantidade === 1
                  ? "1 competência será auditada."
                  : `${quantidade} competências serão auditadas, uma de cada vez. A conferência e a retificação continuam mensais.`}
            </p>
          )}
        </div>

        {(erro ?? falhaDeLeitura) && (
          <p className="notice error" role="alert">
            {erro ?? falhaDeLeitura}
          </p>
        )}

        <div className="dialog-actions">
          <button className="secondary" type="button" onClick={aoFechar}>
            Cancelar
          </button>
          <button className="primary" disabled={!pasta || !inicial || !final || enviando || acimaDoLimite}>
            {enviando ? "Iniciando…" : "Iniciar auditoria"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
