"""Interface humana do agente. Aprovações, assinaturas, pagamento e deferimento só passam por aqui."""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

from legalizacao import workflow
from legalizacao.config import carregar_config
from legalizacao.models import Etapa, Exigencia, Gate, Processo, TipoAto
from legalizacao.rules import documentos, societario
from legalizacao.store import ProcessoStore


def _store() -> ProcessoStore:
    return ProcessoStore(carregar_config())


def cmd_novo(a) -> None:
    store = _store()
    proc = Processo(tipo_ato=TipoAto(a.tipo), cliente_nome=a.cliente, cliente_email=a.email)
    proc.registrar("humano", "processo_aberto", a.tipo)
    for arq in a.arquivos or []:
        store.receber_documento(proc, Path(arq))
    if a.briefing:
        texto = Path(a.briefing).read_text(encoding="utf-8")
        proc.registrar("cliente", "briefing", texto)
    store.salvar(proc)
    print(proc.id)


def cmd_docs(a) -> None:
    store = _store()
    proc = store.carregar(a.processo)
    for arq in a.arquivos:
        doc = store.receber_documento(proc, Path(arq))
        print(f"{doc.id}  {doc.nome_arquivo}")
    store.salvar(proc)


def cmd_nota(a) -> None:
    """Informação do cliente/analista que o agente deve considerar (briefing, respostas a pendências)."""
    store = _store()
    proc = store.carregar(a.processo)
    texto = Path(a.texto[1:]).read_text(encoding="utf-8") if a.texto.startswith("@") else a.texto
    proc.registrar(a.autor, "informacao", texto)
    store.salvar(proc)
    print("Registrado.")


def cmd_agente(a) -> None:
    from legalizacao.agent.runner import executar

    print(executar(a.processo, a.mensagem, max_iteracoes=a.max_iteracoes))


def cmd_status(a) -> None:
    config = carregar_config()
    proc = _store().carregar(a.processo)
    print(f"Processo {proc.id} | {proc.tipo_ato.value} | cliente: {proc.cliente_nome}")
    print(f"Etapa: {proc.etapa.value}")
    bl = workflow.bloqueios(proc, config)
    if bl:
        print("Bloqueios:")
        for b in bl:
            print(f"  - {b}")
    if proc.solicitacoes_aprovacao:
        print("Aprovações solicitadas pelo agente:")
        for s in proc.solicitacoes_aprovacao:
            print(f"  [{s.gate.value}] {s.resumo}")
    if proc.aprovacoes:
        print("Aprovações concedidas: " + ", ".join(f"{x.gate.value} ({x.aprovado_por})" for x in proc.aprovacoes))
    abertas = proc.pendencias_abertas()
    if abertas:
        print("Pendências:")
        for p in abertas:
            print(f"  {p.id} [{p.responsavel.value}] {p.descricao}")
    if a.detalhes:
        print("\nChecklist:")
        for i in documentos.checklist(proc, config):
            print(f"  [{'x' if i.satisfeito else ' '}] {i.item}" + (f" - {i.titular}" if i.titular else ""))
        print("\nRegras societárias:")
        for ach in societario.analisar(proc, config):
            print(f"  {ach.severidade.value.upper():6} {ach.mensagem}" + (f" ({ach.fundamento})" if ach.fundamento else ""))
    for nome in ("viabilidade", "dbe", "protocolo"):
        r = getattr(proc, nome)
        if r:
            print(f"{nome}: {r.numero} [{r.status}]{' (SIMULADO)' if r.simulado else ''}")
    if proc.contrato_md:
        print(f"Minuta: {proc.contrato_md}\n        {proc.contrato_docx}")


def cmd_listar(a) -> None:
    for p in _store().listar():
        print(f"{p.id}  {p.etapa.value:22} {p.tipo_ato.value:18} {p.cliente_nome}")


def _anexar(store: ProcessoStore, proc: Processo, arquivo: str, nome: str) -> str:
    destino = store.pasta(proc.id) / "assinados"
    destino.mkdir(parents=True, exist_ok=True)
    alvo = destino / f"{nome}{Path(arquivo).suffix}"
    shutil.copy2(arquivo, alvo)
    return str(alvo)


def cmd_aprovar(a) -> None:
    store = _store()
    proc = store.carregar(a.processo)
    gate = Gate(a.gate)
    if gate == Gate.ASSINATURAS:
        if not a.arquivo:
            sys.exit("Informe --arquivo com o PDF assinado por todos os signatários.")
        proc.contrato_assinado = _anexar(store, proc, a.arquivo, "contrato_assinado")
    if gate == Gate.PAGAMENTO:
        if not a.arquivo:
            sys.exit("Informe --arquivo com o comprovante de pagamento do DARE.")
        proc.comprovante_pagamento = _anexar(store, proc, a.arquivo, "comprovante_dare")
    try:
        workflow.aprovar(proc, gate, a.por, a.obs)
    except ValueError as e:
        sys.exit(str(e))
    ok, motivos = workflow.avancar(proc, f"humano:{a.por}")
    store.salvar(proc)
    print(f"Aprovado: {gate.value}. Etapa atual: {proc.etapa.value}")
    if not ok and motivos:
        print("Ainda bloqueado: " + "; ".join(motivos))


def cmd_andamento(a) -> None:
    """Registra o andamento informado pela Junta (deferimento, exigência)."""
    store = _store()
    proc = store.carregar(a.processo)
    if not proc.protocolo:
        sys.exit("Processo ainda não protocolado.")
    proc.protocolo.status = a.status
    if a.status == "exigencia":
        if not a.texto:
            sys.exit("Informe --texto com o teor da exigência.")
        proc.exigencias.append(Exigencia(texto=a.texto))
    if a.status == "deferido":
        for x in proc.exigencias:
            x.cumprida = True
        if a.nire:
            proc.empresa.nire = a.nire
        if a.cnpj:
            proc.empresa.cnpj = a.cnpj
    proc.registrar(f"humano:{a.por}", "andamento_junta", f"{a.status} {a.texto or ''}".strip())
    workflow.avancar(proc, f"humano:{a.por}")
    store.salvar(proc)
    print(f"Andamento registrado. Etapa: {proc.etapa.value}")


def cmd_avancar(a) -> None:
    store = _store()
    proc = store.carregar(a.processo)
    ok, motivos = workflow.avancar(proc, "humano")
    store.salvar(proc)
    print(f"Etapa: {proc.etapa.value}" if ok else "Bloqueado:\n- " + "\n- ".join(motivos))


def cmd_retornar(a) -> None:
    store = _store()
    proc = store.carregar(a.processo)
    inval = workflow.retornar(proc, Etapa(a.etapa), "humano", a.motivo)
    store.salvar(proc)
    print(f"Etapa: {proc.etapa.value}. Aprovações invalidadas: {', '.join(g.value for g in inval) or 'nenhuma'}")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="legalizacao", description="Agente analista de legalização (JUCESP)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("novo", help="Abre um processo")
    s.add_argument("--tipo", required=True, choices=[t.value for t in TipoAto])
    s.add_argument("--cliente", required=True)
    s.add_argument("--email")
    s.add_argument("--briefing", help="Arquivo .txt/.md com o pedido do cliente (atividade, sócios, capital...)")
    s.add_argument("arquivos", nargs="*", help="Documentos recebidos")
    s.set_defaults(f=cmd_novo)

    s = sub.add_parser("docs", help="Recebe documentos")
    s.add_argument("processo")
    s.add_argument("arquivos", nargs="+")
    s.set_defaults(f=cmd_docs)

    s = sub.add_parser("nota", help="Registra informação do cliente/analista (texto ou @arquivo)")
    s.add_argument("processo")
    s.add_argument("texto")
    s.add_argument("--autor", default="cliente")
    s.set_defaults(f=cmd_nota)

    s = sub.add_parser("agente", help="Roda o agente no processo")
    s.add_argument("processo")
    s.add_argument("-m", "--mensagem", help="Instrução específica para esta sessão")
    s.add_argument("--max-iteracoes", type=int, default=60)
    s.set_defaults(f=cmd_agente)

    s = sub.add_parser("status", help="Mostra o estado do processo")
    s.add_argument("processo")
    s.add_argument("-d", "--detalhes", action="store_true")
    s.set_defaults(f=cmd_status)

    s = sub.add_parser("listar", help="Lista processos")
    s.set_defaults(f=cmd_listar)

    s = sub.add_parser("aprovar", help="Aprovação humana de um gate")
    s.add_argument("processo")
    s.add_argument("gate", choices=[g.value for g in Gate])
    s.add_argument("--por", required=True, help="Nome de quem aprova")
    s.add_argument("--obs")
    s.add_argument("--arquivo", help="PDF assinado (assinaturas) ou comprovante do DARE (pagamento)")
    s.set_defaults(f=cmd_aprovar)

    s = sub.add_parser("andamento", help="Registra andamento da Junta")
    s.add_argument("processo")
    s.add_argument("--status", required=True, choices=["em_analise", "exigencia", "deferido", "indeferido"])
    s.add_argument("--texto")
    s.add_argument("--nire")
    s.add_argument("--cnpj")
    s.add_argument("--por", required=True)
    s.set_defaults(f=cmd_andamento)

    s = sub.add_parser("avancar", help="Tenta avançar a etapa")
    s.add_argument("processo")
    s.set_defaults(f=cmd_avancar)

    s = sub.add_parser("retornar", help="Volta a uma etapa anterior")
    s.add_argument("processo")
    s.add_argument("etapa", choices=[e.value for e in Etapa])
    s.add_argument("--motivo", required=True)
    s.set_defaults(f=cmd_retornar)

    args = ap.parse_args(argv)
    args.f(args)


if __name__ == "__main__":
    main()
