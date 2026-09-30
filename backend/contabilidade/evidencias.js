/**
 * Documentos da competência (etapa 2): tudo o que PROVA o mês para a
 * contabilidade, numa lista só — é a base do pacote (etapa 9).
 *
 *   saida       NF-e de saída emitidas aqui (XML autorizado) e as de fora
 *   devolucao   notas de devolução dos clientes (XML guardado na devolução)
 *   recebidos   os documentos recebidos (NF-e de entrada, NFS-e, recibos…)
 *               e os arquivos deles; documento sem arquivo aparece como FALTA
 *   pagamentos  comprovantes de pagamento anexados
 *   outros      o resto anexado à competência (guia, contrato, extrato…)
 *
 * Cada item diz a origem (oficial, interno, fornecido) e como baixar. Os XML
 * das notas de saída, de fora e de devolução saem por uma rota daqui
 * (`contabilidade.view`): quem fecha o mês não precisa das permissões de
 * NF-e do Financeiro para juntar os arquivos.
 */
const c = require('../financeiro/comum');
const b = require('./base');
const arquivos = require('./arquivos');
const documentos = require('./documentosRecebidos');
const externas = require('../fiscal/externas');

/** O rótulo curto de cada grupo (a coluna da lista; o filtro da tela tem o nome longo). */
const GRUPOS = { saida: 'NF-e de saída', devolucao: 'Devolução', recebidos: 'Recebido', pagamentos: 'Comprovante', outros: 'Outro' };
const STATUS_COM_XML = new Set(['autorizada', 'cancelada']);

const doMes = (data, competencia) => String(c.dia(data) || '').startsWith(competencia);

/**
 * Monta a lista a partir do que já foi lido. `arquivosLista` já vem no
 * formato público (arquivos.listar). Pura.
 */
function montar({ competencia, notas = [], externasLista = [], devolucoes = [], docs = [], arquivosLista = [], pedidos = new Map() }) {
  const itens = [];
  for (const n of notas) {
    if (!n || !doMes(n.data_emissao, competencia) || !STATUS_COM_XML.has(String(n.status_fiscal)) || !(n.xml_autorizado || n.xml_envio)) continue;
    const dest = c.jsonDe(n.destinatario, null);
    const pedido = pedidos.get(String(n.pedido_id));
    itens.push({
      chave: `saida:${n.id}`, grupo: 'saida', data: c.dia(n.data_emissao), titulo: `NF-e ${n.serie}/${n.numero}${n.status_fiscal === 'cancelada' ? ' (cancelada)' : ''}`,
      detalhe: [pedido ? `Pedido ${pedido}` : null, dest?.nome || null].filter(Boolean).join(' · ') || null,
      valor: c.centavos(n.valor_total), categoria: 'XML de NF-e', origem: n.xml_autorizado ? 'oficial' : 'interno',
      baixar: { tipo: 'saida', id: n.id }, falta: false
    });
  }
  for (const n of externasLista) {
    if (!n || !doMes(n.data_emissao, competencia)) continue;
    const pedido = pedidos.get(String(n.pedido_id));
    itens.push({
      chave: `externa:${n.id}`, grupo: 'saida', data: c.dia(n.data_emissao), titulo: `NF-e de fora ${n.serie ?? ''}${n.serie !== undefined && n.serie !== null ? '/' : ''}${n.numero ?? ''}`.trim(),
      detalhe: pedido ? `Pedido ${pedido}` : null, valor: c.centavos(n.valor_total), categoria: 'XML de NF-e', origem: 'oficial',
      baixar: n.tem_xml ? { tipo: 'externa', id: n.pedido_id } : null, falta: !n.tem_xml,
      falta_rotulo: n.tem_xml ? null : 'Sem o XML (informada só pela chave)'
    });
  }
  for (const n of devolucoes) {
    if (!n || !doMes(n.data_emissao, competencia)) continue;
    const pedido = pedidos.get(String(n.pedido_id));
    itens.push({
      chave: `devolucao:${n.id}`, grupo: 'devolucao', data: c.dia(n.data_emissao), titulo: `NF-e de devolução ${n.serie}/${n.numero}`,
      detalhe: [n.emitente_nome, pedido ? `Pedido ${pedido}` : null].filter(Boolean).join(' · ') || null,
      valor: c.centavos(n.valor_total), categoria: 'XML de NF-e', origem: n.protocolo ? 'oficial' : 'fornecido',
      baixar: n.xml ? { tipo: 'devolucao', id: n.id } : null, falta: !n.xml
    });
  }
  const arquivosDoDoc = new Map();
  for (const a of arquivosLista) {
    for (const v of a.vinculos || []) {
      if (v.alvo_tipo !== 'documento_recebido') continue;
      if (!arquivosDoDoc.has(String(v.alvo_id))) arquivosDoDoc.set(String(v.alvo_id), []);
      arquivosDoDoc.get(String(v.alvo_id)).push(a);
    }
  }
  const listados = new Set();
  for (const d of docs) {
    if (!d || d.excluido_em || d.competencia !== competencia) continue;
    const titulo = documentos.rotuloDoDocumento(d);
    const seus = arquivosDoDoc.get(String(d.id)) || [];
    if (!seus.length) {
      itens.push({
        chave: `documento:${d.id}`, grupo: 'recebidos', data: c.dia(d.data_emissao), titulo, detalhe: d.emitente_nome || null,
        valor: c.centavos(d.valor_total), categoria: documentos.TIPOS[d.tipo], origem: null, baixar: null, falta: true,
        falta_rotulo: d.tipo === 'nfe' ? 'Sem o XML' : 'Sem o arquivo', documento_id: d.id
      });
      continue;
    }
    for (const a of seus) {
      listados.add(a.id);
      itens.push({
        chave: `arquivo:${a.id}:${d.id}`, grupo: 'recebidos', data: c.dia(d.data_emissao), titulo, detalhe: [d.emitente_nome, a.nome].filter(Boolean).join(' · '),
        valor: c.centavos(d.valor_total), categoria: a.categoria_rotulo, origem: a.origem, baixar: { tipo: 'arquivo', id: a.id }, falta: false, documento_id: d.id
      });
    }
    if (d.tipo === 'nfe' && !seus.some(a => a.categoria === 'xml_nfe')) {
      itens.push({
        chave: `documento-xml:${d.id}`, grupo: 'recebidos', data: c.dia(d.data_emissao), titulo, detalhe: d.emitente_nome || null,
        valor: c.centavos(d.valor_total), categoria: 'XML de NF-e', origem: null, baixar: null, falta: true, falta_rotulo: 'Sem o XML', documento_id: d.id
      });
    }
  }
  for (const a of arquivosLista) {
    if (listados.has(a.id) || a.competencia !== competencia) continue;
    const grupo = a.categoria === 'comprovante' ? 'pagamentos' : 'outros';
    itens.push({
      chave: `arquivo:${a.id}`, grupo, data: String(a.criado_em || '').slice(0, 10) || null, titulo: a.descricao || a.nome,
      detalhe: [a.nome !== (a.descricao || a.nome) ? a.nome : null, ...(a.vinculos || []).map(v => v.rotulo)].filter(Boolean).join(' · ') || null,
      valor: null, categoria: a.categoria_rotulo, origem: a.origem, baixar: { tipo: 'arquivo', id: a.id }, falta: false
    });
  }
  const ordem = Object.keys(GRUPOS);
  itens.sort((x, y) => ordem.indexOf(x.grupo) - ordem.indexOf(y.grupo) || String(x.data || '').localeCompare(String(y.data || '')) || x.chave.localeCompare(y.chave));
  const conta = f => itens.filter(f).length;
  return {
    competencia,
    rotulo: c.rotuloCompetencia(competencia),
    itens: itens.map(i => ({ ...i, grupo_rotulo: GRUPOS[i.grupo], origem_rotulo: i.origem ? arquivos.ORIGENS[i.origem] : null })),
    totais: {
      total: itens.length,
      oficial: conta(i => i.origem === 'oficial'),
      interno: conta(i => i.origem === 'interno'),
      fornecido: conta(i => i.origem === 'fornecido'),
      falta: conta(i => i.falta),
      por_grupo: Object.fromEntries(ordem.map(g => [g, conta(i => i.grupo === g)]))
    }
  };
}

async function carregar(api, { competencia, hoje }) {
  const comp = c.competenciaValida(competencia) ? String(competencia) : c.competenciaDe(hoje);
  const [notas, externasLista, devolucoes, docs, arquivosLista, pedidosLista] = await Promise.all([
    api.get('/api/notas_fiscais').then(c.lista).catch(() => []),
    externas.listarNotas(api).catch(() => []),
    api.get('/api/notas_devolucao').then(c.lista).catch(() => []),
    b.lerOpcional(api, 'documentos_recebidos'),
    arquivos.listar(api, { competencia: comp }).catch(e => (e?.extra?.sql_pendente ? null : Promise.reject(e))),
    api.get('/api/pedidos').then(c.lista).catch(() => [])
  ]);
  const pedidos = new Map(pedidosLista.filter(Boolean).map(p => [String(p.id), p.numero ?? p.id]));
  // Os arquivos ligados a documentos da competência entram mesmo que tenham outra competência.
  let todosArquivos = arquivosLista || [];
  if (docs && arquivosLista) {
    const idsDocs = new Set(docs.filter(d => d && !d.excluido_em && d.competencia === comp).map(d => String(d.id)));
    const extras = await Promise.all([...idsDocs].map(id => arquivos.listar(api, { alvoTipo: 'documento_recebido', alvoId: id })));
    const vistos = new Set(todosArquivos.map(a => a.id));
    for (const a of extras.flat()) if (!vistos.has(a.id)) { vistos.add(a.id); todosArquivos.push(a); }
  }
  const lista = montar({ competencia: comp, notas, externasLista, devolucoes, docs: docs || [], arquivosLista: todosArquivos, pedidos });
  return { ...lista, sql_pendente: docs === null || arquivosLista === null };
}

/**
 * O XML de uma nota de saída, de fora ou de devolução, para baixar:
 * `{ nome, tipo, base64 }` (o mesmo formato dos arquivos anexados).
 */
async function baixarXml(api, { tipo, id }) {
  let nome;
  let xml;
  if (tipo === 'saida') {
    const nota = await api.get(`/api/notas_fiscais/${Number(id)}`).catch(() => null);
    if (!nota || nota.error) throw c.erro('Nota não encontrada.', 404);
    xml = nota.xml_autorizado || nota.xml_envio;
    nome = `${nota.chave_acesso || `NFe-${nota.serie}-${nota.numero}`}-procNFe.xml`;
  } else if (tipo === 'externa') {
    const nota = await externas.xmlDaNota(api, Number(id));
    xml = nota.xml;
    nome = `${nota.chave_acesso || `NFe-${nota.serie}-${nota.numero}`}-procNFe.xml`;
  } else if (tipo === 'devolucao') {
    const nota = (await api.get('/api/notas_devolucao', { query: { id: Number(id) } }).then(c.lista).catch(() => [])).find(n => String(n.id) === String(id));
    if (!nota) throw c.erro('Nota de devolução não encontrada.', 404);
    xml = nota.xml;
    nome = `NFe-devolucao-${nota.chave_acesso}.xml`;
  } else {
    throw c.erro('Tipo de nota desconhecido.');
  }
  if (!xml) throw c.erro('Esta nota não tem o XML guardado.', 409);
  return { nome, tipo: 'application/xml', base64: Buffer.from(String(xml), 'utf8').toString('base64') };
}

module.exports = { GRUPOS, montar, carregar, baixarXml };
