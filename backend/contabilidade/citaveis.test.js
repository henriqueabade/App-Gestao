/**
 * O que o "'" das mensagens cita (backend/contabilidade/citaveis.js):
 * a ordem dos tipos, o que só aparece buscando, a busca sem acento e com
 * várias palavras, os ids que levam o que a tela precisa para abrir, e o
 * recorte do contato (o "'" da ficha em Contatos).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const citaveis = require('./citaveis');

const plano = v => JSON.parse(JSON.stringify(v));

const DADOS = {
  competencia: '2026-08',
  hoje: '2026-09-29',
  competencias: [{ competencia: '2026-07', status: 'fechada' }, { competencia: '2025-12', status: 'reaberta' }],
  documentos: [
    { id: 7, tipo: 'nfe', serie: '1', numero: '123', emitente_nome: 'Madeireira São José', contato_id: 50, data_emissao: '2026-08-10', valor_total: 1500, competencia: '2026-08', chave_acesso: '3126' },
    { id: 8, tipo: 'nfse', numero: '45', emitente_nome: 'Contabilidade Silva', contato_id: 51, data_emissao: '2026-08-20', valor_total: 900, competencia: '2026-08' },
    { id: 9, tipo: 'outro', especie: 'recibo', numero: '1', emitente_nome: 'Apagado', excluido_em: '2026-08-21T10:00:00Z' }
  ],
  titulos: [
    { id: 12, descricao: 'Aluguel do galpão', contato_id: 50, valor_total: 3000, competencia: '2026-08', status: 'aberto', data_emissao: '2026-08-01' },
    { id: 13, descricao: 'Cancelada', contato_id: 50, valor_total: 10, competencia: '2026-08', status: 'cancelado' }
  ],
  movimentos: [{ id: 30, conta_id: 1, data: '2026-08-11', descricao: 'PIX ENVIADO MADEIREIRA', valor: -1500, competencia: '2026-08' }],
  arquivos: [
    { id: 40, nome_arquivo: 'nota-123.xml', categoria: 'xml_nfe', competencia: '2026-08', criado_em: '2026-08-10T10:00:00Z' },
    { id: 41, nome_arquivo: 'recibo-aluguel.pdf', categoria: 'recibo', competencia: '2026-08', criado_em: '2026-08-02T10:00:00Z' },
    { id: 42, nome_arquivo: 'solto.pdf', categoria: 'outro', competencia: '2026-08', criado_em: '2026-08-03T10:00:00Z' },
    { id: 43, nome_arquivo: 'excluido.pdf', categoria: 'outro', excluido_em: '2026-08-04T10:00:00Z' }
  ],
  vinculos: [{ arquivo_id: 40, alvo_tipo: 'documento_recebido', alvo_id: '7' }, { arquivo_id: 41, alvo_tipo: 'titulo', alvo_id: '12' }, { arquivo_id: 42, alvo_tipo: 'competencia', alvo_id: '2026-08' }],
  fechamentos: [{ id: 1, competencia: '2026-07', versao: 2, fechada_em: '2026-08-05T10:00:00Z' }],
  pacotes: [{ id: 3, competencia: '2026-07', versao: 1, nome_arquivo: 'Contabilidade-2026-07-v1', gerado_em: '2026-08-06T10:00:00Z', enviado_em: null }],
  importacoes: [{ id: 5, conta_id: 1, nome_arquivo: 'extrato-agosto.ofx', periodo_inicio: '2026-08-01', periodo_fim: '2026-08-31', criado_em: '2026-09-01T10:00:00Z' }],
  contasFinanceiras: [{ id: 1, nome: 'Banco do Brasil', agencia: '1234', conta: '5678-9', ativa: true }],
  plano: [{ id: 2, codigo: '3.1', nome: 'Aquisição de Bens', tipo: 'despesa', ativa: true }],
  contatos: [{ id: 50, nome: 'Madeireira São José', cnpj: '12345678000199' }, { id: 51, nome: 'Contabilidade Silva' }, { id: 52, nome: 'Sem ligação' }]
};

test('sem busca: a competência da tela, as recentes, e os documentos, contas, arquivos, fechamento e pacote; o resto só buscando', () => {
  const itens = plano(citaveis.montar({ ...DADOS, busca: '' }));
  const tipos = [...new Set(itens.map(i => i.tipo))];
  assert.deepEqual(tipos, ['competencia', 'documento', 'titulo', 'arquivo', 'fechamento', 'pacote']);
  const comps = itens.filter(i => i.tipo === 'competencia');
  assert.equal(comps.length, 3, 'no máximo 3 competências sem busca');
  assert.deepEqual(comps[0], { tipo: 'competencia', id: '2026-08', rotulo: 'Competência 08/2026', detalhe: 'Aberta' }, 'a da tela primeiro');
  assert.deepEqual(comps.slice(1).map(c => c.id), ['2026-09', '2026-07']);
  assert.equal(comps[2].detalhe, 'Fechada');
  // Excluído e cancelado ficam de fora; o documento traz número e emitente, o id é o da linha.
  assert.deepEqual(itens.filter(i => i.tipo === 'documento').map(i => [i.id, i.rotulo]), [['8', 'NFS-e 45 · Contabilidade Silva'], ['7', 'NF-e 1/123 · Madeireira São José']]);
  assert.deepEqual(itens.filter(i => i.tipo === 'titulo').map(i => i.id), ['12']);
  assert.match(itens.find(i => i.tipo === 'titulo').detalhe, /^Madeireira São José · R\$\s3\.000,00 · 08\/2026$/);
  assert.deepEqual(itens.filter(i => i.tipo === 'arquivo').map(i => i.id), ['40', '42', '41']);
  // O id leva o que a tela precisa para abrir.
  assert.equal(itens.find(i => i.tipo === 'fechamento').id, '2026-07:v2');
  assert.equal(itens.find(i => i.tipo === 'pacote').id, '2026-07:3');
  assert.equal(itens.find(i => i.tipo === 'pacote').detalhe, 'Gerado, falta marcar o envio');
});

test('buscando: sem acento, todas as palavras, e os tipos que só aparecem com busca', () => {
  const ids = busca => plano(citaveis.montar({ ...DADOS, busca })).map(i => `${i.tipo}:${i.id}`);
  assert.deepEqual(ids('madeireira'), ['documento:7', 'titulo:12', 'movimento:30', 'fornecedor:50'], 'o fornecedor e o lançamento aparecem buscando');
  assert.deepEqual(ids('madeireira sao'), ['documento:7', 'titulo:12', 'fornecedor:50'], 'todas as palavras, sem acento (o lançamento não tem "são")');
  assert.deepEqual(ids('julho'), ['competencia:2026-07', 'fechamento:2026-07:v2', 'pacote:2026-07:3'], 'o nome do mês também serve');
  assert.deepEqual(ids('extrato agosto'), ['importacao:1:2026-08:5']);
  assert.deepEqual(ids('banco do brasil'), ['movimento:30', 'importacao:1:2026-08:5', 'conta_financeira:1']);
  assert.deepEqual(ids('aquisicao'), ['conta_plano:2']);
  assert.deepEqual(ids('nada que exista'), []);
});

test('do contato: só os documentos e as contas dele e os arquivos ligados a eles; nada de competência nem fornecedor', () => {
  const itens = plano(citaveis.montar({ ...DADOS, busca: '', contatoId: 50 }));
  assert.deepEqual(itens.map(i => `${i.tipo}:${i.id}`), ['documento:7', 'titulo:12', 'arquivo:40', 'arquivo:41']);
  assert.deepEqual(plano(citaveis.montar({ ...DADOS, busca: 'aluguel', contatoId: 50 })).map(i => `${i.tipo}:${i.id}`), ['titulo:12', 'arquivo:41']);
  assert.deepEqual(plano(citaveis.montar({ ...DADOS, busca: '', contatoId: 52 })), []);
});

test('tabela ausente (null) só tira aquele tipo; limites por tipo e no total', () => {
  const semPagar = plano(citaveis.montar({ ...DADOS, documentos: null, titulos: null, arquivos: null }));
  assert.deepEqual([...new Set(semPagar.map(i => i.tipo))], ['competencia', 'fechamento', 'pacote']);
  const muitos = Array.from({ length: 20 }, (_, i) => ({ id: 100 + i, tipo: 'nfe', numero: String(i), emitente_nome: 'X', data_emissao: `2026-08-${String(i + 1).padStart(2, '0')}` }));
  const itens = plano(citaveis.montar({ ...DADOS, documentos: muitos, busca: 'x' }));
  assert.equal(itens.filter(i => i.tipo === 'documento').length, citaveis.POR_TIPO);
  assert.ok(itens.length <= citaveis.TOTAL);
});

test('carregar: lê as tabelas pela API e o lançamento só na competência da tela, e só buscando', async () => {
  const pedidos = [];
  const api = {
    get: async (caminho, opcoes = {}) => {
      pedidos.push(`${caminho}${opcoes.query ? `?${new URLSearchParams(opcoes.query)}` : ''}`);
      const tabela = caminho.replace('/api/', '');
      const mapa = { documentos_recebidos: DADOS.documentos, titulos_pagar: DADOS.titulos, contabil_arquivos: DADOS.arquivos, contatos: DADOS.contatos, movimentos_bancarios: DADOS.movimentos, contas_financeiras: DADOS.contasFinanceiras };
      if (tabela === 'competencia_fechamentos') throw Object.assign(new Error("Tabela 'competencia_fechamentos' não encontrada."), { status: 404 });
      return mapa[tabela] || [];
    }
  };
  const sem = await citaveis.carregar({ api, busca: '', competencia: '2026-08', hoje: '2026-09-29' });
  assert.ok(!pedidos.some(p => p.startsWith('/api/movimentos_bancarios')), 'sem busca não lê o extrato');
  assert.ok(sem.itens.some(i => i.tipo === 'documento'));
  assert.ok(!sem.itens.some(i => i.tipo === 'fechamento'), 'sem a tabela do fechamento, sem fechamento — e sem erro');
  pedidos.length = 0;
  const com = await citaveis.carregar({ api, busca: 'pix', competencia: '2026-08', hoje: '2026-09-29' });
  assert.ok(pedidos.includes('/api/movimentos_bancarios?competencia=2026-08'));
  assert.deepEqual(com.itens.map(i => `${i.tipo}:${i.id}`), ['movimento:30']);
});
