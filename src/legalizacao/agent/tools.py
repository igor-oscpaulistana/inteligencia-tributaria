"""Ferramentas que o agente pode usar. Cada uma devolve JSON e salva o processo.

O que o agente NÃO tem: aprovar gates, marcar assinaturas/pagamentos como feitos ou
registrar deferimento. Essas ações ficam só na interface humana (CLI).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from pathlib import Path

import anthropic
from anthropic import beta_tool
from anthropic.lib.tools import ToolError
from pydantic import BaseModel, Field

from legalizacao import ia, workflow
from legalizacao.config import Config
from legalizacao.contrato import gerador
from legalizacao.integrations.portais import Portais, viabilidade_necessaria
from legalizacao.models import (
    Alteracao,
    Cnae,
    Endereco,
    Etapa,
    Gate,
    Pendencia,
    Porte,
    Processo,
    Responsavel,
    Socio,
    SolicitacaoAprovacao,
    StatusDocumento,
    TipoDocumento,
)
from legalizacao.rules import documentos, societario
from legalizacao.rules.validadores import so_digitos
from legalizacao.store import ProcessoStore


@dataclass
class Contexto:
    processo: Processo
    store: ProcessoStore
    config: Config
    client: anthropic.Anthropic
    portais: Portais
    eventos: list[str] = field(default_factory=list)

    def salvar(self, acao: str, detalhe: str | None = None) -> None:
        self.processo.registrar("agente", acao, detalhe)
        self.store.salvar(self.processo)
        self.eventos.append(f"{acao}: {detalhe or ''}")


def _json(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=1, default=str)


class EmpresaParcial(BaseModel):
    """Campos da empresa a atualizar (omitidos permanecem como estão)."""

    nome_empresarial: str | None = None
    nome_fantasia: str | None = None
    usar_cnpj_como_nome: bool | None = None
    objeto_social: str | None = Field(None, description="Redação do objeto social, precisa e compatível com os CNAEs")
    cnaes: list[Cnae] | None = Field(None, description="Lista completa de CNAEs (substitui a atual); exatamente 1 principal")
    capital_social: Decimal | None = None
    valor_quota: Decimal | None = None
    capital_integralizado_no_ato: bool | None = None
    prazo_integralizacao: date | None = None
    endereco_sede: Endereco | None = None
    inscricao_imobiliaria: str | None = None
    area_utilizada_m2: Decimal | None = None
    porte: Porte | None = None
    administracao_conjunta: bool | None = None
    pro_labore: bool | None = None
    data_inicio_atividades: date | None = None
    cnpj: str | None = None
    nire: str | None = None


def criar_ferramentas(ctx: Contexto) -> list:
    p = lambda: ctx.processo  # noqa: E731 - leitura sempre do estado atual

    @beta_tool
    def ver_processo() -> str:
        """Mostra o estado completo do processo: etapa, bloqueios para avançar, sócios, empresa, documentos,
        pendências, aprovações e resultados de portais. Chame no início de cada sessão e sempre que precisar
        reavaliar o que falta."""
        proc = p()
        resumo = proc.model_dump(exclude={"historico"}, mode="json")
        resumo["bloqueios_para_avancar"] = workflow.bloqueios(proc, ctx.config)
        resumo["informacoes_do_cliente_e_analista"] = [
            e.model_dump(mode="json") for e in proc.historico if e.acao in ("briefing", "informacao", "andamento_junta")
        ]
        resumo["historico_recente"] = [e.model_dump(mode="json") for e in proc.historico[-10:]]
        return _json(resumo)

    @beta_tool
    def extrair_documento(documento_id: str) -> str:
        """Lê um documento recebido (PDF ou imagem) com IA, classifica o tipo e extrai os dados.
        Use para todo documento com tipo 'nao_identificado'. Depois confira os dados extraídos com o que o
        cliente informou e registre pendências em caso de divergência ou ilegibilidade.

        Args:
            documento_id: id do documento (ex.: doc-1a2b3c4d), visto em ver_processo.
        """
        doc = next((d for d in p().documentos if d.id == documento_id), None)
        if not doc:
            raise ToolError(f"Documento {documento_id} não encontrado.")
        dados = ia.extrair_documento(ctx.client, ctx.config, Path(doc.caminho))
        doc.dados_extraidos = dados.model_dump(mode="json", exclude_none=True)
        doc.tipo = TipoDocumento(dados.tipo_documento)
        doc.status = StatusDocumento.EXTRAIDO if dados.legivel else StatusDocumento.REJEITADO
        if dados.cpf:
            doc.cpf_titular = so_digitos(dados.cpf)
        if not dados.legivel:
            doc.observacoes = "Ilegível: solicitar novo envio ao cliente."
        ctx.salvar("documento_extraido", f"{doc.nome_arquivo} -> {doc.tipo.value}")
        return _json({"documento": doc.model_dump(mode="json")})

    @beta_tool
    def atualizar_documento(
        documento_id: str,
        tipo: TipoDocumento | None = None,
        cpf_titular: str | None = None,
        status: StatusDocumento | None = None,
        observacoes: str | None = None,
    ) -> str:
        """Corrige a classificação de um documento: tipo, a qual sócio pertence (CPF do titular - necessário
        quando o documento não traz CPF, como comprovante de endereço), status (valido/rejeitado) e observações.

        Args:
            documento_id: id do documento.
            tipo: tipo correto do documento.
            cpf_titular: CPF do sócio a quem o documento se refere.
            status: 'valido' após conferência, 'rejeitado' se inservível.
            observacoes: anotações da conferência.
        """
        doc = next((d for d in p().documentos if d.id == documento_id), None)
        if not doc:
            raise ToolError(f"Documento {documento_id} não encontrado.")
        if tipo:
            doc.tipo = tipo
        if cpf_titular:
            doc.cpf_titular = so_digitos(cpf_titular)
        if status:
            doc.status = status
        if observacoes:
            doc.observacoes = observacoes
        ctx.salvar("documento_atualizado", doc.nome_arquivo)
        return _json(doc.model_dump(mode="json"))

    @beta_tool
    def salvar_socio(socio: Socio) -> str:
        """Cria ou atualiza (pelo CPF) a qualificação completa de um sócio. Use somente dados que vieram dos
        documentos ou do cliente; nunca invente. Em alteração contratual, marque retirante=True para quem sai
        (continua assinando) e ingressante=True para quem entra.

        Args:
            socio: dados completos do sócio.
        """
        existente = p().socio_por_cpf(socio.cpf)
        if existente:
            p().socios[p().socios.index(existente)] = socio
        else:
            p().socios.append(socio)
        ctx.salvar("socio_salvo", socio.nome)
        return _json({"ok": True, "socios": [s.nome for s in p().socios]})

    @beta_tool
    def remover_socio(cpf: str) -> str:
        """Remove um sócio cadastrado por engano (não use para retirada de sócio em alteração: use retirante=True).

        Args:
            cpf: CPF do sócio.
        """
        s = p().socio_por_cpf(cpf)
        if not s:
            raise ToolError("Sócio não encontrado.")
        p().socios.remove(s)
        ctx.salvar("socio_removido", s.nome)
        return _json({"ok": True})

    @beta_tool
    def salvar_empresa(dados: EmpresaParcial) -> str:
        """Atualiza os dados da sociedade (nome, objeto, CNAEs, capital, sede, porte, administração...).
        Envie só os campos que mudam.

        Args:
            dados: campos a atualizar.
        """
        atual = p().empresa.model_dump()
        atual.update(dados.model_dump(exclude_none=True))
        p().empresa = type(p().empresa).model_validate(atual)
        ctx.salvar("empresa_atualizada", ", ".join(dados.model_dump(exclude_none=True).keys()))
        return _json(p().empresa.model_dump(mode="json"))

    @beta_tool
    def registrar_alteracoes(numero_alteracao: int, alteracoes: list[Alteracao]) -> str:
        """Somente para alteração contratual: define o número sequencial da alteração e o texto de cada
        cláusula de alteração (substitui a lista atual). Os dados de empresa e sócios devem refletir a
        situação APÓS a alteração, pois alimentam a consolidação.

        Args:
            numero_alteracao: número da alteração (ex.: 3 para a 3ª alteração).
            alteracoes: cláusulas de alteração, em ordem.
        """
        p().numero_alteracao = numero_alteracao
        p().alteracoes = alteracoes
        ctx.salvar("alteracoes_registradas", f"{len(alteracoes)} cláusula(s)")
        return _json({"ok": True, "viabilidade_necessaria": viabilidade_necessaria(p())})

    @beta_tool
    def verificar_documentos() -> str:
        """Confere o checklist de documentos por sócio e do imóvel/sociedade. Itens com politica_interna=True
        são exigência do escritório (não bloqueiam), os demais bloqueiam o avanço."""
        itens = documentos.checklist(p(), ctx.config)
        return _json({"completo": documentos.checklist_completo(p(), ctx.config), "itens": [i.to_dict() for i in itens]})

    @beta_tool
    def analisar_regras_societarias() -> str:
        """Roda as regras societárias determinísticas (Código Civil, IN DREI 81/2020, LC 123/2006) e devolve
        erros (bloqueiam) e alertas (exigem decisão do analista), com fundamento legal."""
        achados = societario.analisar(p(), ctx.config)
        return _json({"tem_erros": societario.tem_erros(achados), "achados": [a.to_dict() for a in achados]})

    @beta_tool
    def registrar_pendencia(descricao: str, responsavel: Responsavel) -> str:
        """Registra algo que falta para o processo andar (documento ilegível, dado divergente, decisão do
        cliente, etc.).

        Args:
            descricao: o que falta, de forma acionável.
            responsavel: quem deve resolver (cliente, analista ou agente).
        """
        pend = Pendencia(descricao=descricao, responsavel=responsavel, etapa=p().etapa)
        p().pendencias.append(pend)
        ctx.salvar("pendencia_registrada", descricao)
        return _json(pend.model_dump(mode="json"))

    @beta_tool
    def resolver_pendencia(pendencia_id: str, como: str) -> str:
        """Marca uma pendência como resolvida.

        Args:
            pendencia_id: id da pendência.
            como: como foi resolvida.
        """
        pend = next((x for x in p().pendencias if x.id == pendencia_id), None)
        if not pend:
            raise ToolError("Pendência não encontrada.")
        pend.resolvida = True
        ctx.salvar("pendencia_resolvida", f"{pend.descricao} -> {como}")
        return _json({"ok": True})

    @beta_tool
    def consultar_viabilidade() -> str:
        """Faz a consulta prévia de viabilidade (nome empresarial + localização) no portal da REDESIM-SP.
        Só na etapa 'viabilidade'."""
        if p().etapa != Etapa.VIABILIDADE:
            raise ToolError(f"Viabilidade só na etapa 'viabilidade' (atual: {p().etapa.value}).")
        try:
            res = ctx.portais.viabilidade.consultar(p())
        except NotImplementedError as e:
            raise ToolError(f"Portal não automatizado - tarefa manual para o analista:\n{e}")
        p().viabilidade = res
        ctx.salvar("viabilidade_consultada", f"{res.numero} {res.status}")
        return _json(res.model_dump(mode="json"))

    @beta_tool
    def gerar_contrato() -> str:
        """Gera a minuta do contrato social (Markdown e DOCX) a partir dos modelos aprovados pelo jurídico e dos
        dados do processo. Só funciona sem ERROS nas regras societárias. Gerar de novo invalida aprovação
        humana anterior da minuta."""
        if p().etapa != Etapa.ELABORACAO_CONTRATO:
            raise ToolError(f"Geração só na etapa 'elaboracao_contrato' (atual: {p().etapa.value}).")
        achados = societario.analisar(p(), ctx.config)
        if societario.tem_erros(achados):
            raise ToolError("Há erros nas regras societárias: " + _json([a.to_dict() for a in achados if a.severidade.value == "erro"]))
        gerado = gerador.gerar(p(), ctx.store.pasta_saida(p().id))
        p().contrato_md, p().contrato_docx = str(gerado.caminho_md), str(gerado.caminho_docx)
        p().revisao_ia = None
        ctx.salvar("contrato_gerado", gerado.caminho_md.name)
        return _json({"markdown": str(gerado.caminho_md), "docx": str(gerado.caminho_docx), "texto": gerado.markdown})

    @beta_tool
    def revisar_contrato() -> str:
        """Pede a um revisor (IA independente) que confira a minuta gerada contra os dados e a legislação.
        O resultado fica registrado para o revisor humano."""
        if not p().contrato_md:
            raise ToolError("Gere o contrato antes.")
        minuta = Path(p().contrato_md).read_text(encoding="utf-8")
        dados = p().model_dump(mode="json", include={"tipo_ato", "empresa", "socios", "alteracoes", "numero_alteracao"})
        achados = [a.to_dict() for a in societario.analisar(p(), ctx.config)]
        rev = ia.revisar_contrato(ctx.client, ctx.config, minuta, dados, achados)
        p().revisao_ia = rev.model_dump(mode="json")
        ctx.salvar("contrato_revisado_ia", rev.resumo[:200])
        return _json(p().revisao_ia)

    @beta_tool
    def solicitar_aprovacao_humana(gate: Gate, resumo: str) -> str:
        """Pede a um humano a aprovação de um ponto de controle. O agente NÃO consegue aprovar: o pedido fica
        registrado e o humano aprova pela CLI. Gates: revisao_contrato (minuta revisada), assinaturas (todos
        assinaram digitalmente), pagamento (DARE pago), envio_protocolo (autoriza protocolar).

        Args:
            gate: ponto de controle.
            resumo: o que o humano precisa conferir/fazer, com caminhos de arquivos e riscos identificados.
        """
        p().solicitacoes_aprovacao = [s for s in p().solicitacoes_aprovacao if s.gate != gate]
        p().solicitacoes_aprovacao.append(SolicitacaoAprovacao(gate=gate, resumo=resumo))
        ctx.salvar("aprovacao_solicitada", gate.value)
        return _json({"ok": True, "instrucao_para_humano": f"legalizacao aprovar {p().id} {gate.value} --por \"<nome>\""})

    @beta_tool
    def gerar_dbe() -> str:
        """Gera/transmite o DBE (Coleta Nacional da Receita Federal) com os dados do processo. Só na etapa 'dbe'."""
        if p().etapa != Etapa.DBE:
            raise ToolError(f"DBE só na etapa 'dbe' (atual: {p().etapa.value}).")
        try:
            res = ctx.portais.dbe.gerar(p())
        except NotImplementedError as e:
            raise ToolError(f"Portal não automatizado - tarefa manual para o analista:\n{e}")
        p().dbe = res
        ctx.salvar("dbe_gerado", res.numero)
        return _json(res.model_dump(mode="json"))

    @beta_tool
    def protocolar_na_junta() -> str:
        """Protocola o ato na JUCESP. Exige TODAS as aprovações humanas (revisao_contrato, assinaturas,
        pagamento, envio_protocolo), etapa 'protocolo' e minuta inalterada desde a aprovação. Se faltar algo,
        a ferramenta recusa e diz o quê."""
        motivos = workflow.pode_protocolar(p())
        if motivos:
            raise ToolError("Protocolo bloqueado:\n- " + "\n- ".join(motivos))
        arquivos = [Path(x) for x in (p().contrato_assinado, p().comprovante_pagamento) if x]
        try:
            res = ctx.portais.junta.protocolar(p(), arquivos)
        except NotImplementedError as e:
            raise ToolError(f"Portal não automatizado - tarefa manual para o analista:\n{e}")
        p().protocolo = res
        ctx.salvar("protocolado", res.numero)
        return _json(res.model_dump(mode="json"))

    @beta_tool
    def consultar_andamento() -> str:
        """Consulta o andamento do protocolo na Junta e lista exigências em aberto."""
        if not p().protocolo:
            raise ToolError("Ainda não protocolado.")
        try:
            res = ctx.portais.junta.consultar(p())
        except NotImplementedError as e:
            raise ToolError(str(e))
        p().protocolo = res
        ctx.salvar("andamento_consultado", res.status)
        return _json({"protocolo": res.model_dump(mode="json"), "exigencias": [x.model_dump(mode="json") for x in p().exigencias]})

    @beta_tool
    def avancar_etapa() -> str:
        """Tenta avançar para a próxima etapa. Se houver bloqueios, nada muda e eles são devolvidos."""
        ok, motivos = workflow.avancar(p(), "agente", ctx.config)
        ctx.store.salvar(p())
        return _json({"avancou": ok, "etapa_atual": p().etapa.value, "bloqueios": motivos})

    @beta_tool
    def retornar_etapa(etapa: Etapa, motivo: str) -> str:
        """Volta a uma etapa anterior (ex.: exigência da Junta que exige corrigir o contrato). Aprovações
        humanas das etapas seguintes são invalidadas.

        Args:
            etapa: etapa de destino (anterior à atual).
            motivo: justificativa registrada no histórico.
        """
        try:
            invalidadas = workflow.retornar(p(), etapa, "agente", motivo)
        except ValueError as e:
            raise ToolError(str(e))
        ctx.store.salvar(p())
        return _json({"etapa_atual": p().etapa.value, "aprovacoes_invalidadas": [g.value for g in invalidadas]})

    @beta_tool
    def redigir_mensagem_cliente(assunto: str, corpo: str) -> str:
        """Salva um rascunho de mensagem ao cliente (pedido de documentos, dúvidas, status). NÃO envia: o
        analista revisa e envia.

        Args:
            assunto: assunto da mensagem.
            corpo: texto completo, cordial e objetivo, em português.
        """
        pasta = ctx.store.pasta_saida(p().id) / "mensagens"
        pasta.mkdir(exist_ok=True)
        arq = pasta / f"{len(list(pasta.iterdir())) + 1:02d}_mensagem_cliente.md"
        arq.write_text(f"# {assunto}\n\nPara: {p().cliente_email or p().cliente_nome}\n\n{corpo}\n", encoding="utf-8")
        ctx.salvar("mensagem_redigida", arq.name)
        return _json({"rascunho": str(arq)})

    return [
        ver_processo,
        extrair_documento,
        atualizar_documento,
        salvar_socio,
        remover_socio,
        salvar_empresa,
        registrar_alteracoes,
        verificar_documentos,
        analisar_regras_societarias,
        registrar_pendencia,
        resolver_pendencia,
        consultar_viabilidade,
        gerar_contrato,
        revisar_contrato,
        solicitar_aprovacao_humana,
        gerar_dbe,
        protocolar_na_junta,
        consultar_andamento,
        avancar_etapa,
        retornar_etapa,
        redigir_mensagem_cliente,
    ]
