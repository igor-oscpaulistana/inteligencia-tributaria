"""Máquina de estados do processo. As travas (gates) humanas são impostas AQUI, em código,
e não apenas no prompt: o agente não consegue aprovar nada nem protocolar sem aprovação.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

from legalizacao.config import Config, carregar_config
from legalizacao.integrations.portais import viabilidade_necessaria
from legalizacao.models import Aprovacao, Etapa, Gate, Processo, TipoDocumento
from legalizacao.rules import documentos, societario

ORDEM = list(Etapa)

GATE_DA_ETAPA = {
    Gate.REVISAO_CONTRATO: Etapa.REVISAO_HUMANA,
    Gate.ASSINATURAS: Etapa.ASSINATURAS,
    Gate.PAGAMENTO: Etapa.PAGAMENTO_TAXAS,
    Gate.ENVIO_PROTOCOLO: Etapa.PROTOCOLO,
}


def hash_arquivo(caminho: str | None) -> str | None:
    if not caminho or not Path(caminho).exists():
        return None
    return hashlib.sha256(Path(caminho).read_bytes()).hexdigest()


def contrato_inalterado_desde_aprovacao(processo: Processo) -> bool:
    return bool(processo.hash_contrato_aprovado) and processo.hash_contrato_aprovado == hash_arquivo(processo.contrato_md)


def bloqueios(processo: Processo, config: Config | None = None) -> list[str]:
    """O que impede o processo de sair da etapa atual."""
    config = config or carregar_config()
    e = processo.etapa
    motivos: list[str] = []

    if e == Etapa.RECEPCAO_DOCUMENTOS:
        if not processo.documentos:
            motivos.append("Nenhum documento recebido.")
        pend = [d.nome_arquivo for d in processo.documentos if d.tipo == TipoDocumento.NAO_IDENTIFICADO]
        if pend:
            motivos.append("Documentos ainda não extraídos/classificados: " + ", ".join(pend))

    elif e == Etapa.COLETA_DADOS:
        if not processo.socios_ativos():
            motivos.append("Quadro societário não informado.")
        faltando = [i for i in documentos.checklist(processo, config) if not i.satisfeito and not i.politica_interna]
        motivos += [f"Checklist: {i.item}" + (f" ({i.titular})" if i.titular else "") for i in faltando]

    elif e == Etapa.ANALISE_SOCIETARIA:
        erros = [a for a in societario.analisar(processo, config) if a.severidade == societario.Severidade.ERRO]
        motivos += [f"[{a.regra}] {a.mensagem}" for a in erros]

    elif e == Etapa.VIABILIDADE:
        if viabilidade_necessaria(processo):
            if not processo.viabilidade:
                motivos.append("Viabilidade não consultada.")
            elif processo.viabilidade.status != "deferida":
                motivos.append(f"Viabilidade com status '{processo.viabilidade.status}'.")

    elif e == Etapa.ELABORACAO_CONTRATO:
        if not processo.contrato_md or not Path(processo.contrato_md).exists():
            motivos.append("Minuta do contrato não gerada.")
        if not processo.revisao_ia:
            motivos.append("Revisão automática (IA) da minuta não executada.")

    elif e == Etapa.REVISAO_HUMANA:
        if not processo.aprovado(Gate.REVISAO_CONTRATO):
            motivos.append("Aguardando aprovação humana da minuta (gate revisao_contrato).")
        elif not contrato_inalterado_desde_aprovacao(processo):
            motivos.append("A minuta foi alterada depois da aprovação: nova aprovação necessária.")

    elif e == Etapa.DBE:
        if not processo.dbe:
            motivos.append("DBE não gerado.")

    elif e == Etapa.ASSINATURAS:
        if not processo.aprovado(Gate.ASSINATURAS):
            motivos.append("Aguardando confirmação humana de que todos assinaram (gate assinaturas).")

    elif e == Etapa.PAGAMENTO_TAXAS:
        if not processo.aprovado(Gate.PAGAMENTO):
            motivos.append("Aguardando confirmação humana do pagamento do DARE (gate pagamento).")

    elif e == Etapa.PROTOCOLO:
        if not processo.protocolo:
            motivos.append("Ato ainda não protocolado na Junta.")

    elif e == Etapa.ACOMPANHAMENTO:
        if not processo.protocolo or processo.protocolo.status != "deferido":
            motivos.append("Ato ainda não deferido pela Junta.")
        abertas = [x for x in processo.exigencias if not x.cumprida]
        if abertas:
            motivos.append(f"{len(abertas)} exigência(s) da Junta em aberto.")

    elif e == Etapa.CONCLUIDO:
        motivos.append("Processo concluído.")

    return motivos


def avancar(processo: Processo, ator: str, config: Config | None = None) -> tuple[bool, list[str]]:
    motivos = bloqueios(processo, config)
    if motivos:
        return False, motivos
    anterior = processo.etapa
    proxima = ORDEM[ORDEM.index(anterior) + 1]
    # Alteração que não exige viabilidade pula a etapa.
    if proxima == Etapa.VIABILIDADE and not viabilidade_necessaria(processo):
        proxima = Etapa.ELABORACAO_CONTRATO
    processo.etapa = proxima
    processo.registrar(ator, "etapa_avancada", f"{anterior.value} -> {proxima.value}")
    return True, []


def retornar(processo: Processo, destino: Etapa, ator: str, motivo: str) -> list[Gate]:
    """Volta a uma etapa anterior e invalida as aprovações das etapas seguintes."""
    if ORDEM.index(destino) >= ORDEM.index(processo.etapa):
        raise ValueError("Só é possível retornar para uma etapa anterior.")
    invalidadas = [
        a.gate for a in processo.aprovacoes if ORDEM.index(GATE_DA_ETAPA[a.gate]) >= ORDEM.index(destino)
    ]
    processo.aprovacoes = [a for a in processo.aprovacoes if a.gate not in invalidadas]
    if Gate.REVISAO_CONTRATO in invalidadas:
        processo.hash_contrato_aprovado = None
    anterior = processo.etapa
    processo.etapa = destino
    processo.registrar(ator, "etapa_retornada", f"{anterior.value} -> {destino.value}: {motivo}")
    return invalidadas


def aprovar(processo: Processo, gate: Gate, aprovado_por: str, observacao: str | None = None) -> None:
    """Somente chamado pela interface humana (CLI). Nunca exposto como ferramenta do agente."""
    if processo.etapa != GATE_DA_ETAPA[gate]:
        raise ValueError(
            f"O gate '{gate.value}' só pode ser aprovado na etapa '{GATE_DA_ETAPA[gate].value}' "
            f"(etapa atual: '{processo.etapa.value}')."
        )
    if gate == Gate.REVISAO_CONTRATO:
        h = hash_arquivo(processo.contrato_md)
        if not h:
            raise ValueError("Não há minuta gerada para aprovar.")
        processo.hash_contrato_aprovado = h
    if gate == Gate.ENVIO_PROTOCOLO:
        faltam = [g.value for g in (Gate.REVISAO_CONTRATO, Gate.ASSINATURAS, Gate.PAGAMENTO) if not processo.aprovado(g)]
        if faltam:
            raise ValueError("Aprovações anteriores ausentes: " + ", ".join(faltam))
    processo.aprovacoes = [a for a in processo.aprovacoes if a.gate != gate]
    processo.aprovacoes.append(Aprovacao(gate=gate, aprovado_por=aprovado_por, observacao=observacao))
    processo.solicitacoes_aprovacao = [s for s in processo.solicitacoes_aprovacao if s.gate != gate]
    processo.registrar(f"humano:{aprovado_por}", "aprovacao", gate.value + (f" - {observacao}" if observacao else ""))


def pode_protocolar(processo: Processo) -> list[str]:
    motivos = []
    if processo.etapa != Etapa.PROTOCOLO:
        motivos.append(f"Processo está na etapa '{processo.etapa.value}', não em 'protocolo'.")
    for g in Gate:
        if not processo.aprovado(g):
            motivos.append(f"Falta aprovação humana: {g.value}.")
    if not contrato_inalterado_desde_aprovacao(processo):
        motivos.append("A minuta mudou desde a aprovação humana.")
    if processo.protocolo:
        motivos.append(f"Já protocolado: {processo.protocolo.numero}.")
    return motivos
