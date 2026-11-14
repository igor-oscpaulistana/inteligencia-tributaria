import pytest

from legalizacao import workflow
from legalizacao.models import Etapa, Gate, ResultadoExterno


def test_gate_revisao_exige_hash(processo_ltda, tmp_path, config):
    from legalizacao.contrato.gerador import gerar
    g = gerar(processo_ltda, tmp_path)
    processo_ltda.contrato_md = str(g.caminho_md)
    processo_ltda.etapa = Etapa.REVISAO_HUMANA
    assert workflow.bloqueios(processo_ltda, config)
    workflow.aprovar(processo_ltda, Gate.REVISAO_CONTRATO, "Analista")
    assert workflow.bloqueios(processo_ltda, config) == []
    # minuta alterada depois da aprovação invalida o avanço
    g.caminho_md.write_text(g.markdown + "\nalterado", encoding="utf-8")
    assert any("alterada" in m for m in workflow.bloqueios(processo_ltda, config))


def test_gate_fora_da_etapa(processo_ltda):
    with pytest.raises(ValueError):
        workflow.aprovar(processo_ltda, Gate.PAGAMENTO, "Analista")


def test_pode_protocolar_exige_todas_aprovacoes(processo_ltda):
    processo_ltda.etapa = Etapa.PROTOCOLO
    motivos = workflow.pode_protocolar(processo_ltda)
    assert any("envio_protocolo" in m for m in motivos)


def test_retornar_invalida_aprovacoes(processo_ltda, tmp_path):
    from legalizacao.contrato.gerador import gerar
    processo_ltda.contrato_md = str(gerar(processo_ltda, tmp_path).caminho_md)
    processo_ltda.etapa = Etapa.REVISAO_HUMANA
    workflow.aprovar(processo_ltda, Gate.REVISAO_CONTRATO, "Analista")
    processo_ltda.etapa = Etapa.ASSINATURAS
    workflow.aprovar(processo_ltda, Gate.ASSINATURAS, "Analista")
    inval = workflow.retornar(processo_ltda, Etapa.ELABORACAO_CONTRATO, "agente", "exigência")
    assert set(inval) == {Gate.REVISAO_CONTRATO, Gate.ASSINATURAS}
    assert processo_ltda.aprovacoes == [] and processo_ltda.hash_contrato_aprovado is None


def test_alteracao_sem_viabilidade_pula_etapa(processo_ltda, config):
    from legalizacao.models import Alteracao, TipoAlteracao, TipoAto
    processo_ltda.tipo_ato = TipoAto.ALTERACAO_LTDA
    processo_ltda.alteracoes = [Alteracao(tipo=TipoAlteracao.CESSAO_QUOTAS, descricao="x")]
    processo_ltda.empresa.cnpj = "11222333000181"
    processo_ltda.empresa.nire = "35212345678"
    processo_ltda.numero_alteracao = 1
    processo_ltda.etapa = Etapa.ANALISE_SOCIETARIA
    ok, motivos = workflow.avancar(processo_ltda, "teste", config)
    assert ok, motivos
    assert processo_ltda.etapa == Etapa.ELABORACAO_CONTRATO
