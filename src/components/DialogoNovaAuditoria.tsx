"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

export interface ClienteDoPainel {
  id: string;
  nome: string;
}

interface OpcaoCompetencia {
  valor: string;
  rotulo: string;
}

interface Props {
  aberto: boolean;
  clientes: ClienteDoPainel[];
  dadosFicticios: boolean;
  aoFechar: () => void;
  /** Inicia a auditoria; devolve uma mensagem de erro ou null quando deu certo. */
  aoIniciar: (clienteId: string, competencia: string) => Promise<string | null>;
}

type Carga =
  | { estado: "carregando" }
  | { estado: "pronta"; opcoes: OpcaoCompetencia[]; pastaEncontrada: boolean }
  | { estado: "erro"; mensagem: string };

export function DialogoNovaAuditoria({ aberto, clientes, dadosFicticios, aoFechar, aoIniciar }: Props) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const titulo = useId();
  const [clienteId, setClienteId] = useState(clientes[0]?.id ?? "");
  const [competencia, setCompetencia] = useState("");
  const [carga, setCarga] = useState<Carga>({ estado: "carregando" });
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const elemento = dialogo.current;
    if (!elemento) return;
    if (aberto && !elemento.open) elemento.showModal();
    if (!aberto && elemento.open) elemento.close();
  }, [aberto]);

  // Competências com pasta no OneDrive para o cliente escolhido.
  useEffect(() => {
    if (!aberto || !clienteId) return;
    const controle = new AbortController();
    fetch(`/api/clientes/${clienteId}/competencias`, { signal: controle.signal })
      .then(async (resposta) => {
        const corpo = await resposta.json();
        if (!resposta.ok) throw new Error(corpo.erro ?? "Não foi possível listar as competências.");
        const opcoes = corpo.competencias as OpcaoCompetencia[];
        setCarga({ estado: "pronta", opcoes, pastaEncontrada: corpo.pastaEncontrada });
        setCompetencia(opcoes[0]?.valor ?? "");
      })
      .catch((falha: Error) => {
        if (falha.name !== "AbortError") setCarga({ estado: "erro", mensagem: falha.message });
      });
    return () => controle.abort();
  }, [aberto, clienteId]);

  function escolherCliente(id: string) {
    setClienteId(id);
    setCompetencia("");
    setCarga({ estado: "carregando" });
    setErro(null);
  }

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (!clienteId || !competencia || enviando) return;
    setEnviando(true);
    setErro(null);
    const falha = await aoIniciar(clienteId, competencia);
    setEnviando(false);
    if (falha) setErro(falha);
  }

  const opcoes = carga.estado === "pronta" ? carga.opcoes : [];
  const semCompetencias = carga.estado === "pronta" && opcoes.length === 0;

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
            : "Escolha o cliente e a competência. Os arquivos são lidos da pasta Inteligência Tributária no OneDrive."}
        </p>

        {clientes.length === 0 ? (
          <p className="notice" role="status" style={{ marginTop: 16 }}>
            Você ainda não tem permissão em nenhum cliente. Peça o acesso a um administrador.
          </p>
        ) : (
          <div className="fields">
            <label>
              Cliente
              <select value={clienteId} onChange={(e) => escolherCliente(e.target.value)} required>
                {clientes.map((cliente) => (
                  <option key={cliente.id} value={cliente.id}>
                    {cliente.nome}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Competência
              <select
                value={competencia}
                onChange={(e) => setCompetencia(e.target.value)}
                disabled={carga.estado !== "pronta" || semCompetencias}
                required
              >
                {carga.estado === "carregando" && <option value="">Carregando…</option>}
                {semCompetencias && <option value="">Nenhuma competência encontrada</option>}
                {opcoes.map((opcao) => (
                  <option key={opcao.valor} value={opcao.valor}>
                    {opcao.rotulo}
                  </option>
                ))}
              </select>
              {semCompetencias && (
                <span className="field-hint" role="status">
                  {carga.pastaEncontrada
                    ? "A pasta do cliente não tem subpastas de competência."
                    : "A pasta deste cliente não foi encontrada em Inteligência Tributária."}
                </span>
              )}
            </label>
          </div>
        )}

        {(erro || carga.estado === "erro") && (
          <p className="notice error" role="alert">
            {erro ?? (carga.estado === "erro" ? carga.mensagem : null)}
          </p>
        )}

        <div className="dialog-actions">
          <button className="secondary" type="button" onClick={aoFechar}>
            Cancelar
          </button>
          <button className="primary" disabled={!clienteId || !competencia || enviando}>
            {enviando ? "Iniciando…" : "Iniciar auditoria"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
