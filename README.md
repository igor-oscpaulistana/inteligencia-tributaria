# Inteligência Tributária

Escritório virtual com quatro agentes (Triagem, Auditoria, Relatório e Retificação) para auditar PIS e COFINS sobre notas fiscais de saída e preparar a EFD-Contribuições retificadora após aprovação humana.

O projeto está sendo construído por etapas, começando por um piloto de um cliente e uma competência.

| Etapa | Entrega | Situação |
| --- | --- | --- |
| 1 | Seleção de cliente e competência, leitura do OneDrive, Triagem, escritório virtual | Implementada |
| 2 | Auditoria: cruzamento XML × EFD-Contribuições × EFD ICMS/IPI e cálculo das diferenças | A fazer |
| 3 | Relatório: valores, gráfico, memória de cálculo por NF-e e redação por modelo de linguagem | A fazer |
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

1. O analista escolhe o cliente e a competência (exibida como `MM/AAAA`). Só aparecem os clientes em que ele tem permissão e as competências que têm pasta no OneDrive.
2. `POST /api/execucoes` registra a execução e responde na hora; a leitura dos arquivos continua em segundo plano e grava o andamento por etapa.
3. A **Triagem** localiza a pasta, lê os três conjuntos de arquivos, confere CNPJ e período e registra o que está ausente ou incompatível. Das notas, separa as de saída do cliente (as de entrada, de terceiros, canceladas, repetidas ou de outra competência ficam fora do cálculo).
4. O escritório virtual mostra o estado de cada estação a partir do que foi registrado. A Retificação aparece como **Aguardando aprovação** e não tem como iniciar.

A Triagem não calcula tributo. Cada arquivo lido entra no inventário com caminho, tamanho e SHA-256, para que as etapas seguintes sejam rastreáveis até a origem.

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
3. Crie os usuários em Authentication (e-mail e senha) e cadastre clientes e permissões:

```sql
insert into public.clientes (nome, cnpj, pasta_onedrive)
values ('<Nome do cliente>', '<CNPJ só com letras e números>', '<Nome exato da pasta no OneDrive>');

insert into public.cliente_membros (cliente_id, usuario_id, papel)
values ('<id do cliente>', '<id do usuário em auth.users>', 'analista'); -- leitor | analista | administrador
```

O que o banco garante: cada usuário só vê os clientes em que é membro; só analistas e administradores criam execuções; andamento, triagem e inventário são gravados apenas pelo servidor; há uma única execução ativa por cliente e competência; a etapa de Retificação não sai de `aguardando_aprovacao`; a trilha de auditoria só aceita inclusão.

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

### Cena 3D (Spline)

Informe em `NEXT_PUBLIC_SPLINE_SCENE_URL` a URL do arquivo `.splinecode` exportado do Spline. A cena precisa seguir este contrato:

| Estação | Objeto clicável | Variável numérica |
| --- | --- | --- |
| Triagem | `Estacao_Triagem` | `estado_triagem` |
| Auditoria | `Estacao_Auditoria` | `estado_auditoria` |
| Relatório | `Estacao_Relatorio` | `estado_relatorio` |
| Retificação | `Estacao_Retificacao` | `estado_retificacao` |

Valores das variáveis: `0` ocioso, `1` trabalhando, `2` concluído, `3` falhou, `4` aguardando aprovação. Na cena, cada valor deve acionar o estado visual correspondente do personagem e da estação.

Sem a URL, sem WebGL, com erro ou se a cena não carregar em 15 segundos, o painel mostra a imagem do escritório com um marcador por estação. A lista de estações abaixo da cena e o painel de atividade funcionam nos dois casos, por teclado e leitor de tela.

### OpenAI

A redação do relatório (etapa 3) está isolada em `src/lib/redator/`: a interface `RedatorRelatorio` e um simulador. O conector real, com o OAuth da OpenAI no formato do Concilia AI, ainda não existe; a implementação de referência não estava acessível.

## Arquitetura

```text
src/app/                  páginas e rotas de API (Next.js, App Router)
src/components/           escritório virtual, cena Spline, diálogo e painel de triagem
src/lib/agentes/          agente de Triagem e definição das quatro estações
src/lib/arquivos/         origem dos arquivos: Microsoft Graph, dados fictícios, leiaute de pastas
src/lib/fiscal/           leitura do cabeçalho do SPED e identificação dos XMLs
src/lib/execucoes/        execuções, executor assíncrono, repositórios (Supabase e memória)
src/lib/redator/          interface e simulador da redação por modelo de linguagem
supabase/migrations/      tabelas, permissões e políticas de acesso
supabase/testes/          testes das regras do banco
```

## Limites conhecidos da etapa 1

- O processamento em segundo plano usa `after()` do Next.js e termina junto com o tempo máximo da função (300 s configurados). Competências com dezenas de milhares de XMLs avulsos podem precisar de fila ou workflow durável; entregar os XMLs em ZIP reduz muito o tempo de leitura.
- Arquivos acima de 250 MB não são lidos.
- O modo de demonstração guarda as execuções na memória do processo: serve para rodar localmente, não em produção com várias instâncias.
- As escriturações fictícias têm só os registros de abertura e encerramento; não são arquivos válidos para o PVA.
