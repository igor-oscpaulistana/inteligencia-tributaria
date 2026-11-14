# Arquitetura do agente analista de legalização

## 1. O trabalho do analista, etapa por etapa

| Etapa | Analista humano faria | O agente faz | Sai da etapa quando |
|---|---|---|---|
| `recepcao_documentos` | Recebe e organiza documentos | Extrai e classifica cada PDF/imagem com IA, associa ao sócio pelo CPF | Todos os documentos classificados |
| `coleta_dados` | Monta a ficha cadastral | Qualifica sócios e sociedade; confronta documento x informação do cliente; gera pendências e rascunhos de mensagem | Checklist obrigatório completo |
| `analise_societaria` | Confere impedimentos e consistência | Roda regras determinísticas (CC, IN DREI 81/2020, LC 123/2006) e explica cada achado | Nenhum erro |
| `viabilidade` | Pede viabilidade de nome/endereço na REDESIM-SP | Consulta o portal (simulado por padrão) | Viabilidade deferida (pulada em alteração que não muda nome/endereço/objeto) |
| `elaboracao_contrato` | Redige a minuta | Gera a minuta a partir de modelos aprovados + revisão independente por IA | Minuta gerada e revisada |
| `revisao_humana` | — | Solicita aprovação, com resumo dos riscos | **Humano aprova** (hash da minuta é registrado) |
| `dbe` | Preenche a Coleta Nacional | Gera o DBE (simulado por padrão) | DBE transmitido |
| `assinaturas` | Coleta assinaturas gov.br/ICP | Solicita e orienta os sócios | **Humano confirma** e anexa o PDF assinado |
| `pagamento_taxas` | Emite e paga o DARE | Solicita | **Humano confirma** e anexa o comprovante |
| `protocolo` | Protocola na JUCESP | Protocola somente com as 4 aprovações e a minuta inalterada | Protocolo registrado |
| `acompanhamento` | Acompanha, cumpre exigências | Consulta andamento; exigência vira pendência ou retorno de etapa | **Humano registra** deferimento |

## 2. Decisões de projeto

1. **Workflow + agente, não agente livre.** A ordem das etapas e os critérios de saída são código
   (`workflow.py`). O modelo decide *como* resolver cada etapa (ler documentos, cruzar dados, redigir
   objeto social, conversar com o cliente), mas não pode pular etapas.
2. **Travas humanas impostas em código.** O agente não tem ferramenta para aprovar gates. `aprovar()`
   só é chamada pela CLI; `protocolar_na_junta` verifica as quatro aprovações e se o SHA-256 da minuta
   é o mesmo aprovado. Regerar a minuta ou voltar etapa invalida as aprovações seguintes.
3. **Regras jurídicas determinísticas.** Validação de CPF/CNPJ, soma de quotas, cônjuges (CC art. 977),
   menores (CC art. 974 §3º), nome com "Limitada" (CC art. 1.158), SLU com sócio único etc. não dependem
   do LLM. O LLM explica e decide o encaminhamento.
4. **Texto do contrato vem de modelos.** Os modelos Jinja2 (`contrato/templates/`) são o ativo jurídico do
   escritório; o LLM preenche dados estruturados (e o texto das cláusulas de alteração). Isso evita
   cláusulas inventadas e torna a revisão humana previsível.
5. **Duas IAs para a minuta.** Quem gera (agente) não é quem revisa: `revisar_contrato` faz uma chamada
   independente com saída estruturada (crítico / importante / sugestão).
6. **Portais atrás de interfaces.** `PortalViabilidade`, `PortalDBE` e `PortalJunta` têm implementação
   simulada (padrão) e real (JUCESP/REDESIM via Playwright). Trocar o modo não muda o agente.

## 3. Uso da Claude API

- Modelo padrão `claude-opus-5-5` (configurável), raciocínio adaptativo, esforço `high` no agente,
  `medium` na extração e `high` na revisão.
- **Tool runner** do SDK (`client.beta.messages.tool_runner`) com 21 ferramentas tipadas (`@beta_tool` +
  Pydantic). Erros de ferramenta voltam ao modelo como `is_error` (`ToolError`).
- **Saída estruturada** (`messages.parse` + Pydantic) na extração de documentos e na revisão.
- **Fallback em recusa** do lado do servidor (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`).
- **Cache de prompt** automático (system prompt e ferramentas estáticos).
- `thread=False`: o histórico da conversa não fica retido no servidor (dados pessoais).

## 4. LGPD e segurança

- Documentos e processos ficam em `dados/` (fora do git). Em produção, use armazenamento criptografado
  e controle de acesso por processo; defina prazo de retenção.
- Base legal típica: execução de contrato com o cliente (LGPD art. 7º, V). Informe aos sócios o uso de IA
  no tratamento dos documentos.
- Certificados digitais e sessões gov.br nunca são expostos ao modelo: ficam no adaptador de portal.
- Todo evento (agente ou humano) é registrado em `historico` para auditoria.

## 5. Limites conhecidos e próximos passos

1. **Automação real dos portais** (VRE/Integrador SP, Coleta Nacional, protocolo JUCESP): mapear seletores
   com `playwright codegen` em ambiente com certificado; manter a mesma interface.
2. **Assinatura digital**: integrar com o assinador gov.br / plataforma ICP-Brasil para envio e conferência
   automática das assinaturas no PDF (hoje o humano confirma).
3. **DARE**: emissão automática da guia e conciliação do pagamento.
4. **Tabela CNAE completa** (IBGE/CONCLA) e matriz de vedações do Simples / riscos de licenciamento.
5. **Pós-registro**: inscrição municipal (CCM), estadual, alvará/licenças, enquadramento no Simples.
6. **Interface web** para cliente enviar documentos e analista aprovar gates (a CLI é a interface do MVP).
7. **Avaliação (evals)**: montar um conjunto de processos reais anonimizados para medir extração, detecção
   de problemas e taxa de exigências da Junta antes de ir para produção.
