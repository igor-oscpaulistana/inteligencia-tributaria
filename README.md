# Assistente executivo no WhatsApp

Agente que atende o CEO e os clientes dele pelo WhatsApp, administra a agenda do Outlook, envia lembretes de compromissos e resume as notícias de sites estratégicos. Usa o Claude (Anthropic) como modelo.

## O que ele faz

**Com o CEO**

- Consulta, cria, altera e cancela compromissos direto no Outlook ("o que tenho amanhã?", "marca 1h com o jurídico na quinta às 15h", "adia essa para sexta").
- Encontra horários livres dentro do expediente.
- Envia lembretes antes de cada compromisso (por padrão, 60 e 15 minutos antes).
- Envia a agenda do dia pela manhã, junto com o resumo de notícias, e um segundo resumo no fim da tarde quando há novidades.
- Recebe os pedidos de reunião e recados dos clientes e registra a decisão ("aprovar 12", "recusar 12").
- Envia mensagens a contatos cadastrados em nome do CEO, cadastra clientes e bloqueia números.
- Mantém a lista de sites monitorados ("acompanhe também o site X").

**Com clientes**

- Apresenta-se como assistente virtual, informa horários livres e registra pedidos de reunião.
- O pedido reserva o horário na agenda como "a confirmar"; a reunião só é confirmada depois que o CEO aprova, e o cliente é avisado do resultado.
- Encaminha recados ao CEO para todo assunto que não seja agendamento.

**O que um cliente não consegue fazer**, por limite imposto no código e não só nas instruções do modelo: ver detalhes da agenda, alterar compromissos de terceiros, enviar mensagens a outros contatos ou ter mais de 2 pedidos pendentes. Números não cadastrados recebem o mesmo acesso restrito, e o CEO é avisado no primeiro contato.

## Arquitetura

| Parte | Tecnologia |
|---|---|
| Aplicação | Next.js (rotas de API) na Vercel |
| WhatsApp | WhatsApp Cloud API oficial da Meta (webhook) |
| Agenda | Microsoft Graph, com app registration no Entra ID |
| Banco | Supabase (Postgres): contatos, histórico, pedidos, notícias |
| Agendador | Vercel Cron: `/api/cron/tick` a cada 5 min, `/api/cron/news` a cada hora |
| Modelo | Claude Opus 5.5 via SDK da Anthropic |

Fluxo de uma mensagem: a Meta chama `POST /api/whatsapp/webhook` → a assinatura é validada → a rota responde 200 na hora e processa em seguida → o contato é identificado pelo telefone (CEO, cliente, desconhecido ou bloqueado) → o agente roda com as ferramentas do papel dele → a resposta volta pelo WhatsApp.

Código principal:

- `lib/agent/` — instruções (`prompts.ts`), ferramentas do CEO e do cliente, e a chamada ao Claude (`run.ts`).
- `lib/meetings.ts` — pedido, aprovação, recusa e cancelamento de reuniões.
- `lib/reminders.ts` — lembretes, agenda do dia e envio do resumo de notícias.
- `lib/news.ts` — coleta (RSS/Atom ou página HTML) e resumo.
- `lib/whatsapp.ts`, `lib/graph.ts`, `lib/store.ts` — integrações.

## Implantação

### 1. Supabase

Crie um projeto e aplique `supabase/migrations/0001_init.sql` (SQL Editor ou `supabase db push`). Anote a URL do projeto e a **service role key**. O RLS fica ligado sem políticas: só o servidor, com a service role key, acessa os dados.

### 2. Microsoft Entra ID (Outlook)

1. Em **App registrations**, crie um aplicativo e um **client secret**.
2. Em **API permissions**, adicione a permissão de **aplicativo** `Calendars.ReadWrite` do Microsoft Graph e conceda o consentimento do administrador.
3. Recomendado: restrinja o aplicativo à caixa do CEO no Exchange Online (RBAC for Applications). Sem isso, a permissão vale para as agendas de toda a organização.

### 3. WhatsApp Cloud API (Meta)

1. No Meta for Developers, crie um app do tipo Business, adicione o produto WhatsApp e vincule um número dedicado ao assistente (não pode ser um número em uso no aplicativo do WhatsApp).
2. Gere um **token permanente** de System User com as permissões `whatsapp_business_messaging` e `whatsapp_business_management`.
3. Crie um **modelo de mensagem** (categoria Utilidade, idioma `pt_BR`) com uma variável no corpo, por exemplo: `Aviso do seu assistente: {{1}}`. Ele é usado quando a janela de 24h está fechada (ver "Janela de 24 horas").
4. Depois do deploy, cadastre o webhook em **WhatsApp > Configuration**: URL `https://SEU-DOMINIO/api/whatsapp/webhook`, o verify token que você definiu, e assine o campo `messages`.

### 4. Vercel

1. Importe este repositório e configure as variáveis de `.env.example`.
2. O `vercel.json` agenda o cron a cada 5 minutos, o que exige o plano Pro. No plano Hobby (cron apenas diário), remova o bloco `crons` e agende pelo Supabase com `pg_cron` + `pg_net`:

```sql
select cron.schedule('assistente-tick', '*/5 * * * *', $$
  select net.http_get(
    url := 'https://SEU-DOMINIO/api/cron/tick',
    headers := jsonb_build_object('Authorization', 'Bearer SEU_CRON_SECRET')
  );
$$);
select cron.schedule('assistente-news', '10 * * * *', $$
  select net.http_get(
    url := 'https://SEU-DOMINIO/api/cron/news',
    headers := jsonb_build_object('Authorization', 'Bearer SEU_CRON_SECRET')
  );
$$);
```

### 5. Primeiro uso

O CEO envia uma mensagem qualquer para o número do assistente (isso registra o contato dele e abre a janela de 24h). A partir daí, pelo próprio WhatsApp:

- "Cadastre o cliente Fulano, telefone (11) 99999-0000, e-mail fulano@empresa.com"
- "Acompanhe as notícias de https://exemplo.com.br/feed"

Fontes de notícias aceitam o endereço de um feed RSS/Atom ou de uma página de notícias. Na primeira coleta de cada fonte, o que já está publicado serve de ponto de partida e não entra no resumo.

## Janela de 24 horas

A API oficial do WhatsApp só permite texto livre até 24 horas depois da última mensagem da pessoa. Fora desse prazo, só modelos aprovados pela Meta. O assistente trata isso automaticamente: dentro da janela envia texto normal; fora dela usa o modelo configurado em `WHATSAPP_TEMPLATE_NAME`, com o conteúdo em uma única linha. Sem o modelo configurado, lembretes e avisos enviados fora da janela falham (o erro aparece nos logs, e o lembrete é tentado de novo na passada seguinte).

Na prática, se o CEO fala com o assistente todo dia, quase tudo chega como texto normal.

## Configuração

Todas as variáveis estão descritas em `.env.example`. As mais usadas para ajustar o comportamento:

| Variável | Padrão | Efeito |
|---|---|---|
| `WORK_START` / `WORK_END` / `WORK_DAYS` | 09:00 / 18:00 / seg–sex | Expediente usado para oferecer horários |
| `REMINDER_LEAD_MINUTES` | `60,15` | Antecedências dos lembretes |
| `BRIEFING_TIME` | `07:30` | Agenda do dia + notícias |
| `NEWS_DIGEST_TIME` | `18:00` | Resumo extra de notícias (vazio desliga) |
| `NEWS_FOCUS` | — | Temas de interesse, usados para escolher as notícias |
| `CLIENT_MIN_NOTICE_HOURS` | `4` | Antecedência mínima para clientes |
| `ALLOW_UNKNOWN_CONTACTS` | `true` | Atender números não cadastrados |

## Segurança e privacidade

- O webhook só aceita requisições com a assinatura `X-Hub-Signature-256` válida; as rotas de cron exigem o `CRON_SECRET`.
- Texto vindo de clientes e de sites de notícias é tratado como dado. As permissões de cada papel são aplicadas no código das ferramentas.
- Quem não é o CEO tem limite de 40 mensagens por hora.
- O banco guarda o histórico das conversas, inclusive de clientes. Trate esses dados conforme a LGPD (base legal, prazo de retenção, aviso de privacidade aos clientes).
- As chamadas ao Claude usam o fallback automático da API (`fallbacks: "default"`): se o modelo principal recusar um pedido por política de segurança, a mesma requisição é reexecutada em outro modelo.

## Desenvolvimento

```bash
npm install
npm test          # testes com agenda, banco e WhatsApp simulados
npm run typecheck
npm run dev
```

Os testes cobrem as regras de negócio com serviços simulados e a chamada ao Claude contra um servidor local que imita a API. Eles não fazem chamadas reais à Meta, à Microsoft, ao Supabase nem à Anthropic.

## Limitações conhecidas

- Só mensagens de texto: áudio, imagens e documentos recebem um aviso pedindo texto.
- Uma única agenda (a do CEO) e um único número de WhatsApp.
- Preferências (expediente, horários dos resumos) são variáveis de ambiente; mudar exige novo deploy.
- A versão padrão da Graph API da Meta (`WHATSAPP_GRAPH_VERSION=v24.0`) deve ser conferida no painel do app no momento da implantação.
