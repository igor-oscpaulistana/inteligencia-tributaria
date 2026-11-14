from datetime import date
from decimal import Decimal

from conftest import socio

from legalizacao.models import RegimeBens, EstadoCivil, TipoAto
from legalizacao.rules.societario import Severidade, analisar


def regras(achados, sev=Severidade.ERRO):
    return {a.regra for a in achados if a.severidade == sev}


def test_processo_valido_sem_erros(processo_ltda, config):
    assert regras(analisar(processo_ltda, config, hoje=date(2026, 11, 13))) == set()


def test_quotas_divergentes(processo_ltda, config):
    processo_ltda.socios[0].quotas = 1
    assert "quotas_divergentes" in regras(analisar(processo_ltda, config))


def test_nome_sem_ltda(processo_ltda, config):
    processo_ltda.empresa.nome_empresarial = "Alfa Tecnologia"
    assert "nome_sem_limitada" in regras(analisar(processo_ltda, config))


def test_slu_com_dois_socios(processo_ltda, config):
    processo_ltda.tipo_ato = TipoAto.CONSTITUICAO_SLU
    assert "slu_socio_unico" in regras(analisar(processo_ltda, config))


def test_conjuges_comunhao_universal(processo_ltda, config):
    a, b = processo_ltda.socios
    for x, y in ((a, b), (b, a)):
        x.estado_civil = EstadoCivil.CASADO
        x.regime_bens = RegimeBens.COMUNHAO_UNIVERSAL
        x.cpf_conjuge = y.cpf
    assert "conjuges_regime_vedado" in regras(analisar(processo_ltda, config))


def test_menor_administrador(processo_ltda, config):
    processo_ltda.socios[0].data_nascimento = date(2010, 1, 1)
    r = regras(analisar(processo_ltda, config, hoje=date(2026, 11, 13)))
    assert "menor_administrador" in r


def test_casado_sem_regime(processo_ltda, config):
    processo_ltda.socios[1].regime_bens = None
    assert "regime_bens_ausente" in regras(analisar(processo_ltda, config))


def test_sede_fora_de_sp(processo_ltda, config):
    processo_ltda.empresa.endereco_sede = processo_ltda.empresa.endereco_sede.model_copy(update={"uf": "RJ"})
    assert "sede_fora_da_uf" in regras(analisar(processo_ltda, config))


def test_alerta_simples(processo_ltda, config):
    from legalizacao.models import Cnae
    processo_ltda.empresa.cnaes.append(Cnae(codigo="6810-2/02", descricao="Aluguel de imóveis próprios"))
    assert "cnae_simples" in regras(analisar(processo_ltda, config), Severidade.ALERTA)
