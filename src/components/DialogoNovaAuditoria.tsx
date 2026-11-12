"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

interface OpcaoCompetencia {
  valor: string;
  rotulo: string;
}

interface Props {
  aberto: boolean;
  dadosFicticios: boolean;
  aoFechar: () => void;
  /** Inicia a auditoria; devolve uma mensagem de erro ou null quando deu certo. */
  aoIniciar: (pasta: string, competencia: string) => Promise<string | null>;
}

type Carga<T> = { estado: "carregando" } | { estado: "pronta"; itens: T[] } | { estado: "erro"; mensagem: string };

async function buscar<T>(url: string, sinal: AbortSignal, campo: string): Promise<T[]> {
  const resposta = await fetch(url, { signal: sinal, cache: "no-store" });
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(corpo.erro ?? "Não foi possível consultar o OneDrive.");
  return corpo[campo] as T[];
}

/**
 * Escolha do cliente e da competência. Os clientes são as pastas de
 * "Inteligência Tributária"; as competências, as subpastas de cada cliente.
 */
export function DialogoNovaAuditoria({ aberto, dadosFicticios, aoFechar, aoIniciar }: Props) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const titulo = useId();
  const [clientes, setClientes] = useState<Carga<{ pasta: string }>>({ estado: "carregando" });
  const [pasta, setPasta] = useState("");
  const [competencias, setCompetencias] = useState<Carga<OpcaoCompetencia>>({ estado: "carregando" });
  const [competencia, setCompetencia] = useState("");
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
        setCompetencia(itens[0]?.valor ?? "");
      })
      .catch((falha: Error) => {
        if (falha.name !== "AbortError") setCompetencias({ estado: "erro", mensagem: falha.message });
      });
    return () => controle.abort();
  }, [aberto, pasta]);

  function escolherCliente(nova: string) {
    setPasta(nova);
    setCompetencia("");
    setCompetencias({ estado: "carregando" });
    setErro(null);
  }

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (!pasta || !competencia || enviando) return;
    setEnviando(true);
    setErro(null);
    const falha = await aoIniciar(pasta, competencia);
    setEnviando(false);
    if (falha) setErro(falha);
  }

  const listaClientes = clientes.estado === "pronta" ? clientes.itens : [];
  const listaCompetencias = competencias.estado === "pronta" ? competencias.itens : [];
  const semClientes = clientes.estado === "pronta" && listaClientes.length === 0;
  const semCompetencias = competencias.estado === "pronta" && listaCompetencias.length === 0;
  const falhaDeLeitura =
    clientes.estado === "erro" ? clientes.mensagem : competencias.estado === "erro" ? competencias.mensagem : null;

  return (
    <dialog ref={dialogo} aria-labelledby={titulo} onClose={aoFechar}>
      <form onSubmit={enviar}>
        <div className="dialog-head">
          <h2 id={titulo}>Nova auditoria</h2>
          <button className="close" type="button" onClick={aoFechar} aria-label="Fechar">
            ×
          </button>
        </div>
        <p className="muted small">
          {dadosFicticios
            ? "Escolha um cliente fictício e uma competência para acompanhar o fluxo."
            : "Os clientes são as pastas de Inteligência Tributária no OneDrive. Escolha o cliente e a competência."}
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
          <label>
            Competência
            <select
              value={competencia}
              onChange={(e) => setCompetencia(e.target.value)}
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
            {pasta && semCompetencias && (
              <span className="field-hint" role="status">
                A pasta do cliente não tem subpastas de competência.
              </span>
            )}
          </label>
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
          <button className="primary" disabled={!pasta || !competencia || enviando}>
            {enviando ? "Iniciando…" : "Iniciar auditoria"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
