/**
 * O que o "'" das mensagens cita (pedido do dono, 29/09/2026): os objetos da
 * Contabilidade que alguém quer apontar numa conversa — competência,
 * documento recebido, conta a pagar, lançamento do extrato, arquivo,
 * fechamento, pacote, importação de extrato, conta do banco, conta do plano
 * e fornecedor. As pendências vêm da própria tela (ela já tem o painel da
 * competência lido): não se recalcula o checklist a cada letra digitada.
 *
 * O id de cada objeto leva o que a tela precisa para abri-lo, porque a marca
 * gravada no texto é só '[rótulo](o:tipo:id)':
 *   competencia 'AAAA-MM' · fechamento 'AAAA-MM:vN' · pacote 'AAAA-MM:id'
 *   importacao 'conta_id:AAAA-MM:id' · os demais, o id da linha.
 *
 * `contatoId` restringe ao que é ligado a um contato (o "'" da ficha em
 * Contatos): os documentos e as contas dele e os arquivos ligados a eles.
 *
 * Sem busca, a lista traz o que é mais provável (a competência, os
 * documentos, as contas e os arquivos mais recentes); lançamento do extrato,
 * conta do plano, conta do banco, importação e fornecedor só aparecem quando
 * se digita. O lançamento é procurado na competência da tela (o extrato de
 * todos os meses seria pesado demais a cada letra).
 *
 * Tabela que ainda não existe (SQL da etapa não rodado) só tira aquele tipo
 * da lista. Leitura: nada é gravado.
 */
const c = require('../financeiro/comum');
const b = require('./base');
const { rotuloDoDocumento } = require('./documentosRecebidos');
const { CATEGORIAS } = require('./arquivos');

const POR_TIPO = 6;
const TOTAL = 30;
const ORDEM = ['competencia', 'documento', 'titulo', 'movimento', 'arquivo', 'fechamento', 'pacote', 'importacao', 'conta_financeira', 'conta_plano', 'fornecedor'];
const SO_BUSCANDO = new Set(['movimento', 'importacao', 'conta_financeira', 'conta_plano', 'fornecedor']);
const SITUACOES = { aberta: 'Aberta', fechada: 'Fechada', reaberta: 'Reaberta' };

const semAcento = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const mesAno = comp => (c.competenciaValida(comp) ? `${String(comp).slice(5, 7)}/${String(comp).slice(0, 4)}` : '');
const curto = (t, max) => { const s = c.texto(t, 500); return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s; };
const maisNovo = campo => (x, y) => String(y[campo] || y.criado_em || '').localeCompare(String(x[campo] || x.criado_em || '')) || Number(y.id) - Number(x.id);
const mesmo = (a, b2) => a !== null && a !== undefined && String(a) === String(b2);

/** Todas as palavras da busca aparecem no texto (sem acento, sem caixa). */
function bate(texto, termo) {
  if (!termo) return true;
  const alvo = semAcento(texto);
  return termo.split(/\s+/).filter(Boolean).every(p => alvo.includes(p));
}

/** As competências oferecidas: a da tela, os últimos 12 meses até hoje e as já fechadas/reabertas. */
function competenciasOferecidas({ competencia, hoje, linhas = [] }) {
  const lista = [];
  const pos = new Map();
  const juntar = (comp, status = null) => {
    if (!c.competenciaValida(comp)) return;
    if (pos.has(comp)) { if (status) lista[pos.get(comp)].status = status; return; }
    pos.set(comp, lista.length);
    lista.push({ competencia: comp, status });
  };
  juntar(competencia);
  const atual = c.competenciaDe(hoje);
  for (let i = 0; i <= 12 && c.competenciaValida(atual); i++) juntar(c.somarMeses(atual, -i));
  for (const l of linhas || []) juntar(l.competencia, l.status || null);
  // A da tela primeiro; as outras da mais nova para a mais antiga.
  const [primeira, ...resto] = lista;
  return primeira ? [primeira, ...resto.sort((x, y) => y.competencia.localeCompare(x.competencia))] : [];
}

/**
 * Monta a lista (pura): as linhas já lidas → os objetos que batem com a
 * busca, na ordem dos tipos, no máximo POR_TIPO de cada e TOTAL ao todo.
 * Cada lista de linhas é `null` quando a tabela não existe.
 */
function montar({
  busca = '', competencia = null, hoje = null, contatoId = null,
  competencias = null, documentos = null, titulos = null, movimentos = null, arquivos = null, vinculos = null,
  fechamentos = null, pacotes = null, importacoes = null, contasFinanceiras = null, plano = null, contatos = null
} = {}) {
  const termo = semAcento(busca).replace(/\s+/g, ' ').trim();
  const doContato = contatoId !== null && contatoId !== undefined && contatoId !== '';
  const nomeDoContato = new Map((contatos || []).map(x => [String(x.id), x.nome || x.razao_social || null]));
  const nomeDaConta = new Map((contasFinanceiras || []).map(x => [String(x.id), x.nome || null]));
  const porTipo = new Map(ORDEM.map(t => [t, []]));
  const por = (tipo, obj, textoBusca) => {
    if (!bate(`${obj.rotulo} ${obj.detalhe || ''} ${textoBusca || ''}`, termo)) return;
    porTipo.get(tipo).push({ tipo, ...obj, id: String(obj.id) });
  };

  const docs = (documentos || []).filter(d => d && !d.excluido_em && (!doContato || mesmo(d.contato_id, contatoId)));
  const tits = (titulos || []).filter(t => t && t.status !== 'cancelado' && (!doContato || mesmo(t.contato_id, contatoId)));

  if (!doContato) {
    for (const x of competenciasOferecidas({ competencia, hoje, linhas: competencias || [] })) {
      por('competencia', { id: x.competencia, rotulo: `Competência ${mesAno(x.competencia)}`, detalhe: SITUACOES[x.status] || 'Aberta' }, c.rotuloCompetencia(x.competencia));
    }
  }

  for (const d of [...docs].sort(maisNovo('data_emissao'))) {
    const quem = d.emitente_nome || nomeDoContato.get(String(d.contato_id)) || '';
    por('documento', {
      id: d.id, rotulo: curto(`${rotuloDoDocumento(d)}${quem ? ` · ${quem}` : ''}`, 110),
      detalhe: [d.data_emissao ? c.impressa(d.data_emissao) : '', d.valor_total !== null && d.valor_total !== undefined ? c.reais(d.valor_total) : ''].filter(Boolean).join(' · ')
    }, `${d.chave_acesso || ''} ${d.descricao || ''} ${d.emitente_documento || ''} ${mesAno(d.competencia)}`);
  }

  for (const t of [...tits].sort(maisNovo('data_emissao'))) {
    const quem = nomeDoContato.get(String(t.contato_id)) || '';
    por('titulo', {
      id: t.id, rotulo: curto(`Conta a pagar: ${t.descricao || t.numero_documento || `#${t.id}`}`, 110),
      detalhe: [quem, c.reais(t.valor_total), mesAno(t.competencia)].filter(Boolean).join(' · ')
    }, `${t.numero_documento || ''} ${t.categoria || ''} ${t.observacao || ''}`);
  }

  if (!doContato) {
    for (const m of [...(movimentos || [])].sort(maisNovo('data'))) {
      por('movimento', {
        id: m.id, rotulo: curto(`Lançamento ${c.impressa(m.data)} · ${m.descricao || ''}`, 110),
        detalhe: `${c.reais(m.valor)}${nomeDaConta.get(String(m.conta_id)) ? ` · ${nomeDaConta.get(String(m.conta_id))}` : ''}`
      }, `${m.documento || ''} ${m.contrapartida_documento || ''} ${String(m.valor ?? '').replace('.', ',')}`);
    }
  }

  // No contato, só os arquivos ligados aos documentos e às contas dele.
  const ligados = new Set();
  if (doContato) {
    const docIds = new Set(docs.map(d => String(d.id)));
    const titIds = new Set(tits.map(t => String(t.id)));
    for (const v of vinculos || []) {
      if ((v.alvo_tipo === 'documento_recebido' && docIds.has(String(v.alvo_id))) || (v.alvo_tipo === 'titulo' && titIds.has(String(v.alvo_id)))) ligados.add(String(v.arquivo_id));
    }
  }
  for (const a of [...(arquivos || [])].filter(a => a && !a.excluido_em && a.completo !== false && (!doContato || ligados.has(String(a.id)))).sort(maisNovo('criado_em'))) {
    por('arquivo', {
      id: a.id, rotulo: curto(`Arquivo: ${a.nome_arquivo || `#${a.id}`}`, 110),
      detalhe: [CATEGORIAS[a.categoria] || 'Arquivo', mesAno(a.competencia)].filter(Boolean).join(' · ')
    }, a.descricao || '');
  }

  if (!doContato) {
    for (const f of [...(fechamentos || [])].filter(f => c.competenciaValida(f.competencia)).sort(maisNovo('fechada_em'))) {
      por('fechamento', { id: `${f.competencia}:v${f.versao}`, rotulo: `Fechamento ${mesAno(f.competencia)} · versão ${f.versao}`, detalhe: f.fechada_em ? `Fechada em ${c.impressa(f.fechada_em)}` : '' }, c.rotuloCompetencia(f.competencia));
    }
    for (const p of [...(pacotes || [])].filter(p => c.competenciaValida(p.competencia)).sort(maisNovo('gerado_em'))) {
      por('pacote', {
        id: `${p.competencia}:${p.id}`, rotulo: curto(`Pacote ${p.nome_arquivo || `${mesAno(p.competencia)} v${p.versao}`}`, 110),
        detalhe: p.enviado_em ? `Enviado em ${c.impressa(p.enviado_em)}` : 'Gerado, falta marcar o envio'
      }, c.rotuloCompetencia(p.competencia));
    }
    for (const i of [...(importacoes || [])].filter(i => !i.desfeita_em).sort(maisNovo('criado_em'))) {
      const comp = c.competenciaValida(String(i.periodo_fim || '').slice(0, 7)) ? String(i.periodo_fim).slice(0, 7) : '';
      por('importacao', {
        id: `${i.conta_id}:${comp || '-'}:${i.id}`, rotulo: curto(`Extrato importado: ${i.nome_arquivo || 'OFX'}`, 110),
        detalhe: [i.periodo_inicio && i.periodo_fim ? `${c.impressa(i.periodo_inicio)} a ${c.impressa(i.periodo_fim)}` : '', nomeDaConta.get(String(i.conta_id)) || ''].filter(Boolean).join(' · ')
      });
    }
    for (const x of (contasFinanceiras || []).filter(x => x && x.ativa !== false)) {
      por('conta_financeira', { id: x.id, rotulo: curto(`Conta do banco: ${x.nome || `#${x.id}`}`, 110), detalhe: [x.agencia ? `Ag. ${x.agencia}` : '', x.conta ? `C/C ${x.conta}` : ''].filter(Boolean).join(' · ') });
    }
    for (const x of (plano || []).filter(x => x && x.ativa !== false)) {
      por('conta_plano', { id: x.id, rotulo: curto(`Conta do plano: ${x.codigo ? `${x.codigo} ` : ''}${x.nome || ''}`, 110), detalhe: x.tipo || '' });
    }
    // Fornecedor: só os contatos que aparecem em documento ou conta (os do módulo).
    const usados = new Set([...docs, ...tits].map(x => String(x.contato_id)).filter(id => id && id !== 'null' && id !== 'undefined'));
    for (const x of (contatos || []).filter(x => usados.has(String(x.id)))) {
      por('fornecedor', { id: x.id, rotulo: curto(`Fornecedor: ${x.nome || x.razao_social || `#${x.id}`}`, 110), detalhe: b.documentoFormatado(x.cnpj || x.cpf) || '' }, x.razao_social || '');
    }
  }

  const saida = [];
  for (const tipo of ORDEM) {
    if (!termo && SO_BUSCANDO.has(tipo)) continue;
    const limite = tipo === 'competencia' && !termo ? 3 : POR_TIPO;
    saida.push(...porTipo.get(tipo).slice(0, limite));
  }
  return saida.slice(0, TOTAL);
}

/** Lê uma tabela de fora do módulo (contatos); `null` quando não dá. */
const lerFora = (api, tabela) => api.get(`/api/${tabela}`).then(c.lista).catch(() => null);

/** Lê o que é preciso e monta. */
async function carregar({ api, busca = '', competencia = null, hoje = null, contatoId = null }) {
  const termo = semAcento(busca).trim();
  const doContato = contatoId !== null && contatoId !== undefined && contatoId !== '';
  const comp = c.competenciaValida(competencia) ? String(competencia) : null;
  const opcional = (tabela, query) => b.lerOpcional(api, tabela, query).catch(() => null);
  const buscando = Boolean(termo) && !doContato;
  const [competencias, documentos, titulos, arquivos, vinculos, fechamentos, pacotes, contatos, movimentos, importacoes, contasFinanceiras, plano] = await Promise.all([
    doContato ? null : opcional('competencia_contabil'),
    opcional('documentos_recebidos'),
    opcional('titulos_pagar'),
    opcional('contabil_arquivos'),
    doContato ? opcional('contabil_arquivo_vinculos') : null,
    doContato ? null : opcional('competencia_fechamentos'),
    doContato ? null : opcional('contabil_pacotes'),
    lerFora(api, 'contatos'),
    buscando && comp && termo.length >= 2 ? opcional('movimentos_bancarios', { competencia: comp }) : null,
    buscando ? opcional('extrato_importacoes') : null,
    doContato ? null : opcional('contas_financeiras'),
    buscando ? opcional('plano_contas') : null
  ]);
  return {
    itens: montar({
      busca, competencia: comp, hoje, contatoId: doContato ? contatoId : null,
      competencias, documentos, titulos, movimentos, arquivos, vinculos, fechamentos, pacotes, importacoes, contasFinanceiras, plano, contatos
    })
  };
}

module.exports = { POR_TIPO, TOTAL, ORDEM, bate, competenciasOferecidas, montar, carregar };
