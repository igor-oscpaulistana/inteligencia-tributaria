# E-Alex — revisão de UI/UX

Repositório: `igor-oscpaulistana/inteligencia-tributaria`. Branch de trabalho: `ccr-4374b18f-ngtakq`. Base: `e7b67b4c6036b24f9fa06109acaba3bf1c6023be`.

## Diagnóstico e direção visual

O painel original tinha uma cena de Escritório expressiva, mas o restante do produto usava cartões pouco diferenciados, tabelas com texto de 12 px e formulários compactos. O login não explicava o contexto da ferramenta. O estado vazio dependia de uma única frase, e a identidade variava entre “Inteligência Tributária” e “Escritório virtual”.

A proposta usa o azul-marinho da sala como referência para a identidade, com superfícies claras para leitura documental. A hierarquia separa contexto, resultado, indicadores e evidências. A cor de destaque identifica a ação principal e o primeiro indicador; sucesso, alerta e erro continuam acompanhados de texto, sem depender só da cor.

Público assumido: analistas tributários autorizados, com uso frequente no desktop e consulta em tablet/celular. Não foi adicionada dependência de fontes externas.

## Design system implementado

Código pronto para uso: [`src/app/ealex.css`](../src/app/ealex.css). A importação ocorre após o CSS original no layout raiz. Os novos tokens têm prefixo próprio e não substituem os tokens herdados pelo Escritório.

| Papel | Token | Valor |
|---|---|---|
| Texto principal | `--ea-ink` | `#15233b` |
| Texto secundário | `--ea-muted` | `#52627a` |
| Identidade / cabeçalho | `--ea-navy` | `#102039` |
| Ação principal | `--ea-accent` | `#1756c7` |
| Hover de ação | `--ea-accent-hover` | `#10459f` |
| Superfície | `--ea-surface` | `#ffffff` |
| Superfície secundária | `--ea-soft` | `#edf2f8` |
| Divisórias | `--ea-line` | `#d4deeb` |
| Borda de campos | `--ea-field` | `#8494ab` |
| Sucesso | `--ea-success` | `#096548` |
| Erro | `--ea-danger` | `#a52b25` |

- Tipografia: Segoe UI, Inter quando disponível, system-ui. Texto principal de 14–15 px, tabelas de 13 px, metadados de 12 px, títulos de seção de 23–26 px. A tipografia interna do Escritório permanece original.
- Espaçamento: 4, 8, 12, 16, 24, 32 e 48 px. Painéis com 24 px no desktop e 16 px no celular.
- Cartões: raio de 12 px, borda discreta, sombra leve. A seção de resultados usa uma superfície de agrupamento, sem competir com a cena.
- Botões: alvo mínimo de 44 px nas áreas redesenhadas; estados normal, hover, foco e desabilitado. Campos com altura mínima de 48 px.
- Foco: contorno de 3 px com afastamento; tabelas roláveis recebem foco e nome acessível. Link inicial de teclado leva diretamente à triagem.
- Responsividade: indicadores em quatro colunas no desktop e duas abaixo de 1000 px; evidências em uma coluna no tablet; login em uma coluna abaixo de 640 px; tabelas preservam todas as colunas com rolagem interna.
- A interface continua com o tema claro existente e o cabeçalho marinho. Não foi criado controle de tema nem alterada a aparência do Escritório para simular modo escuro. O SVG usa `currentColor` e funciona sobre superfícies claras e escuras.

## Mudanças por tela

| Tela ou área | Alterado | Mantido |
|---|---|---|
| Cabeçalho | Marca E-Alex, BMX monocromática, fundo marinho, identificação do modo demonstrativo e foco visível | Usuário, condição de exibição do modo demo, ação de sair e rota da senha |
| Abertura do painel | Nome E-Alex com ícone, apresentação da ação principal, atalho de teclado para a triagem | Mesmo botão e mesmas condições de habilitação |
| **Escritório** | **Nenhuma alteração interna** | JSX da sala e do painel lateral, cena, estações, agentes, animações, interações, fontes, cores, dimensões e CSS original |
| Triagem vazia | Ícone decorativo, título e orientação para a próxima ação | Nenhuma execução criada automaticamente |
| Triagem em andamento/falha | Título do estado, hierarquia e anúncio acessível de falha | Mesmos dados, mensagens de falha, consultas e condições |
| Triagem concluída | Banner de resultado, indicadores alinhados, leitura progressiva de evidências, texto maior em tabelas, badges e estados de pendências | Valores, classificação, filtros, agrupamentos, cálculos e regras de aptidão |
| Arquivos fora do cálculo | Summary com alvo de toque maior e região rolável nomeada | Mesma expansão, carregamento sob demanda, listagem e mensagens |
| Nova auditoria | Modal com mais espaço, cabeçalho contextual, campos maiores e rodapé de ações | Cliente, competência, consulta de pastas, validações, fechamento e início da execução |
| Login | Composição em duas colunas, contexto do produto e ajuda para solicitar acesso | Credenciais, action, campos, autocomplete e autenticação |
| Alteração de senha | Marca, hierarquia do formulário e feedback visual verde de sucesso | Tamanho mínimo, confirmação, action, validações e momento de vigência da senha |
| Acesso negado / abertura | Marca e nome E-Alex, espaçamento e estado de abertura | Autorização, redirects, leitura da sessão e dados iniciais |
| Rodapé | Identidade discreta e descrição do produto | Sem novas ações ou integrações |
| Título da aba | E-Alex em todas as páginas existentes | Estrutura de rotas e metadados técnicos |

O arquivo `Escritorio.tsx` concentra também o cabeçalho, a introdução, o estado vazio e o rodapé. As mudanças nesse arquivo se limitam a essas áreas externas ao módulo protegido. O bloco completo `.office-layout`, incluindo o painel de atividade, permaneceu idêntico à base.

As menções a “Inteligência Tributária” que designam a pasta no OneDrive foram preservadas, inclusive nas instruções do diálogo. Esse é um nome operacional de uma integração existente, não a marca do sistema.

## Ícone SVG

Arquivo entregue: [`public/e-alex-bmx.svg`](../public/e-alex-bmx.svg). Componente inline usado pela aplicação: [`MarcaEalex.tsx`](../src/components/MarcaEalex.tsx).

A simplificação preserva capacete, postura do ciclista em pé, quadro e duas rodas. Detalhes de vestuário e hachuras foram reduzidos para manter leitura a 16–24 px. O ícone é alinhado ao texto por flexbox e usa `currentColor`. No componente, ele é decorativo (`aria-hidden`), pois o texto ao lado já identifica a marca. O SVG independente tem nome acessível.

Para herdar a cor do texto do elemento pai, use o SVG inline, como no componente; um SVG carregado por `<img>` não herda a cor do documento externo.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Ciclista em uma BMX">
  <circle cx="6.5" cy="25" r="5"/>
  <circle cx="25.5" cy="25" r="5"/>
  <path d="m6.5 25 6-10 5 10h-11L22 17l3.5 8M22 17l-1-4h3M11 15h4M17.5 25l-2 2h3"/>
  <path d="m18 10-5 3-3-3 6-4 4 2 2 5M13 13l4 5-2 5M10 10l-2 7 3 4"/>
  <path d="M17 5a3.5 3.5 0 0 1 7 0h-7Zm1 0v2l2 2 2-1 1-3M21 6h2"/>
</svg>
```

## Slides e módulos ainda ausentes

Não há arquivos, telas, editor ou módulo de slides nesta branch. Também não há telas independentes de Auditoria, Relatório e Retificação: essas etapas aparecem nas estações existentes e são descritas como futuras no README. Não foram criadas funcionalidades para preencher essas lacunas.

Proposta visual para slides, quando os arquivos forem disponibilizados: formato 16:9, margens de 48 px, título de 32–40 px, corpo de 20–24 px, uma conclusão por página, no máximo duas colunas e rodapé discreto com cliente/competência. Usar os tokens de cor existentes, texto escuro sobre fundo claro e destaque azul apenas para a informação principal. Essa proposta não foi aplicada a slides inexistentes.

## Validação

- `npm test`: **7 arquivos e 63 testes passaram**, sem alterações nos testes existentes.
- `npm run lint`: passou.
- `npm run typecheck`: passou.
- `npm run build`: passou; o build foi executado fora do sandbox porque os subprocessos de TypeScript falharam sob a restrição inicial.
- `npm run test:db`: passou, com a mensagem “OK: todas as regras foram verificadas.” PostgreSQL 17 local e descartável, com as migrações e stubs existentes. A instância foi desligada ao final; nenhuma conexão real foi usada.
- Chromium sobre o build de produção: painel, login, senha e diálogo em 1440, 768 e 390 px, sem transbordamento horizontal da página. A rolagem de tabelas é interna e intencional.
- Comparação de 62 elementos fora do SVG dentro de `.office-layout`: mesmos estilos computados e dimensões nos três tamanhos. Comparação de fonte: JSX do módulo, `CenaEscritorio.tsx` e `globals.css` idênticos à base.
- Fluxo demonstrativo existente: seleção de cliente e competência, início, acompanhamento e resultado; verificados resultado não apto e resultado apto, além da expansão de arquivos.
- Falha de consulta simulada apenas no navegador: mensagem de erro visível e botão de início desabilitado.
- Diálogo fechado por Escape; campos obrigatórios do login/senha mantiveram a validação nativa.
- axe-core com regras WCAG A/AA e WCAG 2.1 AA: nenhuma violação automática encontrada em painel vazio, diálogo, triagem concluída, triagem no celular, login e senha. Auditoria automática não equivale a certificação completa nem substitui avaliação com tecnologias assistivas.

## Limites e decisões humanas

1. **Slides:** é necessário identificar ou fornecer os arquivos do módulo. Nenhum slide foi alterado porque nenhum existe na branch inspecionada.
2. **Redução de etapas de trabalho:** o atalho visual para a triagem foi adicionado, mas não foram eliminadas confirmações, alterados fluxos ou inventados novos módulos para reduzir cliques.
3. **Dados reais e acesso negado:** a apresentação foi ajustada, mas o ambiente não recebeu credenciais reais para validar sessões de produção. O fluxo demonstrativo existente foi usado para a revisão visual.
4. **Auditoria, relatório e retificação futuros:** seguem com a implementação e os limites originais. Não foram alterados agentes, prompts, integrações, variáveis, APIs, arquivos de configuração, migrations, regras fiscais, CI/CD, hooks ou secrets.
5. **Publicação:** somente a branch de trabalho recebe os novos commits. A CLI disponível usa uma conta pessoal sem permissão; a publicação usa a conexão GitHub Profissional autorizada. A branch principal não é atualizada e não há force push.
