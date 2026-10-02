/**
 * Avisar no sino quem recebeu a comissão ou a produção paga (decisão do
 * dono, 02/10/2026): quem paga escolhe o usuário de cada pessoa (a tela
 * sugere o de mesmo nome); o valor sai dos pagamentos gravados.
 */
const test = require('node:test');
const assert = require('node:assert');

const A = require('./avisoDoPagamento');
// O R$ do Intl vem com espaço que não quebra linha: os textos comparam sem ele.
const sem = t => (Array.isArray(t) ? t.map(sem) : String(t).replace(/\u00a0/g, ' '));

const RESUMO = [
  { tipo: 'cms', beneficiario: 'Ana Paula', valor: 1000 },
  { tipo: 'royalty', beneficiario: 'Ana Paula', valor: 234.56 },
  { tipo: 'cms', beneficiario: 'Bruno Costa', valor: 500 },
  { tipo: 'royalty', beneficiario: 'Zé Desenhista', valor: 300 }
];

test('recebedores: "pagar tudo" cobre só o que ainda não estava pago; cada pessoa junta CMS e Royalty', () => {
  const antes = { id: 1, beneficiario: 'Bruno Costa', tipo_comissao: 'cms' };
  const tudo = { id: 2, beneficiario: null, tipo_comissao: null };
  const r = A.recebedoresDoLote({ tipo: 'comissao', resumo: RESUMO, pagamentos: [antes, tudo], lote: [tudo] });
  assert.deepStrictEqual(r.map(p => [p.beneficiario, p.total]), [['Ana Paula', 1234.56], ['Zé Desenhista', 300]], 'o Bruno já tinha sido pago antes');
  assert.deepStrictEqual(r[0].linhas.map(l => l.tipo), ['cms', 'royalty']);
});

test('recebedores: por pessoa, um pagamento por linha no mesmo lote vira UMA pessoa com as duas linhas', () => {
  const cms = { id: 5, beneficiario: 'Ana Paula', tipo_comissao: 'cms' };
  const roy = { id: 6, beneficiario: 'ana paula', tipo_comissao: 'royalty' };
  const r = A.recebedoresDoLote({ tipo: 'comissao', resumo: RESUMO, pagamentos: [cms, roy], lote: [cms, roy] });
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].total, 1234.56);
  assert.deepStrictEqual(A.recebedoresDoLote({ tipo: 'comissao', resumo: RESUMO, pagamentos: [cms], lote: [] }), [], 'lote vazio: ninguém');
});

test('recebedores da produção: os colaboradores do rateio, com a parte de cada um', () => {
  const rateio = [{ colaborador: 'Carlos Marceneiro', valor: 800 }, { colaborador: 'Dora', valor: 0 }];
  const r = A.recebedoresDoLote({ tipo: 'producao', lote: [{ id: 9 }], rateio });
  assert.deepStrictEqual(r.map(p => [p.beneficiario, p.total]), [['Carlos Marceneiro', 800]]);
});

test('avisos: "sua comissão" para a própria pessoa; o nome de quem recebeu quando quem paga escolheu outro usuário; ninguém = sem aviso', () => {
  const nomes = new Map([[1, 'Henrique'], [2, 'Ana Paula'], [3, 'Bruno Costa']]);
  const recebedores = A.recebedoresDoLote({ tipo: 'comissao', resumo: RESUMO, pagamentos: [{ id: 2 }], lote: [{ id: 2 }] });
  const avisos = A.montarAvisosDoPagamento({
    tipo: 'comissao', competencia: '2026-09', recebedores, nomes, data: '2026-10-02', forma: 'Pix',
    escolhas: [
      { beneficiario: 'ana paula', usuario_id: 2 },
      { beneficiario: 'Zé Desenhista', usuario_id: 3 }, // o Zé não usa o sistema: avisa o Bruno
      { beneficiario: 'Bruno Costa', usuario_id: '' },
      { beneficiario: 'Alguém de fora', usuario_id: 3 },
      { beneficiario: 'Zé Desenhista', usuario_id: 99 } // usuário que não existe
    ]
  });
  assert.strictEqual(avisos.length, 2);
  const daAna = avisos.find(a => a.usuario === 2);
  assert.strictEqual(daAna.titulo, 'Comissão paga');
  assert.strictEqual(sem(daAna.frase('Henrique')), 'Henrique confirmou o pagamento da sua comissão de setembro/2026: R$ 1.234,56 (Pix, 02/10/2026).');
  assert.deepStrictEqual(sem(daAna.mudancas), ['CMS: R$ 1.000,00', 'Royalty: R$ 234,56']);
  const doBruno = avisos.find(a => a.usuario === 3);
  assert.match(sem(doBruno.frase('Henrique')), /^Henrique confirmou o pagamento de comissão de setembro\/2026: R\$ 300,00/);
  assert.deepStrictEqual(sem(doBruno.mudancas), ['Zé Desenhista — Royalty: R$ 300,00']);

  const prod = A.montarAvisosDoPagamento({
    tipo: 'producao', competencia: '2026-09', nomes: new Map([[4, 'Carlos Marceneiro']]), data: '2026-10-02', forma: 'Transferência',
    recebedores: [{ beneficiario: 'Carlos Marceneiro', linhas: [{ tipo: null, valor: 800 }], total: 800 }],
    escolhas: [{ beneficiario: 'Carlos Marceneiro', usuario_id: 4 }]
  });
  assert.strictEqual(prod[0].titulo, 'Produção paga');
  assert.strictEqual(sem(prod[0].frase('Ana')), 'Ana confirmou o pagamento da sua produção de setembro/2026: R$ 800,00 (Transferência, 02/10/2026).');
  assert.deepStrictEqual(prod[0].mudancas, []);
});

/** Uma API genérica de mentira com o fechamento, os pagamentos e os usuários. */
function apiFalsa({ pagamentos, criadoEm }) {
  const notificacoes = [];
  return {
    notificacoes,
    async get(caminho) {
      if (caminho === '/api/financeiro_fechamentos') return [{ id: 70, tipo: 'comissao', competencia: '2026-09', status: 'fechado', total: 2034.56, por_setor: JSON.stringify(RESUMO) }];
      if (caminho === '/api/financeiro_fechamento_itens') return [];
      if (caminho === '/api/financeiro_pagamentos') return pagamentos.map(p => ({ fechamento_id: 70, competencia: '2026-09', data_pagamento: '2026-10-02', forma: 'Pix', criado_por: 1, criado_em: criadoEm, ...p }));
      if (caminho === '/api/usuarios') return [{ id: 1, nome: 'Henrique' }, { id: 2, nome: 'Ana Paula' }, { id: 3, nome: 'Bruno Costa' }];
      return [];
    },
    async post(caminho, corpo) { if (caminho === '/api/notificacoes') notificacoes.push(corpo); return { id: notificacoes.length }; }
  };
}

test('avisar (rota): só os pagamentos que esta pessoa acabou de gravar; um aviso por usuário escolhido; quem pagou não se avisa', async () => {
  const agora = Date.parse('2026-10-02T15:00:00Z');
  const api = apiFalsa({ pagamentos: [{ id: 5, beneficiario: 'Ana Paula', tipo_comissao: 'cms' }, { id: 6, beneficiario: 'Ana Paula', tipo_comissao: 'royalty' }], criadoEm: '2026-10-02T14:55:00Z' });
  const r = await A.avisar({
    api, usuarioId: 1, agora,
    entrada: { tipo: 'comissao', competencia: '2026-09', pagamento_ids: [5, 6], avisar: [{ beneficiario: 'Ana Paula', usuario_id: 2 }, { beneficiario: 'Ana Paula', usuario_id: 1 }] }
  });
  assert.deepStrictEqual(r, { avisados: 1 }, 'o Henrique (quem pagou) não recebe o próprio aviso');
  assert.strictEqual(api.notificacoes.length, 1);
  const aviso = api.notificacoes[0];
  assert.deepStrictEqual([aviso.usuario_id, aviso.tipo, aviso.titulo, aviso.origem, aviso.registro_id], [2, 'pagamento_feito', 'Comissão paga', 'financeiro', 70]);
  assert.match(sem(aviso.mensagem), /^Henrique confirmou o pagamento da sua comissão de setembro\/2026: R\$ 1\.234,56 \(Pix, 02\/10\/2026\)\.\n• CMS: R\$ 1\.000,00\n• Royalty: R\$ 234,56$/);

  // Pagamento antigo (mais de meia hora) não se reavisa.
  const velho = apiFalsa({ pagamentos: [{ id: 5, beneficiario: 'Ana Paula', tipo_comissao: 'cms' }], criadoEm: '2026-10-02T13:00:00Z' });
  await assert.rejects(A.avisar({ api: velho, usuarioId: 1, agora, entrada: { tipo: 'comissao', competencia: '2026-09', pagamento_ids: [5], avisar: [{ beneficiario: 'Ana Paula', usuario_id: 2 }] } }),
    /Não há pagamento recente/);
  // Nada escolhido: nada a fazer, sem erro.
  assert.deepStrictEqual(await A.avisar({ api, usuarioId: 1, agora, entrada: { tipo: 'comissao', competencia: '2026-09', pagamento_ids: [5], avisar: [{ beneficiario: 'Ana Paula', usuario_id: '' }] } }), { avisados: 0 });
});
