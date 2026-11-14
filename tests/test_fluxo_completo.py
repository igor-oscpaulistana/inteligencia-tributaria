"""Fluxo ponta a ponta com portais simulados e IA substituída por dublês (sem rede)."""

import json

import pytest
from anthropic.lib.tools import ToolError

from legalizacao import ia
from legalizacao.agent.tools import Contexto, criar_ferramentas
from legalizacao.cli import main as cli
from legalizacao.integrations.portais import obter_portais
from legalizacao.models import Etapa
from legalizacao.store import ProcessoStore


@pytest.fixture
def ambiente(processo_ltda, config, tmp_path, monkeypatch):
    monkeypatch.setenv("LEGALIZACAO_DADOS", str(config.dados_dir))
    store = ProcessoStore(config)
    # documentos de cada sócio
    for nome in ("rg_ana.pdf", "comprov_ana.pdf", "cnh_bruno.pdf", "comprov_bruno.pdf", "certidao_bruno.pdf", "iptu.pdf"):
        arq = tmp_path / nome
        arq.write_bytes(b"%PDF-1.4 teste")
        store.receber_documento(processo_ltda, arq)
    store.salvar(processo_ltda)

    extraidos = {
        "rg_ana.pdf": dict(tipo_documento="rg", legivel=True, cpf="52998224725"),
        "comprov_ana.pdf": dict(tipo_documento="comprovante_endereco", legivel=True, cpf="52998224725", data_emissao="2026-11-01"),
        "cnh_bruno.pdf": dict(tipo_documento="cnh", legivel=True, cpf="11144477735"),
        "comprov_bruno.pdf": dict(tipo_documento="comprovante_endereco", legivel=True, cpf="11144477735", data_emissao="2026-10-20"),
        "certidao_bruno.pdf": dict(tipo_documento="certidao_casamento", legivel=True, cpf="11144477735", regime_bens="comunhão parcial"),
        "iptu.pdf": dict(tipo_documento="iptu", legivel=True, inscricao_imobiliaria="009.012.0034-5"),
    }
    monkeypatch.setattr(ia, "extrair_documento", lambda c, cfg, caminho: ia.DadosDocumento(**extraidos[caminho.name]))
    monkeypatch.setattr(
        ia, "revisar_contrato",
        lambda *a, **k: ia.RevisaoContrato(pronto_para_revisao_humana=True, achados=[], resumo="Sem achados."),
    )
    ctx = Contexto(processo_ltda, store, config, client=None, portais=obter_portais(config))
    return ctx, {t.name: t for t in criar_ferramentas(ctx)}


def chamar(tools, nome, **kw):
    return json.loads(tools[nome].call(kw))


def test_schemas_das_ferramentas_serializam(ambiente):
    _, tools = ambiente
    for t in tools.values():
        d = t.to_dict()
        json.dumps(d)
        assert d["description"], t.name


def test_fluxo_ate_deferimento(ambiente, tmp_path):
    ctx, tools = ambiente
    pid = ctx.processo.id

    for doc in list(ctx.processo.documentos):
        chamar(tools, "extrair_documento", documento_id=doc.id)
    assert chamar(tools, "avancar_etapa")["etapa_atual"] == "coleta_dados"
    assert chamar(tools, "verificar_documentos")["completo"]
    chamar(tools, "avancar_etapa")
    assert chamar(tools, "analisar_regras_societarias")["tem_erros"] is False
    chamar(tools, "avancar_etapa")
    assert chamar(tools, "consultar_viabilidade")["status"] == "deferida"
    chamar(tools, "avancar_etapa")
    gerado = chamar(tools, "gerar_contrato")
    assert "ALFA TECNOLOGIA LTDA" in gerado["texto"]
    chamar(tools, "revisar_contrato")
    assert chamar(tools, "avancar_etapa")["etapa_atual"] == "revisao_humana"

    # O agente não consegue passar da revisão humana nem protocolar sozinho.
    assert chamar(tools, "avancar_etapa")["avancou"] is False
    with pytest.raises(ToolError):
        tools["protocolar_na_junta"].call({})
    chamar(tools, "solicitar_aprovacao_humana", gate="revisao_contrato", resumo="Revisar minuta")

    # Humano aprova pela CLI.
    cli(["aprovar", pid, "revisao_contrato", "--por", "Analista"])
    ctx.processo = ctx.store.carregar(pid)
    assert ctx.processo.etapa == Etapa.DBE
    chamar(tools, "gerar_dbe")
    chamar(tools, "avancar_etapa")

    assinado = tmp_path / "assinado.pdf"
    assinado.write_bytes(b"%PDF assinado")
    cli(["aprovar", pid, "assinaturas", "--por", "Analista", "--arquivo", str(assinado)])
    cli(["aprovar", pid, "pagamento", "--por", "Analista", "--arquivo", str(assinado)])
    ctx.processo = ctx.store.carregar(pid)
    assert ctx.processo.etapa == Etapa.PROTOCOLO
    with pytest.raises(ToolError, match="envio_protocolo"):
        tools["protocolar_na_junta"].call({})

    cli(["aprovar", pid, "envio_protocolo", "--por", "Coordenador"])
    ctx.processo = ctx.store.carregar(pid)
    prot = chamar(tools, "protocolar_na_junta")
    assert prot["simulado"] is True and prot["numero"].startswith("JUCESP-SIM")
    assert chamar(tools, "avancar_etapa")["etapa_atual"] == "acompanhamento"

    cli(["andamento", pid, "--status", "deferido", "--nire", "35299999999", "--por", "Analista"])
    final = ctx.store.carregar(pid)
    assert final.etapa == Etapa.CONCLUIDO and final.empresa.nire == "35299999999"
