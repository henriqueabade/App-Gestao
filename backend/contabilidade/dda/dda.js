/**
 * Os boletos contra a empresa (fase H, 02/10/2026): o que a API DDA do BB
 * devolve (integracoes/bbDda.js) vira linha em contabil_dda_boletos — SÓ OS
 * DADOS: o BB não dá o PDF nem a 2ª via; o "Espelho DDA" (espelho.js) é
 * gerado na hora e diz que é documento interno.
 *
 *   gravarBusca ...... cada boleto da busca: novo entra; o que já existe
 *                      ganha o estado novo no histórico (a pagar → agendado →
 *                      liquidado); o que deixou de vir numa busca completa
 *                      fica marcado "sumiu do DDA" (baixado ou trocado);
 *   casar ............ boleto × conta a pagar (pura): a MESMA linha digitável
 *                      liga sozinha; o mesmo CNPJ do beneficiário + o mesmo
 *                      valor + vencimento a até 3 dias também — sempre com o
 *                      par único dos dois lados. O resto é sugestão (inclusive
 *                      a nota registrada sem conta);
 *   vincularSozinho .. grava as ligações automáticas e completa a linha
 *                      digitável da parcela que estava sem;
 *   listar/detalhe ... a tela "Boletos do DDA";
 *   ações ............ ligar a uma parcela, desligar, lançar a conta já
 *                      preenchida, ignorar, contestar, restaurar.
 *
 * Regra do dono: estar no DDA NÃO prova que a dívida é devida — boleto "a
 * pagar" sem conta nunca vira conta sozinho (aviso no painel: lançar, ligar
 * ou contestar). O liquidado entra na conciliação como obrigação (o débito
 * do banco lança a conta e a paga, como a nota sem conta da fase A).
 */
const c = require('../../financeiro/comum');
const b = require('../base');
const eventos = require('../eventos');
const titulos = require('../titulos');
const motor = require('../conciliacao/motor');
const liquidacoes = require('../conciliacao/liquidacoes');
const bbDda = require('../integracoes/bbDda');

const TABELA = 'contabil_dda_boletos';
const SITUACOES = { novo: 'Sem conta', vinculado: 'Ligado à conta', ignorado: 'Ignorado', contestado: 'Contestado' };
const VISOES = { sem_conta: 'Sem conta', ligados: 'Ligados a uma conta', decididos: 'Contestados e ignorados', todos: 'Todos' };
const CRITERIOS = {
  linha_digitavel: 'mesma linha digitável', cnpj_valor_vencimento: 'mesmo CNPJ, valor e vencimento', manual: 'ligado à mão',
  lancada: 'conta lançada do boleto', conciliacao: 'conta lançada pela conciliação com o extrato'
};
/** Até quantos dias de diferença no vencimento o CNPJ + valor ligam sozinhos. */
const DIAS_AUTOMATICO = 3;
/** Até quantos dias a sugestão olha (o boleto renegociado muda o vencimento). */
const DIAS_SUGESTAO = 60;

const alnum = v => String(v ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
const cent = v => Math.round(Math.abs(Number(v) || 0) * 100);
const ativo = p => p && !p.estornado_em;

/** A linha digitável de 47 dígitos como sai impressa. Pura. */
function linhaImpressa(d) {
  const s = b.digitos(d);
  if (s.length !== 47) return s || null;
  return `${s.slice(0, 5)}.${s.slice(5, 10)} ${s.slice(10, 15)}.${s.slice(15, 21)} ${s.slice(21, 26)}.${s.slice(26, 32)} ${s[32]} ${s.slice(33)}`;
}

/** 'cnpj' (o mesmo do beneficiário ou do beneficiário final), 'raiz' (mesma empresa, outra filial) ou null. Pura. */
function relacaoDoDocumento(documento, boleto) {
  const a = alnum(documento);
  if (!a) return null;
  const alvos = [boleto.beneficiario_documento, boleto.beneficiario_final_documento].map(alnum).filter(Boolean);
  if (alvos.includes(a)) return 'cnpj';
  if (a.length === 14 && alvos.some(x => x.length === 14 && x.slice(0, 8) === a.slice(0, 8))) return 'raiz';
  return null;
}

const docDoContato = contato => (contato ? contato.cnpj || contato.cpf || null : null);
const nomesDoBoleto = boleto => [boleto.beneficiario_nome, boleto.beneficiario_final_nome].filter(Boolean).join(' ');

/**
 * O quanto uma parcela de conta a pagar combina com o boleto. null = não
 * serve. `livre` (a escolha à mão) aceita também o mesmo valor sem ligação
 * com o beneficiário. Pura.
 */
function avaliarParcela(boleto, t, p, { contato = null, livre = false } = {}) {
  const linhaP = b.digitos(p.linha_digitavel);
  const linha = Boolean(linhaP) && (linhaP === boleto.linha_digitavel || linhaP === boleto.codigo_barras);
  const dias = Math.abs(motor.diasEntre(c.dia(p.vencimento), boleto.vencimento));
  const exato = cent(p.valor) === cent(boleto.valor);
  const motivos = [];
  if (linha) {
    return { tipo: 'parcela', titulo_id: t.id, parcela_id: p.id, pontos: 300, automatico: true, criterio: 'linha_digitavel', dias, exato, motivos: ['mesma linha digitável'] };
  }
  const rel = relacaoDoDocumento(docDoContato(contato), boleto);
  const nome = !rel && motor.nomeNaDescricao(t.fornecedor || t.descricao, nomesDoBoleto(boleto));
  if (!rel && !nome && !(livre && exato)) return null;
  if (!exato && !(rel === 'cnpj' && dias <= 5)) return null;
  if (dias > (livre ? 120 : DIAS_SUGESTAO)) return null;
  let pontos = 100 - Math.min(dias, 30);
  if (rel === 'cnpj') { pontos += 40; motivos.push('mesmo CNPJ do beneficiário'); } else if (rel === 'raiz') { pontos += 20; motivos.push('mesma empresa (outra filial)'); } else if (nome) { pontos += 10; motivos.push('nome do beneficiário'); }
  if (exato) { pontos += 30; motivos.push('mesmo valor'); } else motivos.push(`valor diferente (${c.reais(p.valor)})`);
  motivos.push(dias === 0 ? 'mesmo vencimento' : `vencimento a ${dias} ${dias === 1 ? 'dia' : 'dias'}`);
  return {
    tipo: 'parcela', titulo_id: t.id, parcela_id: p.id, pontos, dias, exato, motivos,
    automatico: rel === 'cnpj' && exato && dias <= DIAS_AUTOMATICO, criterio: 'cnpj_valor_vencimento'
  };
}

/** A nota registrada sem conta que pode ser a deste boleto (nunca liga sozinha: vira sugestão "lançar pela nota"). Pura. */
function avaliarDocumento(boleto, d) {
  const rel = relacaoDoDocumento(d.emitente_documento, boleto);
  if (!rel) return null;
  const emissao = c.dia(d.data_emissao);
  if (emissao && (boleto.vencimento < motor.somarDias(emissao, -5) || motor.diasEntre(emissao, boleto.vencimento) > 180)) return null;
  const total = liquidacoes.valorAPagar(d);
  const exato = cent(total) === cent(boleto.valor);
  if (!exato && !(cent(boleto.valor) < cent(total))) return null;
  return {
    tipo: 'documento', documento_recebido_id: Number(d.id), pontos: (exato ? 80 : 50) + (rel === 'cnpj' ? 20 : 0),
    motivos: [rel === 'cnpj' ? 'mesmo CNPJ do emitente' : 'mesma empresa (outra filial)', exato ? 'o valor da nota' : `parte da nota de ${c.reais(total)}`],
    automatico: false
  };
}

/**
 * Boleto × contas a pagar (e notas sem conta). Devolve Map(id do boleto ->
 * { automatico, sugestoes }): `automatico` só quando o par é único dos dois
 * lados; `sugestoes` em ordem de pontos. Só os boletos "novo" entram; a
 * parcela já ligada a outro boleto não é candidata. Pura.
 */
function casar({ boletos = [], titulos: lista = [], documentos = [], contatos = new Map(), contasPorDocumento = new Map() }) {
  const ocupadas = new Set(c.lista(boletos).filter(x => x && x.parcela_id && x.situacao === 'vinculado').map(x => String(x.parcela_id)));
  const parcelas = [];
  for (const t of c.lista(lista)) {
    if (!t || t.status === 'cancelado') continue;
    const contato = t.contato_id !== null && t.contato_id !== undefined ? contatos.get(String(t.contato_id)) || null : null;
    for (const p of t.parcelas || []) if (!ocupadas.has(String(p.id)) && p.situacao !== 'cancelada') parcelas.push({ t, p, contato });
  }
  const livres = c.lista(documentos).filter(d => liquidacoes.documentoSemConta(d, contasPorDocumento));
  const saida = new Map();
  const autoDaParcela = new Map();
  for (const bol of c.lista(boletos).filter(x => x && x.situacao === 'novo')) {
    const cands = [
      ...parcelas.map(x => avaliarParcela(bol, x.t, x.p, { contato: x.contato })).filter(Boolean),
      ...livres.map(d => avaliarDocumento(bol, d)).filter(Boolean)
    ].sort((x, y) => y.pontos - x.pontos || String(x.parcela_id ?? x.documento_recebido_id).localeCompare(String(y.parcela_id ?? y.documento_recebido_id)));
    const autos = cands.filter(x => x.automatico);
    const unico = autos.length === 1 ? autos[0] : null;
    if (unico) autoDaParcela.set(String(unico.parcela_id), [...(autoDaParcela.get(String(unico.parcela_id)) || []), bol.id]);
    saida.set(bol.id, { automatico: unico, sugestoes: cands.slice(0, 5) });
  }
  // O par é único dos dois lados: a parcela que dois boletos querem não liga sozinha com nenhum.
  for (const [, r] of saida) if (r.automatico && (autoDaParcela.get(String(r.automatico.parcela_id)) || []).length > 1) r.automatico = null;
  return saida;
}

// ------------------------------------------------------------------ leitura

/** Os boletos (null = falta o SQL da fase H). */
const lerTodos = api => b.lerOpcional(api, TABELA);

async function lerBoleto(api, id) {
  const linha = (await b.ler(api, TABELA, { id: Number(id) }))[0] || null;
  if (!linha) throw c.erro('Boleto do DDA não encontrado.', 404);
  return linha;
}

/** Os boletos já no formato das contas (datas e valores normalizados). */
function normalizar(l) {
  return {
    ...l, id: Number(l.id), vencimento: c.dia(l.vencimento), data_registro: c.dia(l.data_registro), valor: c.centavos(l.valor),
    estado_bb: Number(l.estado_bb), estados: c.jsonDe(l.estados, []) || [], linha_digitavel: b.digitos(l.linha_digitavel) || null,
    codigo_barras: b.digitos(l.codigo_barras), situacao: SITUACOES[l.situacao] ? l.situacao : 'novo'
  };
}

/** Tudo o que o casamento e a tela precisam, numa leitura. null = falta o SQL da fase H. */
async function lerBase(api, hoje) {
  const linhas = await lerTodos(api);
  if (linhas === null) return null;
  const [base, documentos] = await Promise.all([titulos.lerBase(api), b.lerOpcional(api, 'documentos_recebidos').then(x => x || [])]);
  const lista = titulos.montarTodos(base, hoje);
  const contasPorDocumento = new Map();
  for (const t of base.titulos) {
    if (t?.documento_recebido_id === null || t?.documento_recebido_id === undefined) continue;
    const k = String(t.documento_recebido_id);
    contasPorDocumento.set(k, [...(contasPorDocumento.get(k) || []), t]);
  }
  return { boletos: linhas.filter(Boolean).map(normalizar), titulos: lista, documentos, contatos: base.contatos, contasPorDocumento };
}

// ------------------------------------------------------------------ gravação da busca

const json = v => JSON.stringify(v);

/**
 * Grava o que a busca trouxe. `estados` e o período são os da consulta (o
 * "sumiu" só vale para boleto que a busca devia ter trazido e não trouxe —
 * e só quando a busca pediu os três estados, senão o pago some do "a pagar").
 * Devolve `{ novos, mudaram, sumiram, iguais, meses }`.
 */
async function gravarBusca(api, busca, { ambiente, capturadoEm, inicio, fim }) {
  const linhas = await b.ler(api, TABELA);
  const porChave = new Map(linhas.map(l => [l.chave_interna, l]));
  const vistos = new Set();
  const saida = { novos: 0, mudaram: 0, sumiram: 0, iguais: 0, meses: new Set(), liquidados: 0 };
  for (const bol of busca.boletos) {
    vistos.add(bol.chave_interna);
    const ja = porChave.get(bol.chave_interna);
    if (!ja) {
      await b.inserir(api, TABELA, {
        chave_interna: bol.chave_interna, ambiente, pagador_documento: bol.pagador_documento,
        beneficiario_documento: bol.beneficiario_documento, beneficiario_tipo: bol.beneficiario_tipo, beneficiario_nome: bol.beneficiario_nome,
        beneficiario_final_documento: bol.beneficiario_final_documento, beneficiario_final_tipo: bol.beneficiario_final_tipo, beneficiario_final_nome: bol.beneficiario_final_nome,
        seu_numero: bol.seu_numero, codigo_barras: bol.codigo_barras, linha_digitavel: bol.linha_digitavel,
        data_registro: bol.data_registro, vencimento: bol.vencimento, valor: bol.valor, estado_bb: bol.estado,
        estados: json([{ estado: bol.estado, visto_em: capturadoEm }]),
        json_original: json({ objeto: bol.bruto, consulta: { codigoEstadoObrigacao: bol.estado, numeroIdentificadorPagador: bol.pagador_documento, ambiente, capturado_em: capturadoEm } }),
        capturado_em: capturadoEm, visto_em: capturadoEm, situacao: 'novo', atualizado_em: capturadoEm
      });
      saida.novos++;
      saida.meses.add(bol.vencimento.slice(0, 7));
      if (bol.estado === 3) saida.liquidados++;
      continue;
    }
    const estadoAntes = Number(ja.estado_bb);
    const campos = { visto_em: capturadoEm, sumiu_em: null, atualizado_em: capturadoEm };
    if (estadoAntes !== bol.estado) {
      campos.estado_bb = bol.estado;
      campos.estados = json([...(c.jsonDe(ja.estados, []) || []), { estado: bol.estado, de: estadoAntes, visto_em: capturadoEm }]);
      saida.mudaram++;
      saida.meses.add(bol.vencimento.slice(0, 7));
      if (bol.estado === 3) saida.liquidados++;
    } else {
      saida.iguais++;
    }
    await b.atualizar(api, TABELA, ja.id, campos);
  }
  const completa = [1, 2, 3].every(e => (busca.estados || []).includes(e));
  if (completa) {
    for (const l of linhas) {
      const venc = c.dia(l.vencimento);
      if (vistos.has(l.chave_interna) || l.sumiu_em || l.ambiente !== ambiente || venc < inicio || venc > fim) continue;
      await b.atualizar(api, TABELA, l.id, { sumiu_em: capturadoEm, atualizado_em: capturadoEm });
      saida.sumiram++;
    }
  }
  return { ...saida, meses: [...saida.meses].sort() };
}

// ------------------------------------------------------------------ ligações

/** A parcela (com a conta) para ligar: existe, a conta não foi cancelada, não é de outro boleto. */
async function conferirParcela(api, parcelaId, { boletoId }) {
  const p = (await b.ler(api, 'titulo_pagar_parcelas', { id: Number(parcelaId) }))[0] || null;
  if (!p) throw c.erro('Parcela não encontrada.', 404);
  const t = (await b.ler(api, 'titulos_pagar', { id: Number(p.titulo_id) }))[0] || null;
  if (!t || t.status === 'cancelado') throw c.erro('A conta desta parcela foi cancelada.', 409);
  const outro = (await b.ler(api, TABELA, { parcela_id: Number(p.id) })).find(x => String(x.id) !== String(boletoId) && x.situacao === 'vinculado');
  if (outro) throw c.erro('Esta parcela já está ligada a outro boleto do DDA: desligue-o antes.', 409);
  return { p, t };
}

/**
 * Liga o boleto à parcela e completa a linha digitável da parcela que estava
 * sem (a calculada do código de barras). Registra no histórico da conta.
 */
async function ligar(api, bol, { p, t }, { criterio, usuarioId = null }) {
  await b.atualizar(api, TABELA, bol.id, {
    situacao: 'vinculado', titulo_id: Number(t.id), parcela_id: Number(p.id), vinculo_criterio: criterio,
    vinculado_em: c.agora(), vinculado_por: usuarioId, motivo: null, decidido_em: null, decidido_por: null, atualizado_em: c.agora()
  });
  let completouLinha = false;
  if (!b.digitos(p.linha_digitavel) && bol.linha_digitavel) {
    await b.atualizar(api, 'titulo_pagar_parcelas', p.id, { linha_digitavel: bol.linha_digitavel }).then(() => { completouLinha = true; }).catch(() => null);
  }
  await eventos.registrar(api, {
    tipo: 'dda_vinculado', usuarioId, competencia: t.competencia, referenciaTipo: 'titulo', referenciaId: t.id,
    descricao: `Boleto do DDA de ${bol.beneficiario_nome || 'beneficiário'} (${c.reais(bol.valor)}, vence ${c.impressa(bol.vencimento)}) ligado à conta "${t.descricao}"`
      + ` — ${CRITERIOS[criterio] || criterio}${completouLinha ? '; a linha digitável da parcela foi completada' : ''}`,
    dados: { boleto_id: bol.id, parcela_id: p.id, criterio }
  });
  return { completouLinha };
}

/**
 * As ligações automáticas (linha digitável; CNPJ + valor + vencimento com o
 * par único). Roda depois de cada busca e pelo botão "Ligar sozinho".
 * Devolve `{ ligados, linhas_completadas, meses }`.
 */
async function vincularSozinho(api, { usuarioId = null, hoje } = {}) {
  const base = await lerBase(api, hoje);
  if (!base) return { ligados: 0, linhas_completadas: 0, meses: [] };
  const casados = casar(base);
  const porParcela = new Map(base.titulos.flatMap(t => t.parcelas.map(p => [String(p.id), { t, p }])));
  const saida = { ligados: 0, linhas_completadas: 0, meses: new Set(), falhas: [] };
  for (const bol of base.boletos.filter(x => x.situacao === 'novo')) {
    const auto = casados.get(bol.id)?.automatico;
    if (!auto) continue;
    const alvo = porParcela.get(String(auto.parcela_id));
    if (!alvo) continue;
    try {
      const r = await ligar(api, bol, { p: { ...alvo.p, linha_digitavel: alvo.p.linha_digitavel }, t: { id: alvo.t.id, descricao: alvo.t.descricao, competencia: alvo.t.competencia } }, { criterio: auto.criterio, usuarioId });
      saida.ligados++;
      if (r.completouLinha) saida.linhas_completadas++;
      saida.meses.add(bol.vencimento.slice(0, 7));
    } catch (e) {
      saida.falhas.push(`${bol.beneficiario_nome || 'boleto'} ${c.reais(bol.valor)}: ${e.message}`);
    }
  }
  return { ...saida, meses: [...saida.meses].sort() };
}

// ------------------------------------------------------------------ tela

/** A sugestão já com o que a tela mostra (a conta/parcela ou a nota). Pura. */
function sugestaoPublica(s, { titulosPorId, documentosPorId }) {
  if (s.tipo === 'parcela') {
    const t = titulosPorId.get(String(s.titulo_id));
    const p = t?.parcelas.find(x => String(x.id) === String(s.parcela_id));
    if (!t || !p) return null;
    return {
      tipo: 'parcela', titulo_id: t.id, parcela_id: p.id, automatico: Boolean(s.automatico), pontos: s.pontos, motivos: s.motivos,
      rotulo: `${t.descricao}${p.de > 1 ? ` · parcela ${p.numero}/${p.de}` : ''}`, fornecedor: t.fornecedor || null,
      vencimento: p.vencimento, valor: p.valor, situacao: p.situacao, situacao_rotulo: p.situacao_rotulo, pagamento: p.pagamento || null
    };
  }
  const d = documentosPorId.get(String(s.documento_recebido_id));
  if (!d) return null;
  return {
    tipo: 'documento', documento_recebido_id: Number(d.id), pontos: s.pontos, motivos: s.motivos,
    rotulo: `${d.tipo === 'nfse' ? 'NFS-e' : (d.tipo === 'nfe' ? 'NF-e' : 'Documento')} ${d.numero || ''}`.trim(), fornecedor: d.emitente_nome || null,
    data_emissao: c.dia(d.data_emissao), valor: c.centavos(d.valor_total), competencia: d.competencia || null
  };
}

/** O contato (fornecedor) com o CPF/CNPJ do beneficiário, se houver. Pura. */
function contatoDoBeneficiario(bol, contatos) {
  for (const ct of contatos.values()) if (relacaoDoDocumento(docDoContato(ct), bol) === 'cnpj') return ct;
  return null;
}

/** A conta já preenchida para o "Lançar conta" (o formulário mostra para conferir). Pura. */
function contaSugerida(bol, { contatos, documento = null }) {
  const contato = contatoDoBeneficiario(bol, contatos);
  return {
    descricao: `${documento ? `${documento.rotulo} — ` : 'Boleto — '}${contato?.nome || bol.beneficiario_nome || 'beneficiário'}`.slice(0, 200),
    contato_id: contato?.id ?? null, numero_documento: bol.seu_numero || null,
    data_emissao: documento?.data_emissao || null, competencia: documento?.competencia || bol.vencimento.slice(0, 7),
    valor_total: bol.valor, documento_recebido_id: documento?.documento_recebido_id ?? null,
    parcelas: [{ vencimento: bol.vencimento, valor: bol.valor, linha_digitavel: bol.linha_digitavel }]
  };
}

/** Um boleto como a tela vê. Pura. */
function linhaPublica(bol, { casado = null, titulosPorId, documentosPorId, contatos }) {
  const t = bol.titulo_id ? titulosPorId.get(String(bol.titulo_id)) || null : null;
  const p = t ? t.parcelas.find(x => String(x.id) === String(bol.parcela_id)) || null : null;
  const sugestoes = (casado?.sugestoes || []).map(s => sugestaoPublica(s, { titulosPorId, documentosPorId })).filter(Boolean);
  const finalDiferente = bol.beneficiario_final_documento && bol.beneficiario_final_documento !== bol.beneficiario_documento;
  const avisos = [];
  if (bol.situacao === 'vinculado' && p && bol.estado_bb === 3 && !p.pagamento) avisos.push('O DDA diz que este boleto foi pago, mas a conta continua em aberto: concilie o débito do extrato (ou registre o pagamento).');
  if (bol.situacao === 'vinculado' && p && cent(p.valor) !== cent(bol.valor)) avisos.push(`A parcela é de ${c.reais(p.valor)} e o boleto de ${c.reais(bol.valor)}.`);
  if (bol.sumiu_em && bol.estado_bb !== 3) avisos.push('Não aparece mais no DDA: o beneficiário pode ter baixado ou trocado o boleto.');
  const novo = bol.situacao === 'novo';
  return {
    id: bol.id, chave_interna: bol.chave_interna, chave_curta: String(bol.chave_interna || '').slice(0, 12), ambiente: bol.ambiente,
    vencimento: bol.vencimento, valor: bol.valor, data_registro: bol.data_registro,
    beneficiario_nome: bol.beneficiario_nome, beneficiario_documento: b.documentoFormatado(bol.beneficiario_documento) || bol.beneficiario_documento,
    beneficiario_final_nome: finalDiferente ? bol.beneficiario_final_nome : null,
    beneficiario_final_documento: finalDiferente ? (b.documentoFormatado(bol.beneficiario_final_documento) || bol.beneficiario_final_documento) : null,
    seu_numero: bol.seu_numero || null, codigo_barras: bol.codigo_barras, linha_digitavel: linhaImpressa(bol.linha_digitavel),
    estado_bb: bol.estado_bb, estado_rotulo: bbDda.ROTULOS_ESTADO[bol.estado_bb] || '—',
    estados: (bol.estados || []).map(e => ({ estado: Number(e.estado), rotulo: bbDda.ROTULOS_ESTADO[e.estado] || '—', visto_em: b.instanteBR(e.visto_em) })),
    situacao: bol.situacao, situacao_rotulo: SITUACOES[bol.situacao], motivo: bol.motivo || null, decidido_em: b.instanteBR(bol.decidido_em),
    capturado_em: b.instanteBR(bol.capturado_em), visto_em: b.instanteBR(bol.visto_em), sumiu_em: b.instanteBR(bol.sumiu_em),
    vinculo: t && p ? {
      titulo_id: t.id, parcela_id: p.id, descricao: t.descricao, fornecedor: t.fornecedor || null, parcela: `${p.numero}/${p.de}`,
      vencimento: p.vencimento, valor: p.valor, situacao: p.situacao, situacao_rotulo: p.situacao_rotulo, pagamento: p.pagamento || null,
      criterio: bol.vinculo_criterio || null, criterio_rotulo: CRITERIOS[bol.vinculo_criterio] || null
    } : null,
    sugestoes, avisos,
    pode: {
      ligar: novo, lancar: novo, ignorar: novo, contestar: novo, desligar: bol.situacao === 'vinculado',
      restaurar: bol.situacao === 'ignorado' || bol.situacao === 'contestado'
    }
  };
}

const naVisao = (bol, visao) => (visao === 'sem_conta' ? bol.situacao === 'novo'
  : visao === 'ligados' ? bol.situacao === 'vinculado'
    : visao === 'decididos' ? ['ignorado', 'contestado'].includes(bol.situacao) : true);

/** A lista da tela, com a contagem e a situação da busca. */
async function listar(api, { visao = 'sem_conta', hoje }) {
  const v = VISOES[visao] ? visao : 'sem_conta';
  const base = await lerBase(api, hoje);
  const integracao = ((await b.lerOpcional(api, 'contabil_integracoes', { chave: 'bb_dda' }).catch(() => null)) || [])[0] || null;
  const situacaoBusca = integracao ? {
    ativa: Boolean(integracao.ativa), ambiente: integracao.ambiente, ultima_execucao_em: b.instanteBR(integracao.ultima_execucao_em),
    ultimo_sucesso_em: b.instanteBR(integracao.ultimo_sucesso_em), ultimo_erro: integracao.ultimo_erro || null
  } : null;
  if (!base) return { sql_pendente: true, sql_arquivo: b.SQL_ARQUIVO_FASE_H, visao: v, visoes: VISOES, linhas: [], contagem: null, busca: situacaoBusca };
  const casados = casar(base);
  const titulosPorId = new Map(base.titulos.map(t => [String(t.id), t]));
  const documentosPorId = new Map(base.documentos.map(d => [String(d.id), d]));
  const linhas = base.boletos
    .map(bol => linhaPublica(bol, { casado: casados.get(bol.id), titulosPorId, documentosPorId, contatos: base.contatos }))
    .sort((x, y) => String(x.vencimento).localeCompare(String(y.vencimento)) || x.id - y.id);
  const semConta = base.boletos.filter(x => x.situacao === 'novo');
  return {
    sql_pendente: false, visao: v, visoes: VISOES, situacoes: SITUACOES, estados: bbDda.ROTULOS_ESTADO, busca: situacaoBusca, hoje: c.dia(hoje),
    linhas: linhas.filter(l => naVisao(l, v)),
    contagem: {
      total: base.boletos.length,
      sem_conta: semConta.length, sem_conta_valor: c.centavos(semConta.reduce((s, x) => s + x.valor, 0)),
      com_sugestao: semConta.filter(x => (casados.get(x.id)?.sugestoes || []).length).length,
      ligados: base.boletos.filter(x => x.situacao === 'vinculado').length,
      decididos: base.boletos.filter(x => ['ignorado', 'contestado'].includes(x.situacao)).length
    }
  };
}

/**
 * Um boleto com as parcelas que dá para ligar à mão (as de conta não
 * cancelada, ainda sem boleto: o mesmo beneficiário ou o mesmo valor) e a
 * conta já preenchida para o "Lançar conta".
 */
async function detalhe(api, id, { hoje }) {
  const base = await lerBase(api, hoje);
  if (!base) throw c.erro(b.SQL_FALTANDO_FASE_H, 409, { sql_pendente: true, sql_arquivo: b.SQL_ARQUIVO_FASE_H });
  const bol = base.boletos.find(x => String(x.id) === String(id));
  if (!bol) throw c.erro('Boleto do DDA não encontrado.', 404);
  const casados = casar(base);
  const titulosPorId = new Map(base.titulos.map(t => [String(t.id), t]));
  const documentosPorId = new Map(base.documentos.map(d => [String(d.id), d]));
  const ocupadas = new Set(base.boletos.filter(x => x.parcela_id && x.situacao === 'vinculado' && x.id !== bol.id).map(x => String(x.parcela_id)));
  const candidatos = [];
  for (const t of base.titulos.filter(x => x.status !== 'cancelado')) {
    const contato = t.contato_id !== null && t.contato_id !== undefined ? base.contatos.get(String(t.contato_id)) || null : null;
    for (const p of t.parcelas.filter(x => !ocupadas.has(String(x.id)) && x.situacao !== 'cancelada')) {
      const a = avaliarParcela(bol, t, p, { contato, livre: true });
      if (a) candidatos.push(sugestaoPublica(a, { titulosPorId, documentosPorId }));
    }
  }
  const linha = linhaPublica(bol, { casado: casados.get(bol.id), titulosPorId, documentosPorId, contatos: base.contatos });
  const notaSugerida = linha.sugestoes.filter(s => s.tipo === 'documento');
  return {
    boleto: linha,
    candidatos: candidatos.filter(Boolean).sort((x, y) => y.pontos - x.pontos).slice(0, 30),
    conta_sugerida: contaSugerida(bol, { contatos: base.contatos, documento: notaSugerida.length === 1 ? notaSugerida[0] : null }),
    json_original: c.jsonDe(base.boletos.find(x => x.id === bol.id)?.json_original, null)
  };
}

/** O boleto ainda sem decisão (só ele se liga, se lança, se ignora ou se contesta). */
async function boletoNovo(api, id) {
  const bol = normalizar(await lerBoleto(api, id));
  if (bol.situacao !== 'novo') {
    throw c.erro(bol.situacao === 'vinculado' ? 'Este boleto já está ligado a uma conta: desligue antes.' : `Este boleto está ${SITUACOES[bol.situacao].toLowerCase()}: restaure antes.`, 409);
  }
  return bol;
}

/** Liga à mão o boleto a uma parcela. */
async function vincular(api, id, { parcelaId, usuarioId = null }) {
  if (!/^\d+$/.test(String(parcelaId ?? ''))) throw c.erro('Escolha a parcela da conta a pagar.');
  const bol = await boletoNovo(api, id);
  const alvo = await conferirParcela(api, parcelaId, { boletoId: bol.id });
  try {
    const r = await ligar(api, bol, alvo, { criterio: 'manual', usuarioId });
    return { id: bol.id, situacao: 'vinculado', titulo_id: Number(alvo.t.id), parcela_id: Number(alvo.p.id), linha_completada: r.completouLinha };
  } catch (e) {
    if (c.ehDuplicado(e) && !e.extra?.sql_pendente) throw c.erro('Esta parcela acabou de ser ligada a outro boleto.', 409);
    throw e;
  }
}

/** Desliga o boleto da conta (volta a "sem conta"); a linha digitável da parcela fica. */
async function desvincular(api, id, { motivo, usuarioId = null }) {
  const texto = c.texto(motivo, 500);
  if (texto.length < 5) throw c.erro('Diga por que o boleto sai desta conta (ao menos 5 letras).');
  const bol = normalizar(await lerBoleto(api, id));
  if (bol.situacao !== 'vinculado') throw c.erro('Este boleto não está ligado a uma conta.', 409);
  const t = bol.titulo_id ? (await b.ler(api, 'titulos_pagar', { id: Number(bol.titulo_id) }))[0] || null : null;
  await b.atualizar(api, TABELA, bol.id, {
    situacao: 'novo', titulo_id: null, parcela_id: null, vinculo_criterio: null, vinculado_em: null, vinculado_por: null, atualizado_em: c.agora()
  });
  await eventos.registrar(api, {
    tipo: 'dda_desvinculado', usuarioId, competencia: t?.competencia || null, referenciaTipo: t ? 'titulo' : null, referenciaId: t?.id ?? null,
    descricao: `Boleto do DDA de ${bol.beneficiario_nome || 'beneficiário'} (${c.reais(bol.valor)}) desligado${t ? ` da conta "${t.descricao}"` : ''}: ${texto}`,
    dados: { boleto_id: bol.id, parcela_id: bol.parcela_id }
  });
  return { id: bol.id, situacao: 'novo' };
}

/**
 * A parcela da conta recém-lançada que é a do boleto: a de mesma linha
 * digitável, a de mesmo vencimento e valor, a única, ou a de mesmo valor. Pura.
 */
function parcelaDoBoleto(bol, parcelas) {
  const lista = c.lista(parcelas);
  return lista.find(p => b.digitos(p.linha_digitavel) && [bol.linha_digitavel, bol.codigo_barras].includes(b.digitos(p.linha_digitavel)))
    || lista.find(p => c.dia(p.vencimento) === bol.vencimento && cent(p.valor) === cent(bol.valor))
    || (lista.length === 1 ? lista[0] : null)
    || lista.find(p => cent(p.valor) === cent(bol.valor))
    || null;
}

/**
 * Lança a conta a partir do boleto (o formulário vem preenchido; o usuário
 * confere) e liga o boleto à parcela dele. Falhou ao ligar: a conta é
 * cancelada.
 */
async function lancar(api, id, { entrada = {}, usuarioId = null, hoje }) {
  const bol = await boletoNovo(api, id);
  const criada = await titulos.criar(api, { entrada, usuarioId, hoje, origem: 'dda' });
  try {
    const parcelas = await b.ler(api, 'titulo_pagar_parcelas', { titulo_id: Number(criada.id) });
    const p = parcelaDoBoleto(bol, parcelas);
    if (!p) throw c.erro('Nenhuma parcela da conta tem o valor do boleto: confira as parcelas.', 422);
    const t = (await b.ler(api, 'titulos_pagar', { id: Number(criada.id) }))[0];
    await ligar(api, bol, { p, t }, { criterio: 'lancada', usuarioId });
    await eventos.registrar(api, {
      tipo: 'dda_conta_lancada', usuarioId, competencia: t.competencia, referenciaTipo: 'titulo', referenciaId: t.id,
      descricao: `Conta "${t.descricao}" lançada do boleto do DDA de ${bol.beneficiario_nome || 'beneficiário'} (${c.reais(bol.valor)}, vence ${c.impressa(bol.vencimento)})`,
      dados: { boleto_id: bol.id, parcela_id: p.id }
    });
    return { id: bol.id, situacao: 'vinculado', titulo_id: Number(t.id), parcela_id: Number(p.id) };
  } catch (e) {
    await titulos.cancelar(api, criada.id, { motivo: 'Falhou ao ligar ao boleto do DDA', usuarioId, avisar: false }).catch(() => null);
    throw e;
  }
}

/** Ignorar (não é da empresa, repetido…) ou contestar (a empresa não deve): sai do aviso, com o motivo. */
async function decidir(api, id, { situacao, motivo, usuarioId = null }) {
  if (!['ignorado', 'contestado'].includes(situacao)) throw c.erro('Decisão inválida.');
  const texto = c.texto(motivo, 500);
  if (texto.length < 5) throw c.erro(situacao === 'contestado' ? 'Diga por que a empresa não deve este boleto (ao menos 5 letras).' : 'Diga por que o boleto é ignorado (ao menos 5 letras).');
  const bol = await boletoNovo(api, id);
  await b.atualizar(api, TABELA, bol.id, { situacao, motivo: texto, decidido_em: c.agora(), decidido_por: usuarioId, atualizado_em: c.agora() });
  await eventos.registrar(api, {
    tipo: situacao === 'contestado' ? 'dda_contestado' : 'dda_ignorado', usuarioId, competencia: bol.vencimento.slice(0, 7),
    descricao: `Boleto do DDA de ${bol.beneficiario_nome || 'beneficiário'} (${c.reais(bol.valor)}, vence ${c.impressa(bol.vencimento)}) ${situacao}: ${texto}`,
    dados: { boleto_id: bol.id }
  });
  return { id: bol.id, situacao };
}

async function restaurar(api, id, { usuarioId = null } = {}) {
  const bol = normalizar(await lerBoleto(api, id));
  if (!['ignorado', 'contestado'].includes(bol.situacao)) throw c.erro('Este boleto não está ignorado nem contestado.', 409);
  await b.atualizar(api, TABELA, bol.id, { situacao: 'novo', motivo: null, decidido_em: null, decidido_por: null, atualizado_em: c.agora() });
  await eventos.registrar(api, {
    tipo: 'dda_restaurado', usuarioId, competencia: bol.vencimento.slice(0, 7),
    descricao: `Boleto do DDA de ${bol.beneficiario_nome || 'beneficiário'} (${c.reais(bol.valor)}) voltou a ficar sem conta (antes ${bol.situacao}: ${bol.motivo || 'sem motivo'})`,
    dados: { boleto_id: bol.id }
  });
  return { id: bol.id, situacao: 'novo' };
}

module.exports = {
  TABELA, SITUACOES, VISOES, CRITERIOS, DIAS_AUTOMATICO, DIAS_SUGESTAO,
  linhaImpressa, relacaoDoDocumento, avaliarParcela, avaliarDocumento, casar, normalizar, contatoDoBeneficiario, contaSugerida, parcelaDoBoleto, linhaPublica,
  lerTodos, lerBoleto, lerBase, gravarBusca, ligar, vincularSozinho, listar, detalhe, vincular, desvincular, lancar, decidir, restaurar
};
