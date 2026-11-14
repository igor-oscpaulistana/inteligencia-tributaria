"""Loop do agente com o Tool Runner do SDK da Anthropic."""

from __future__ import annotations

from typing import Callable

import anthropic

from legalizacao.agent.prompts import SISTEMA
from legalizacao.agent.tools import Contexto, criar_ferramentas
from legalizacao.config import Config, carregar_config
from legalizacao.ia import BETAS, FALLBACKS
from legalizacao.integrations.portais import obter_portais
from legalizacao.store import ProcessoStore

INSTRUCAO_PADRAO = "Continue o processo de onde parou, até onde for possível sem intervenção humana."


def executar(
    processo_id: str,
    instrucao: str | None = None,
    config: Config | None = None,
    client: anthropic.Anthropic | None = None,
    ao_progredir: Callable[[str], None] = print,
    max_iteracoes: int = 60,
) -> str:
    config = config or carregar_config()
    store = ProcessoStore(config)
    processo = store.carregar(processo_id)
    client = client or anthropic.Anthropic()
    ctx = Contexto(processo, store, config, client, obter_portais(config))
    ferramentas = criar_ferramentas(ctx)

    mensagem = (
        f"Processo {processo.id} ({processo.tipo_ato.value}) do cliente {processo.cliente_nome}.\n"
        f"Modo dos portais: {config.modo}.\n\n"
        f"Instrução do analista: {instrucao or INSTRUCAO_PADRAO}"
    )

    runner = client.beta.messages.tool_runner(
        model=config.modelo,
        max_tokens=16000,
        betas=BETAS,
        fallbacks=FALLBACKS,
        output_config={"effort": config.esforco},
        system=[{"type": "text", "text": SISTEMA}],
        cache_control={"type": "ephemeral"},
        tools=ferramentas,
        messages=[{"role": "user", "content": mensagem}],
        max_iterations=max_iteracoes,
        # Sem "message threads": o histórico não fica retido no servidor (dados pessoais / LGPD).
        thread=False,
    )

    final = None
    for msg in runner:
        final = msg
        for bloco in msg.content:
            if bloco.type == "tool_use":
                ao_progredir(f"  -> {bloco.name}")
    if final is None:
        return "O agente não produziu resposta."
    if final.stop_reason == "refusal":
        return "O modelo recusou a solicitação; revise o processo manualmente."
    if final.stop_reason == "tool_use":
        aviso = f"\n\n[Limite de {max_iteracoes} iterações atingido; rode o agente novamente para continuar.]"
    elif final.stop_reason == "max_tokens":
        aviso = "\n\n[Resposta truncada por max_tokens.]"
    else:
        aviso = ""
    texto = "\n".join(b.text for b in final.content if b.type == "text")
    return (texto or "(sem resumo textual)") + aviso
