"use client";

import Image from "next/image";
import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import type { Application, SplineEvent } from "@splinetool/runtime";
import { DEFINICOES_AGENTES } from "@/lib/agentes/definicoes";
import { CODIGO_ESTADO_VISUAL, type SituacaoEstacao } from "@/lib/execucoes/apresentacao";
import type { AgenteId } from "@/lib/execucoes/tipos";

const Spline = lazy(() => import("@splinetool/react-spline"));

/** Sem resposta da cena neste prazo, a imagem de reserva assume. */
const PRAZO_CARGA_MS = 15_000;

interface Props {
  /** URL do arquivo .splinecode. Sem ela, só a imagem de reserva é exibida. */
  urlCena: string | null;
  estacoes: SituacaoEstacao[];
  selecionada: AgenteId;
  aoSelecionar: (agente: AgenteId) => void;
}

class Contencao extends Component<{ aoFalhar: () => void; children: ReactNode }, { falhou: boolean }> {
  state = { falhou: false };
  static getDerivedStateFromError() {
    return { falhou: true };
  }
  componentDidCatch() {
    this.props.aoFalhar();
  }
  render() {
    return this.state.falhou ? null : this.props.children;
  }
}

function suportaWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * Cena do escritório. Com a cena do Spline carregada, as estações 3D são
 * clicáveis e recebem o estado da execução por variáveis; sem ela (URL não
 * configurada, WebGL indisponível, erro ou demora), aparece a imagem do
 * escritório com um marcador por estação. A lista de estações logo abaixo da
 * cena funciona nos dois casos.
 */
export function CenaEscritorio({ urlCena, estacoes, selecionada, aoSelecionar }: Props) {
  const [situacao, setSituacao] = useState<"reserva" | "carregando" | "pronta">("reserva");
  const aplicacao = useRef<Application | null>(null);

  useEffect(() => {
    if (!urlCena || !suportaWebGL()) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- o suporte a WebGL só é conhecido no navegador
    setSituacao("carregando");
    const prazo = window.setTimeout(
      () => setSituacao((atual) => (atual === "carregando" ? "reserva" : atual)),
      PRAZO_CARGA_MS,
    );
    return () => window.clearTimeout(prazo);
  }, [urlCena]);

  // Estado da execução → variáveis da cena.
  useEffect(() => {
    const app = aplicacao.current;
    if (situacao !== "pronta" || !app) return;
    for (const estacao of estacoes) {
      const definicao = DEFINICOES_AGENTES.find((d) => d.id === estacao.agente)!;
      try {
        app.setVariable(definicao.variavelSpline, CODIGO_ESTADO_VISUAL[estacao.visual]);
      } catch {
        // Cena sem a variável: a estação continua clicável, só não muda de aparência.
      }
    }
  }, [estacoes, situacao]);

  function aoClicarNaCena(evento: SplineEvent) {
    const definicao = DEFINICOES_AGENTES.find((d) => d.objetoSpline === evento.target.name);
    if (definicao) aoSelecionar(definicao.id);
  }

  const cena3d = situacao !== "reserva" && urlCena;

  return (
    <div className="scene">
      <Image
        className="scene-art"
        src="/escritorio.webp"
        width={1536}
        height={744}
        priority
        sizes="(max-width: 820px) 100vw, 860px"
        alt="Quatro agentes em estações de trabalho de um escritório com vista para a cidade"
      />
      {cena3d && (
        <div className="scene-3d" data-ready={situacao === "pronta"} aria-hidden="true">
          <Contencao aoFalhar={() => setSituacao("reserva")}>
            <Suspense fallback={null}>
              <Spline
                scene={urlCena}
                onLoad={(app) => {
                  aplicacao.current = app;
                  setSituacao("pronta");
                }}
                onSplineMouseDown={aoClicarNaCena}
                style={{ width: "100%", height: "100%" }}
              />
            </Suspense>
          </Contencao>
        </div>
      )}
      {situacao !== "pronta" && (
        <div className="scene-overlay">
          {DEFINICOES_AGENTES.map((definicao, indice) => {
            const estacao = estacoes.find((e) => e.agente === definicao.id)!;
            return (
              <button
                key={definicao.id}
                type="button"
                className={`beacon ${estacao.visual}`}
                style={{ "--station-color": definicao.cor, left: `${definicao.posicao}%` } as React.CSSProperties}
                aria-label={`Estação ${definicao.nome}: ${estacao.rotulo}`}
                aria-pressed={selecionada === definicao.id}
                onClick={() => aoSelecionar(definicao.id)}
              >
                {indice + 1}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
