/**
 * Circulação dos personagens pela sala.
 *
 * Eles andam sobre poucas linhas livres do piso: o corredor do fundo (junto à
 * janela), o corredor da frente, uma coluna ao lado de cada mesa e uma coluna
 * junto ao quadro. Cada trecho de caminhada fica inteiro em uma linha, e cada
 * linha tem uma camada de desenho fixa; é isso que mantém a ordem correta
 * entre personagens e móveis sem ordenar nada quadro a quadro.
 *
 * Movimento é só aparência: quem trabalha, espera ou terminou vem do registro
 * da execução, nunca daqui.
 */

export type Ponto = readonly [number, number];
export type Direcao = "+x" | "-x" | "+y" | "-y";
/** Onde o personagem é desenhado em relação às estações. */
export type Camada = "fundo" | "frente" | "interno" | `corredor:${number}`;

export interface Trecho {
  de: Ponto;
  para: Ponto;
  camada: Camada;
  direcao: Direcao;
  /** Distância em unidades do piso (0 quando o personagem está parado). */
  distancia: number;
}

export interface PontoDeInteresse {
  id: string;
  ponto: Ponto;
  /** Para onde o personagem olha enquanto está parado ali. */
  direcao: Direcao;
}

export const QUANTIDADE_DE_ESTACOES = 4;

/** Canto de cada estação no piso; elas se alinham ao longo do eixo x. */
export const origemDaEstacao = (indice: number) => ({ x: 0.9 + indice * 2.85, y: 1.5 });

const Y_FUNDO = 0.9;
const Y_FRENTE = 4.25;
const X_QUADRO = 0.62;
const Y_ASSENTO = 0.63;

/** Coluna livre à direita da estação. */
const colunaDaEstacao = (indice: number) => origemDaEstacao(indice).x + 2.42;

/** Onde o personagem fica sentado. */
export function assento(indice: number): Ponto {
  const { x, y } = origemDaEstacao(indice);
  return [x + 1.0, y + Y_ASSENTO];
}

function beiradaDaMesa(indice: number): Ponto {
  const { x, y } = origemDaEstacao(indice);
  return [x + 2.05, y + Y_ASSENTO];
}

/** Ponto da coluna da estação na altura do assento: por onde se entra e sai da mesa. */
export function acessoDaMesa(indice: number): Ponto {
  return [colunaDaEstacao(indice), origemDaEstacao(indice).y + Y_ASSENTO];
}

interface Linha {
  camada: Camada;
  a: Ponto;
  b: Ponto;
}

const LINHAS: Linha[] = [
  { camada: "fundo", a: [X_QUADRO, Y_FUNDO], b: [colunaDaEstacao(QUANTIDADE_DE_ESTACOES - 1), Y_FUNDO] },
  { camada: "frente", a: [1.0, Y_FRENTE], b: [colunaDaEstacao(QUANTIDADE_DE_ESTACOES - 1), Y_FRENTE] },
  { camada: "corredor:-1", a: [X_QUADRO, Y_FUNDO], b: [X_QUADRO, 2.6] },
  ...Array.from({ length: QUANTIDADE_DE_ESTACOES }, (_, i): Linha => {
    const x = colunaDaEstacao(i);
    return { camada: `corredor:${i}`, a: [x, Y_FUNDO], b: [x, Y_FRENTE] };
  }),
];

export const PONTOS_DE_INTERESSE: PontoDeInteresse[] = [
  { id: "marcas", ponto: [2.2, Y_FUNDO], direcao: "-y" },
  { id: "janela-2", ponto: [5.0, Y_FUNDO], direcao: "-y" },
  { id: "janela-3", ponto: [7.6, Y_FUNDO], direcao: "-y" },
  { id: "janela-4", ponto: [10.2, Y_FUNDO], direcao: "-y" },
  { id: "bebedouro", ponto: [11.2, Y_FUNDO], direcao: "+x" },
  { id: "quadro", ponto: [X_QUADRO, 2.1], direcao: "-x" },
  { id: "estante", ponto: [1.0, Y_FRENTE], direcao: "-x" },
  { id: "frente-1", ponto: [4.4, Y_FRENTE], direcao: "+y" },
  { id: "frente-2", ponto: [7.3, Y_FRENTE], direcao: "+y" },
  { id: "frente-3", ponto: [10.3, Y_FRENTE], direcao: "+y" },
  ...Array.from(
    { length: QUANTIDADE_DE_ESTACOES },
    (_, i): PontoDeInteresse => ({
      id: `mesa-${i}`,
      ponto: [colunaDaEstacao(i), 3.2],
      direcao: "-x",
    }),
  ),
];

const EPS = 1e-6;
const igual = (a: Ponto, b: Ponto) => Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;
const distancia = (a: Ponto, b: Ponto) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function naLinha(p: Ponto, { a, b }: Linha): boolean {
  if (Math.abs(a[0] - b[0]) < EPS) {
    return (
      Math.abs(p[0] - a[0]) < EPS && p[1] >= Math.min(a[1], b[1]) - EPS && p[1] <= Math.max(a[1], b[1]) + EPS
    );
  }
  return (
    Math.abs(p[1] - a[1]) < EPS && p[0] >= Math.min(a[0], b[0]) - EPS && p[0] <= Math.max(a[0], b[0]) + EPS
  );
}

/** Verdadeiro quando o ponto está sobre alguma linha de circulação (pode ser origem de uma rota). */
export function sobreAsLinhas(p: Ponto): boolean {
  return LINHAS.some((linha) => naLinha(p, linha));
}

export function direcaoDoTrecho(de: Ponto, para: Ponto): Direcao {
  const dx = para[0] - de[0];
  const dy = para[1] - de[1];
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "+x" : "-x";
  return dy >= 0 ? "+y" : "-y";
}

function trecho(de: Ponto, para: Ponto, camada: Camada): Trecho {
  return { de, para, camada, direcao: direcaoDoTrecho(de, para), distancia: distancia(de, para) };
}

/**
 * Menor caminho entre dois pontos que estão sobre as linhas de circulação.
 * Devolve um trecho por linha percorrida; lista vazia quando origem e destino coincidem.
 */
export function rota(de: Ponto, para: Ponto): Trecho[] {
  if (igual(de, para)) return [];

  const nos: Ponto[] = [];
  const indiceDo = (p: Ponto) => {
    const existente = nos.findIndex((n) => igual(n, p));
    if (existente >= 0) return existente;
    nos.push(p);
    return nos.length - 1;
  };
  const origem = indiceDo(de);
  const destino = indiceDo(para);
  for (const linha of LINHAS) {
    indiceDo(linha.a);
    indiceDo(linha.b);
  }
  // Cruzamentos: toda ponta de linha que cai sobre outra linha já é nó.

  const vizinhos = new Map<number, Array<{ no: number; peso: number; camada: Camada }>>();
  const ligar = (a: number, b: number, camada: Camada) => {
    const peso = distancia(nos[a], nos[b]);
    vizinhos.set(a, [...(vizinhos.get(a) ?? []), { no: b, peso, camada }]);
    vizinhos.set(b, [...(vizinhos.get(b) ?? []), { no: a, peso, camada }]);
  };
  for (const linha of LINHAS) {
    const sobre = nos
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => naLinha(p, linha))
      .sort((m, n) => distancia(m.p, linha.a) - distancia(n.p, linha.a));
    for (let k = 1; k < sobre.length; k++) ligar(sobre[k - 1].i, sobre[k].i, linha.camada);
  }

  // Dijkstra em um grafo de poucos nós.
  const custo = nos.map(() => Infinity);
  const anterior = new Map<number, { no: number; camada: Camada }>();
  const visitados = new Set<number>();
  custo[origem] = 0;
  while (visitados.size < nos.length) {
    let atual = -1;
    for (let i = 0; i < nos.length; i++) {
      if (!visitados.has(i) && (atual < 0 || custo[i] < custo[atual])) atual = i;
    }
    if (atual < 0 || custo[atual] === Infinity) break;
    if (atual === destino) break;
    visitados.add(atual);
    for (const { no, peso, camada } of vizinhos.get(atual) ?? []) {
      if (custo[atual] + peso < custo[no]) {
        custo[no] = custo[atual] + peso;
        anterior.set(no, { no: atual, camada });
      }
    }
  }
  if (custo[destino] === Infinity) {
    throw new Error("Ponto fora das linhas de circulação da sala.");
  }

  const passos: Trecho[] = [];
  for (let no = destino; no !== origem; ) {
    const passo = anterior.get(no)!;
    passos.unshift(trecho(nos[passo.no], nos[no], passo.camada));
    no = passo.no;
  }
  // Junta passos seguidos na mesma linha em um único trecho.
  return passos.reduce<Trecho[]>((juntos, passo) => {
    const ultimo = juntos.at(-1);
    if (ultimo && ultimo.camada === passo.camada && ultimo.direcao === passo.direcao) {
      juntos[juntos.length - 1] = trecho(ultimo.de, passo.para, passo.camada);
    } else {
      juntos.push(passo);
    }
    return juntos;
  }, []);
}

/** Levantar da mesa e chegar à coluna ao lado dela. */
export function saidaDaMesa(indice: number): Trecho[] {
  return [
    trecho(assento(indice), beiradaDaMesa(indice), "interno"),
    trecho(beiradaDaMesa(indice), acessoDaMesa(indice), `corredor:${indice}`),
  ];
}

/** Da coluna ao lado da mesa até sentar. */
export function entradaNaMesa(indice: number): Trecho[] {
  return [
    trecho(acessoDaMesa(indice), beiradaDaMesa(indice), `corredor:${indice}`),
    trecho(beiradaDaMesa(indice), assento(indice), "interno"),
  ];
}

/** Personagem parado em um ponto, olhando em uma direção. */
export function parada(ponto: Ponto, camada: Camada, direcao: Direcao): Trecho {
  return { de: ponto, para: ponto, camada, direcao, distancia: 0 };
}

/** Posição em um trecho depois de percorrida a fração informada (0 a 1). */
export function posicaoNoTrecho(t: Trecho, fracao: number): Ponto {
  const f = Math.max(0, Math.min(1, fracao));
  return [t.de[0] + (t.para[0] - t.de[0]) * f, t.de[1] + (t.para[1] - t.de[1]) * f];
}
