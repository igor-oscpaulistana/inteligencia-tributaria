from datetime import date
from decimal import Decimal

import pytest

from legalizacao.config import Config
from legalizacao.models import (
    Cnae,
    Empresa,
    Endereco,
    EstadoCivil,
    Porte,
    Processo,
    RegimeBens,
    Socio,
    TipoAto,
)

SEDE = Endereco(
    logradouro="Avenida Paulista", numero="1000", complemento="conj. 101", bairro="Bela Vista",
    municipio="São Paulo", uf="SP", cep="01310-100",
)
RESID = Endereco(
    logradouro="Rua Augusta", numero="500", bairro="Consolação", municipio="São Paulo", uf="SP", cep="01305-000",
)


def socio(nome, cpf, quotas, admin=True, **kw):
    base = dict(
        nome=nome, cpf=cpf, rg="12.345.678-9", orgao_emissor="SSP/SP", data_nascimento=date(1985, 3, 10),
        estado_civil=EstadoCivil.SOLTEIRO, profissao="empresário(a)", endereco=RESID, quotas=quotas,
        administrador=admin,
    )
    base.update(kw)
    return Socio(**base)


@pytest.fixture
def config(tmp_path):
    return Config(dados_dir=tmp_path / "dados")


@pytest.fixture
def processo_ltda():
    return Processo(
        tipo_ato=TipoAto.CONSTITUICAO_LTDA,
        cliente_nome="Cliente Teste",
        empresa=Empresa(
            nome_empresarial="Alfa Tecnologia Ltda",
            nome_fantasia="Alfa Tech",
            objeto_social="Desenvolvimento e licenciamento de programas de computador customizáveis",
            cnaes=[Cnae(codigo="6202-3/00", descricao="Desenvolvimento e licenciamento de programas de computador customizáveis", principal=True)],
            capital_social=Decimal("50000"),
            valor_quota=Decimal("1"),
            endereco_sede=SEDE,
            inscricao_imobiliaria="009.012.0034-5",
            porte=Porte.ME,
        ),
        socios=[
            socio("Ana Souza", "529.982.247-25", 30000),
            socio("Bruno Lima", "111.444.777-35", 20000, admin=False,
                  estado_civil=EstadoCivil.CASADO, regime_bens=RegimeBens.COMUNHAO_PARCIAL),
        ],
    )
