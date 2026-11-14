# inteligencia-tributaria

## Agente analista de legalização (JUCESP)

Agente de IA que faz o trabalho de um analista de legalização, da **recepção dos documentos** até o
**protocolo do contrato social na JUCESP** e o acompanhamento até o deferimento.

Atos cobertos no MVP: constituição de **LTDA**, constituição de **SLU** e **alteração contratual** de LTDA.

```
recepção de documentos → coleta de dados → análise societária → viabilidade → elaboração do contrato
→ [revisão humana] → DBE → [assinaturas] → [pagamento DARE] → [protocolo] → acompanhamento → concluído
```

Etapas entre colchetes exigem aprovação humana, e essa trava está **no código**, não só no prompt.

### Como funciona

| Camada | O que faz | Onde |
|---|---|---|
| Agente (Claude + tool runner) | Conduz o processo, lê documentos, confronta dados, propõe CNAEs/objeto, pede pendências | `src/legalizacao/agent/` |
| IA pontual | Extração estruturada de RG/CNH/CIN, comprovantes, certidões, IPTU; revisão independente da minuta | `src/legalizacao/ia.py` |
| Regras determinísticas | Checklist de documentos; Código Civil, IN DREI 81/2020, LC 123/2006 (com fundamento legal) | `src/legalizacao/rules/` |
| Contrato social | Modelos Jinja2 revisáveis pelo jurídico → Markdown + DOCX | `src/legalizacao/contrato/` |
| Máquina de estados | Etapas, bloqueios, gates humanos, invalidação de aprovação se a minuta mudar | `src/legalizacao/workflow.py` |
| Portais | Viabilidade (REDESIM-SP), DBE (Coleta Nacional), protocolo JUCESP; simulados por padrão | `src/legalizacao/integrations/` |
| Interface humana | Abrir processo, enviar documentos, aprovar gates, registrar andamento | `legalizacao` (CLI) |

Detalhes, decisões e limites: [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

### Instalação

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env        # defina ANTHROPIC_API_KEY (ou use `ant auth login`)
pytest                       # testes sem rede
```

### Uso (exemplo de constituição de LTDA)

```bash
# 1. Abrir o processo com o briefing e os documentos recebidos do cliente
legalizacao novo --tipo constituicao_ltda --cliente "Alfa Tecnologia" --email cliente@exemplo.com \
    --briefing exemplos/briefing_constituicao_ltda.md docs/rg_ana.pdf docs/cnh_bruno.jpg docs/iptu.pdf

# 2. Rodar o agente (repita sempre que chegar algo novo)
legalizacao agente proc-1a2b3c4d
legalizacao docs proc-1a2b3c4d docs/comprovante_bruno.pdf     # documento que faltava
legalizacao nota proc-1a2b3c4d "Cliente confirmou: Bruno não será administrador"

# 3. Acompanhar
legalizacao status proc-1a2b3c4d --detalhes

# 4. Gates humanos (o agente só solicita; quem aprova é a pessoa)
legalizacao aprovar proc-1a2b3c4d revisao_contrato --por "Fulana (analista)"
legalizacao aprovar proc-1a2b3c4d assinaturas --por "Fulana" --arquivo contrato_assinado.pdf
legalizacao aprovar proc-1a2b3c4d pagamento   --por "Fulana" --arquivo dare_pago.pdf
legalizacao aprovar proc-1a2b3c4d envio_protocolo --por "Coordenador(a)"
legalizacao agente proc-1a2b3c4d               # protocola e passa a acompanhar

# 5. Andamento da Junta
legalizacao andamento proc-1a2b3c4d --status exigencia --texto "Corrigir objeto social" --por "Fulana"
legalizacao andamento proc-1a2b3c4d --status deferido --nire 35200000000 --cnpj 00000000000000 --por "Fulana"
```

### Modo simulação x produção

`LEGALIZACAO_MODO=simulacao` (padrão): viabilidade, DBE e protocolo são **simulados** (números `*-SIM-*`);
nada é enviado a órgão público. Os adaptadores reais (`integrations/junta/jucesp.py`) trazem o roteiro de
cada portal, mas os seletores da automação (Playwright + certificado digital/gov.br) ainda precisam ser
mapeados por quem tem acesso aos portais. Enquanto isso, em produção, o agente devolve a tarefa ao analista
com o roteiro manual em vez de fingir que protocolou.

### Avisos

- Os modelos de contrato são um ponto de partida e **devem ser revisados pelo jurídico** do escritório.
- A lista de CNAEs com possível vedação ao Simples é ilustrativa; a confirmação é do contador.
- `dados/` contém documentos pessoais de clientes (LGPD) e está no `.gitignore`.
