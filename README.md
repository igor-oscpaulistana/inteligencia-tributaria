# Inteligência Tributária

Escritório virtual com quatro agentes (Triagem, Auditoria, Relatório e Retificação) para auditar PIS e COFINS sobre notas fiscais de saída e preparar a EFD-Contribuições retificadora após aprovação humana.

O projeto está sendo construído por etapas, começando por um piloto de um cliente e uma competência.

| Etapa | Entrega | Situação |
| --- | --- | --- |
| 1 | Seleção de cliente e período, leitura do OneDrive, Triagem, escritório virtual, lista de auditorias, tela do cliente, redator com Claude Opus | Implementada |
| 2 | Auditoria: cruzamento XML × EFD-Contribuições × EFD ICMS/IPI e cálculo das diferenças | A fazer |
| 3 | Relatório: valores, gráfico, memória de cálculo por NF-e e uso do redator | A fazer |
| 4 | Aprovação humana e geração do TXT da EFD-Contribuições retificadora | A fazer |

## Como rodar

```bash
npm install
npm run dev        # http://localhost:3000
```

Sem variáveis de ambiente o painel abre em **modo de demonstração**: dados fictícios, sem login e execuções guardadas em memória. O modo real exige Supabase e OneDrive configurados (ver abaixo); copie `.env.example` para `.env.local`.

```bash
npm test           # testes unitários (Vitest)
npm run test:db    # migração e regras de acesso em um PostgreSQL local
npm run typecheck
npm run lint
npm run build
```

`npm run test:db` precisa de `psql` com permissão para criar bancos. Ele cria um banco descartável, simula os papéis do Supabase, aplica as migrações e verifica as regras.

## O que a etapa 1 faz

1. O usuário escolhe o cliente e o período: uma competência (exibida como `MM/AAAA`) ou várias, por exemplo de 01/2023 a 12/2023. Os clientes são as pastas de `Inteligência Tributária` e as competências, as subpastas de cada cliente.
2. `POST /api/execucoes` registra uma execução por competência do período e responde na hora; a leitura dos arquivos continua em segundo plano, uma competência de cada vez, e grava o andamento por etapa.
3. A **Triagem** localiza a pasta, lê os três conjuntos de arquivos, confere CNPJ e período e registra o que está ausente ou incompatível. Das notas, separa as de saída do cliente (as de entrada, de terceiros, canceladas, repetidas ou de outra competência ficam fora do cálculo).
4. O escritório virtual mostra o estado de cada estação a partir do que foi registrado. A Retificação aparece como **Aguardando aprovação** e não tem como iniciar.

5. Abaixo do escritório, a lista de auditorias mostra cliente, competência e situação. O nome do cliente abre a tela dele, com o consolidado do período e a conferência completa de cada competência.

A Triagem não calcula tributo. Cada arquivo lido entra no inventário com caminho, tamanho e SHA-256, para que as etapas seguintes sejam rastreáveis até a origem.

## Auditoria por período e fila

Um pedido de período vira uma execução por competência, todas no mesmo lote (`lote_id`, `periodo_inicio`, `periodo_fim`). A conferência é mensal e a Retificação também: cada competência tem a sua etapa de Retificação, que só sai de `aguardando_aprovacao` com aprovação humana. O período serve para acompanhar o conjunto e, nas próximas etapas, consolidar os valores.

As execuções de um pedido entram na fila e são processadas da mais antiga para a mais nova (`src/lib/execucoes/fila.ts`):

- uma função processa quantas competências couberem no tempo que a plataforma concede (300 s); antes de começar outra, estima se ela termina a tempo com base na mais demorada até ali;
- o que sobra continua na fila. A tela aberta chama `POST /api/execucoes/fila` para retomar; sem ninguém com a tela aberta, a fila espera;
- cada execução só pode ser assumida por um processo (a troca de `na_fila` para `em_andamento` é condicional);
- uma execução em andamento sem sinal de vida por 6 minutos é encerrada como falha, para não travar a fila. Basta auditar a competência de novo.

Um pedido tem no máximo 60 competências. Competências do período que já estão na fila ou em andamento são puladas.

A lista de auditorias (`GET /api/execucoes`) vem da visão `auditorias_atuais`: a execução mais recente de cada cliente e competência, com notas de saída e pendências. Auditar de novo uma competência substitui a linha dela; as execuções anteriores continuam no banco e na trilha.

## Estrutura de pastas no OneDrive

A navegação parte sempre da pasta `Inteligência Tributária` e só desce por listagem. Dois leiautes são aceitos:

```text
Inteligência Tributária/<Cliente>/<MM-AAAA>/
    XMLs/
    Sped_Contribuicoes.txt
    Sped_Fiscal.txt

Inteligência Tributária/<Cliente>/<AAAA>/<MM>/
    a. XML/
    b. SPED Contribuições/
    c. SPED Fiscal/
```

Os nomes servem apenas para chegar à competência. O tipo de cada arquivo é decidido pelo conteúdo: `.txt` com registro `0000` da EFD-Contribuições ou da EFD ICMS/IPI, `.xml` de NF-e, NFC-e ou CF-e SAT, e `.zip` contendo esses arquivos. Pode haver mais de uma EFD ICMS/IPI (uma por estabelecimento).

## Configuração para dados reais

### Supabase

1. Crie um projeto (sugestão: região `sa-east-1`) e aplique `supabase/migrations/`.
2. Preencha `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_SECRET_KEY`.
3. Crie cada usuário em Authentication (e-mail e senha) e inclua a conta na lista de autorizados:

```sql
insert into public.usuarios_autorizados (usuario_id)
select id from auth.users where email = '<e-mail do usuário>';
```

O acesso é só por e-mail e senha, com pelo menos 8 caracteres; a troca de senha fica em `/senha`. No painel do Supabase, em Authentication, ajuste o tamanho mínimo da senha para 8 e desative o cadastro de novos usuários.

No MVP não há segregação por analista: quem está em `usuarios_autorizados` vê e audita todos os clientes. Estar autenticado não basta; uma conta fora da lista não enxerga nada, nem as pastas do OneDrive.

Não há cadastro manual de clientes. Os clientes disponíveis são as pastas de `Inteligência Tributária`; o registro no banco é criado quando alguém pede a auditoria de uma pasta, e o CNPJ é gravado a partir da EFD-Contribuições na primeira triagem sem pendência impeditiva. As triagens seguintes são conferidas contra esse CNPJ.

O que o banco garante: só contas autorizadas leem e criam; andamento, triagem, inventário e CNPJ são gravados apenas pelo servidor; há uma única execução ativa por cliente e competência; a competência de uma execução fica dentro do período do pedido; a etapa de Retificação não sai de `aguardando_aprovacao`; a trilha de auditoria só aceita inclusão.

### OneDrive (Microsoft Graph e Entra ID)

O painel lê o OneDrive com credenciais de aplicativo e só emite requisições de leitura.

1. No Entra ID, registre um aplicativo (locatário único) e crie um segredo de cliente.
2. Em permissões de API do Microsoft Graph, adicione a permissão **de aplicativo** `Files.SelectedOperations.Selected` e dê o consentimento de administrador. Sozinha, essa permissão não dá acesso a nenhum arquivo.
3. Conceda ao aplicativo o papel de leitura **somente na pasta** `Inteligência Tributária`, criando uma permissão no item da pasta:

```http
POST https://graph.microsoft.com/v1.0/drives/{drive-id}/items/{item-id}/permissions

{ "roles": ["read"], "grantedTo": { "application": { "id": "<client id do aplicativo>" } } }
```

4. Preencha `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `ONEDRIVE_DRIVE_ID` e `ONEDRIVE_PASTA_RAIZ_ITEM_ID`.

O passo 3 foi escrito sem acesso à documentação da Microsoft; confira o corpo da requisição em “driveItem: create permission” e em “Overview of selected permissions in OneDrive and SharePoint” antes de executar.

O OneDrive real só é usado quando o Supabase também está configurado: sem autenticação o painel fica aberto e, por isso, só mostra dados fictícios.

### Claude (API da Anthropic)

A redação do relatório (etapa 3) usa o Claude Opus (`claude-opus-5-5`), no mesmo formato do HUB do Paralegal: SDK `@anthropic-ai/sdk`, `ANTHROPIC_API_KEY` no servidor, streaming e fallback do servidor em caso de recusa. O código está em `src/lib/redator/`.

O modelo recebe os achados já calculados em código e devolve um resumo e uma explicação por achado, em JSON com esquema. Ele não calcula nem altera valores; resposta que não cubra exatamente os achados enviados é rejeitada. Sem `ANTHROPIC_API_KEY`, entra um simulador que monta o texto com modelos fixos.

## Escritório virtual

A sala é uma cena isométrica em blocos desenhada em SVG pelo próprio código (`src/components/CenaEscritorio.tsx`), sem serviço externo. Cada personagem reflete o estado registrado da sua estação: ocioso, trabalhando (digita, com barras na tela), concluído, falhou e aguardando aprovação (cadeado).

Quem não está trabalhando circula pela sala (janela, bebedouro, quadro, estante, mesa dos colegas). Quem está trabalhando fica sempre sentado na própria mesa: quando a etapa entra em andamento, o personagem aparece na mesa na mesma hora. A circulação é só aparência: o estado de cada estação continua vindo do registro da execução. Com a preferência do sistema por movimento reduzido, todos permanecem sentados e sem animação.

As janelas acompanham a hora local do computador de quem acessa: sol de dia (das 6h às 18h), lua, estrelas e prédios iluminados à noite, e céu alaranjado perto do nascer e do pôr do sol. As logos da Souza Cardoso e da Paulistana ficam em um painel na parede do fundo (`public/marcas/`).

O desenho é decorativo para leitores de tela. Cada estação tem um botão sobreposto na cena, e a lista de estações abaixo dela e o painel de atividade dão o mesmo acesso por teclado.

## Arquitetura

```text
src/app/                  páginas e rotas de API (Next.js, App Router)
src/components/           escritório virtual, cena isométrica, lista de auditorias, tela do cliente, diálogo e painel de triagem
src/lib/agentes/          agente de Triagem e definição das quatro estações
src/lib/arquivos/         origem dos arquivos: Microsoft Graph, dados fictícios, leiaute de pastas
src/lib/fiscal/           leitura do cabeçalho do SPED e identificação dos XMLs
src/lib/execucoes/        execuções, fila, executor assíncrono, repositórios (Supabase e memória)
src/lib/redator/          redação do relatório: Claude Opus e simulador
supabase/migrations/      tabelas, permissões e políticas de acesso
supabase/testes/          testes das regras do banco
```

## Limites conhecidos da etapa 1

- O processamento em segundo plano usa `after()` do Next.js e termina junto com o tempo máximo da função (300 s configurados). Uma competência que sozinha passe disso (dezenas de milhares de XMLs avulsos) falha e precisa de workflow durável; entregar os XMLs em ZIP reduz muito o tempo de leitura.
- A fila só avança além do tempo de uma função enquanto alguém está com o painel aberto. Não há agendador no servidor.
- O período acumulado hoje reúne os resultados da Triagem (competências aptas, pendências, notas de saída). O cálculo consolidado das diferenças de PIS e COFINS chega com a etapa 2.
- Não há tela para excluir uma auditoria: a exclusão é feita no banco e fica registrada na trilha.
- Arquivos acima de 250 MB não são lidos.
- O modo de demonstração guarda as execuções na memória do processo: serve para rodar localmente, não em produção com várias instâncias.
- As escriturações fictícias têm só os registros de abertura e encerramento; não são arquivos válidos para o PVA.
