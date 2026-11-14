"""Regras societárias determinísticas (Código Civil, Lei 8.934/1994, IN DREI 81/2020, LC 123/2006).

O modelo de linguagem NUNCA decide sozinho se um ato é válido: ele chama estas regras e
explica o resultado. Cada achado traz o fundamento legal para revisão humana.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from enum import Enum

from legalizacao.config import Config, carregar_config
from legalizacao.models import EstadoCivil, Processo, RegimeBens, TipoAto
from legalizacao.rules.validadores import (
    so_digitos,
    validar_cep,
    validar_cnpj,
    validar_codigo_cnae,
    validar_cpf,
)


class Severidade(str, Enum):
    ERRO = "erro"  # impede o avanço
    ALERTA = "alerta"  # exige atenção/decisão do analista


@dataclass
class Achado:
    severidade: Severidade
    regra: str
    mensagem: str
    fundamento: str | None = None

    def to_dict(self) -> dict:
        d = self.__dict__.copy()
        d["severidade"] = self.severidade.value
        return d


# Prefixos de CNAE que costumam esbarrar em vedações ao Simples Nacional (LC 123/2006, art. 17).
# Lista ilustrativa: a confirmação é sempre do analista/contador.
CNAE_ALERTA_SIMPLES = {
    "64": "atividades financeiras / factoring",
    "65": "seguros e previdência complementar",
    "66": "atividades auxiliares de serviços financeiros",
    "1210": "fabricação de produtos do fumo",
    "1220": "fabricação de produtos do fumo",
    "6810-2/02": "locação de imóveis próprios",
    "7820": "locação de mão de obra temporária",
    "7830": "fornecimento e gestão de recursos humanos para terceiros",
}

# Limites de receita bruta anual (LC 123/2006, art. 3º) - usados apenas para alerta.
LIMITE_ME = Decimal("360000")
LIMITE_EPP = Decimal("4800000")


def _idade(nascimento: date, hoje: date) -> int:
    return hoje.year - nascimento.year - ((hoje.month, hoje.day) < (nascimento.month, nascimento.day))


def analisar(processo: Processo, config: Config | None = None, hoje: date | None = None) -> list[Achado]:
    config = config or carregar_config()
    hoje = hoje or date.today()
    achados: list[Achado] = []
    emp = processo.empresa
    socios = processo.socios_ativos()

    def erro(regra, msg, fund=None):
        achados.append(Achado(Severidade.ERRO, regra, msg, fund))

    def alerta(regra, msg, fund=None):
        achados.append(Achado(Severidade.ALERTA, regra, msg, fund))

    # --- Quadro societário ---
    if processo.tipo_ato == TipoAto.CONSTITUICAO_SLU and len(socios) != 1:
        erro("slu_socio_unico", f"SLU deve ter exatamente 1 sócio (há {len(socios)}).", "CC art. 1.052, §§1º e 2º")
    if processo.tipo_ato in (TipoAto.CONSTITUICAO_LTDA, TipoAto.ALTERACAO_LTDA) and len(socios) == 0:
        erro("sem_socios", "Nenhum sócio informado.", "CC art. 997, I")
    if processo.tipo_ato == TipoAto.CONSTITUICAO_LTDA and len(socios) == 1:
        alerta(
            "ltda_um_socio",
            "Constituição de LTDA com um único sócio: avalie usar o tipo de ato SLU (ato de constituição unipessoal).",
            "CC art. 1.052, §1º",
        )

    cpfs = [so_digitos(s.cpf) for s in socios]
    if len(set(cpfs)) != len(cpfs):
        erro("cpf_duplicado", "Há sócios com CPF repetido.")

    for s in socios:
        if not validar_cpf(s.cpf):
            erro("cpf_invalido", f"CPF inválido para o sócio {s.nome}: {s.cpf}")
        faltando = [
            campo
            for campo, valor in (
                ("nacionalidade", s.nacionalidade),
                ("estado civil", s.estado_civil),
                ("profissão", s.profissao),
                ("documento de identidade", s.rg),
                ("endereço residencial", s.endereco),
                ("data de nascimento", s.data_nascimento),
            )
            if not valor
        ]
        if faltando:
            erro(
                "qualificacao_incompleta",
                f"Qualificação incompleta de {s.nome}: falta {', '.join(faltando)}.",
                "CC art. 997, I; IN DREI 81/2020 (qualificação de sócios)",
            )
        if s.estado_civil in (EstadoCivil.CASADO,) and not s.regime_bens:
            erro(
                "regime_bens_ausente",
                f"{s.nome} é casado(a), mas o regime de bens não foi informado.",
                "IN DREI 81/2020 (qualificação de sócios)",
            )
        if s.endereco and not validar_cep(s.endereco.cep):
            erro("cep_invalido", f"CEP inválido no endereço de {s.nome}.")
        if s.data_nascimento:
            idade = _idade(s.data_nascimento, hoje)
            if idade < 18:
                if s.administrador:
                    erro(
                        "menor_administrador",
                        f"{s.nome} é menor de idade e não pode ser administrador(a).",
                        "CC art. 974, §3º, I",
                    )
                if not emp.capital_integralizado_no_ato:
                    erro(
                        "menor_capital_nao_integralizado",
                        f"Com sócio menor ({s.nome}), o capital deve estar totalmente integralizado.",
                        "CC art. 974, §3º, II",
                    )
                alerta(
                    "menor_representacao",
                    f"{s.nome} tem {idade} anos: deve ser assistido(a) (16-17) ou representado(a) (<16) e "
                    "a emancipação, se houver, deve ser comprovada.",
                    "CC art. 974, §3º, III; art. 5º, parágrafo único",
                )

    # Sociedade entre cônjuges (CC art. 977)
    por_cpf = {so_digitos(s.cpf): s for s in socios}
    for s in socios:
        conj = por_cpf.get(so_digitos(s.cpf_conjuge)) if s.cpf_conjuge else None
        if conj and so_digitos(s.cpf) < so_digitos(conj.cpf):
            regime = s.regime_bens or conj.regime_bens
            if regime in (RegimeBens.COMUNHAO_UNIVERSAL, RegimeBens.SEPARACAO_OBRIGATORIA):
                erro(
                    "conjuges_regime_vedado",
                    f"{s.nome} e {conj.nome} são cônjuges casados no regime de {regime.value.replace('_', ' ')}: "
                    "não podem ser sócios entre si.",
                    "CC art. 977",
                )
            elif regime is None:
                alerta("conjuges_regime_desconhecido", f"{s.nome} e {conj.nome} são cônjuges: confirme o regime de bens.", "CC art. 977")

    # Administração
    admins = [s for s in socios if s.administrador]
    if socios and not admins:
        erro("sem_administrador", "Nenhum administrador designado.", "CC art. 1.060")
    if admins:
        alerta(
            "declaracao_desimpedimento",
            "Confirmar com cada administrador a declaração de desimpedimento (será inserida no contrato).",
            "CC art. 1.011, §1º",
        )

    # --- Empresa ---
    if emp.usar_cnpj_como_nome:
        pass
    elif not emp.nome_empresarial:
        erro("nome_ausente", "Nome empresarial não definido (ou opte por usar o número do CNPJ como nome).", "Lei 8.934/1994, art. 35-A")
    else:
        nome = emp.nome_empresarial.strip().upper()
        if not re.search(r"\b(LTDA\.?|LIMITADA)$", nome):
            erro("nome_sem_limitada", f"Nome empresarial '{emp.nome_empresarial}' deve terminar com 'LTDA' ou 'Limitada'.", "CC art. 1.158")
        if re.search(r"\b(S\.?A\.?|S/A|EIRELI|MEI)\b", nome):
            erro("nome_tipo_incompativel", "Nome empresarial contém expressão de outro tipo jurídico.", "IN DREI 81/2020 (nome empresarial)")

    if not emp.objeto_social or len(emp.objeto_social.strip()) < 10:
        erro("objeto_ausente", "Objeto social não definido de forma precisa.", "CC art. 997, II; IN DREI 81/2020")

    if not emp.cnaes:
        erro("cnae_ausente", "Nenhuma atividade (CNAE) informada.")
    else:
        principais = [c for c in emp.cnaes if c.principal]
        if len(principais) != 1:
            erro("cnae_principal", f"Deve haver exatamente 1 CNAE principal (há {len(principais)}).")
        for c in emp.cnaes:
            if not validar_codigo_cnae(c.codigo):
                erro("cnae_formato", f"Código CNAE em formato inválido: {c.codigo} (esperado 0000-0/00).")
            for prefixo, motivo in CNAE_ALERTA_SIMPLES.items():
                if c.codigo.replace(".", "").startswith(prefixo):
                    alerta(
                        "cnae_simples",
                        f"CNAE {c.codigo} ({motivo}) pode ser vedado ao Simples Nacional - confirmar com o contador.",
                        "LC 123/2006, art. 17",
                    )

    # Capital social
    if emp.capital_social is None or emp.capital_social <= 0:
        erro("capital_ausente", "Capital social não informado.", "CC art. 997, III")
    elif emp.valor_quota is None or emp.valor_quota <= 0:
        erro("valor_quota_ausente", "Valor nominal da quota não informado.", "CC art. 1.055")
    else:
        total_quotas = sum(s.quotas for s in socios)
        if emp.capital_social % emp.valor_quota != 0:
            erro("capital_nao_divisivel", "Capital social não é múltiplo do valor da quota.", "CC art. 1.055")
        esperado = int(emp.capital_social / emp.valor_quota)
        if total_quotas != esperado:
            erro(
                "quotas_divergentes",
                f"Soma das quotas dos sócios ({total_quotas}) difere do total do capital ({esperado} quotas).",
                "CC art. 1.055",
            )
        for s in socios:
            if s.quotas <= 0:
                erro("socio_sem_quotas", f"Sócio {s.nome} sem quotas.", "CC art. 1.055")
    if not emp.capital_integralizado_no_ato and not emp.prazo_integralizacao:
        erro("prazo_integralizacao", "Capital a integralizar sem prazo/forma de integralização definidos.", "CC art. 997, IV")

    # Sede
    if not emp.endereco_sede:
        erro("sede_ausente", "Endereço da sede não informado.", "CC art. 997, II")
    else:
        if emp.endereco_sede.uf.upper() != config.uf_junta:
            erro(
                "sede_fora_da_uf",
                f"Sede em {emp.endereco_sede.uf}: este agente atende a Junta de {config.uf_junta}.",
            )
        if not validar_cep(emp.endereco_sede.cep):
            erro("cep_sede_invalido", "CEP da sede inválido.")
        if processo.tipo_ato != TipoAto.ALTERACAO_LTDA and not emp.inscricao_imobiliaria:
            alerta("sem_iptu", "Sem inscrição imobiliária (SQL/IPTU) da sede: necessária para a viabilidade municipal.")

    # Alteração contratual
    if processo.tipo_ato == TipoAto.ALTERACAO_LTDA:
        if not emp.cnpj or not validar_cnpj(emp.cnpj):
            erro("cnpj_invalido", "CNPJ da sociedade ausente ou inválido.")
        if not emp.nire:
            erro("nire_ausente", "NIRE da sociedade não informado.")
        if not processo.alteracoes:
            erro("sem_alteracoes", "Nenhuma alteração descrita.")
        if not processo.numero_alteracao:
            alerta("numero_alteracao", "Número sequencial da alteração contratual não informado.")

    return achados


def tem_erros(achados: list[Achado]) -> bool:
    return any(a.severidade == Severidade.ERRO for a in achados)
