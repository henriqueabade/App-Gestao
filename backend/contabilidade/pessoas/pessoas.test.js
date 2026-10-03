/**
 * Fase E (02/10/2026) — quem recebe CMS, Royalty e produção, e a nota dela:
 * as partes puras.
 *
 * O que fica preso:
 *   - as partes de cada fechamento (as linhas do resumo das comissões; a
 *     produção inteira) e o pagamento que cobre cada uma (sem pessoa e sem
 *     tipo cobre todos — as regras do Financeiro);
 *   - as opções de uma nota: a linha de mesmo valor, a SOMA de CMS + Royalty
 *     da pessoa (5.2 a), os 6 meses para trás, a linha que já tem nota não
 *     volta; automático só com UMA opção de valor exato; a produção só para
 *     quem não recebe comissão;
 *   - quanto de cada pagamento as notas documentam (o "sem NFS-e" do painel);
 *   - as pendências: quem recebe sem o CPF/CNPJ e a nota que não achou a
 *     parte — avisos.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const p = require('./pessoas');

const fech = (id, competencia, resumo, extra = {}) => ({ id, tipo: 'comissao', competencia, status: 'fechado', total: resumo.reduce((s, l) => s + l.valor, 0), pagar_ate: `${competencia}-28`, por_setor: JSON.stringify(resumo), ...extra });
const SET = fech(1, '2026-09', [
  { tipo: 'cms', beneficiario: 'Márcia Lamounier', valor: 554.4 }, { tipo: 'royalty', beneficiario: 'Marcia Lamounier', valor: 300 },
  { tipo: 'royalty', beneficiario: 'Barral & Lamounier', valor: 277.2 }
]);
const AGO = fech(2, '2026-08', [{ tipo: 'cms', beneficiario: 'Marcia Lamounier', valor: 554.4 }]);
const PROD = { id: 3, tipo: 'producao', competencia: '2026-09', status: 'fechado', total: 2800, pagar_ate: '2026-10-07', por_setor: '[]' };
const nota = (valor, data = '2026-10-03', extra = {}) => ({ id: 50, tipo: 'nfse', numero: '17', data_emissao: data, valor_total: valor, ...extra });

test('as partes do fechamento e o pagamento que cobre cada uma', () => {
  assert.deepEqual(p.linhasDoFechamento(SET).map(l => [l.chave, l.tipo_comissao, l.valor]), [['marcia lamounier', 'cms', 554.4], ['marcia lamounier', 'royalty', 300], ['barral & lamounier', 'royalty', 277.2]]);
  assert.deepEqual(p.linhasDoFechamento(PROD).map(l => [l.tipo, l.beneficiario, l.valor]), [['producao', null, 2800]]);
  assert.deepEqual(p.linhasDoFechamento({ ...SET, status: 'fechando' }), []);
  const [cms, roy] = p.linhasDoFechamento(SET);
  assert.equal(p.cobre({ fechamento_id: 1, beneficiario: null, tipo_comissao: null }, cms), true, 'o pagamento de tudo cobre todos');
  assert.equal(p.cobre({ fechamento_id: 1, beneficiario: 'MARCIA LAMOUNIER', tipo_comissao: 'cms' }, cms), true);
  assert.equal(p.cobre({ fechamento_id: 1, beneficiario: 'Marcia Lamounier', tipo_comissao: 'cms' }, roy), false);
  assert.equal(p.cobre({ fechamento_id: 2, beneficiario: null }, cms), false);
  assert.equal(p.rotuloDaParte({ tipo: 'comissao', competencia: '2026-09', beneficiario: 'Marcia', tipos_comissao: ['cms', 'royalty'] }), 'CMS + Royalty de setembro/2026 — Marcia');
});

test('as opções da nota: a linha, a soma de CMS + Royalty (5.2 a), os meses, a linha que já tem nota; automático só com uma de valor exato; a produção só para quem não recebe comissão', () => {
  const fechamentos = [SET, AGO, PROD];
  // A soma de CMS + Royalty da Marcia em setembro.
  const soma = p.opcoesDaNota(nota(854.4), { chaves: ['Marcia Lamounier'], fechamentos });
  assert.deepEqual([soma.automatico.rotulo, soma.automatico.linhas.length, soma.automatico.valor], ['CMS + Royalty de setembro/2026 — Márcia Lamounier', 2, 854.4]);
  assert.equal(soma.opcoes.some(o => o.tipo === 'producao'), false, 'quem recebe comissão não é a produção');
  // 554,40: o CMS de setembro e o de agosto — dúvida, nada sozinho.
  const duvida = p.opcoesDaNota(nota(554.4), { chaves: ['Marcia Lamounier'], fechamentos });
  assert.deepEqual([duvida.automatico, duvida.opcoes.filter(o => o.exato).map(o => o.competencia)], [null, ['2026-09', '2026-08']]);
  // A de setembro já tem nota: a de agosto é a única.
  const links = [{ fechamento_id: 1, beneficiario: 'Marcia Lamounier', tipo_comissao: 'cms', valor: 554.4, tipo: 'comissao' }];
  assert.equal(p.opcoesDaNota(nota(554.4), { chaves: ['Marcia Lamounier'], fechamentos, links }).automatico.competencia, '2026-08');
  // Nota emitida em julho não vê os fechamentos de agosto e setembro; nem 7 meses depois.
  assert.equal(p.opcoesDaNota(nota(554.4, '2026-07-20'), { chaves: ['Marcia Lamounier'], fechamentos }).opcoes.length, 0);
  assert.equal(p.opcoesDaNota(nota(554.4, '2027-04-02'), { chaves: ['Marcia Lamounier'], fechamentos: [AGO] }).opcoes.length, 0);
  // A produção inteira para quem só faz produção (o Bruno, MEI).
  const bruno = p.opcoesDaNota(nota(2800), { chaves: ['Bruno Vigato'], fechamentos });
  assert.deepEqual([bruno.automatico.tipo, bruno.automatico.rotulo], ['producao', 'Produção de setembro/2026']);
  // Valor que não bate com nada: opções, nenhuma automática.
  const errada = p.opcoesDaNota(nota(900), { chaves: ['Marcia Lamounier'], fechamentos });
  assert.deepEqual([errada.automatico, errada.opcoes.length > 0], [null, true]);
  // O valor líquido (ISS retido) também vale quando passado.
  assert.ok(p.opcoesDaNota(nota(900), { chaves: ['Barral & Lamounier'], fechamentos, valores: [90000, 27720] }).automatico);
});

test('quanto de cada pagamento as notas documentam, e os documentos ligados', () => {
  const links = [
    { documento_id: 50, fechamento_id: 1, tipo: 'comissao', beneficiario: 'Marcia Lamounier', tipo_comissao: 'cms', valor: 554.4 },
    { documento_id: 50, fechamento_id: 1, tipo: 'comissao', beneficiario: 'Marcia Lamounier', tipo_comissao: 'royalty', valor: 300 },
    { documento_id: 51, fechamento_id: 1, tipo: 'comissao', beneficiario: 'Barral & Lamounier', tipo_comissao: 'royalty', valor: 277.2, desfeito_em: '2026-10-04T00:00:00Z' }
  ];
  const pagamentos = [{ id: 70, fechamento_id: 1, beneficiario: 'Marcia Lamounier', tipo_comissao: null }, { id: 71, fechamento_id: 1, beneficiario: 'Barral & Lamounier', tipo_comissao: 'royalty' }];
  assert.deepEqual([...p.coberturaDosPagamentos({ links, pagamentos })], [['70', 854.4]]);
  assert.deepEqual([...p.documentosNoFechamento(links)], ['50']);
});

test('as pendências: quem recebe sem o CPF/CNPJ e a nota que não achou a parte — avisos', () => {
  const dados = {
    fechamentos: [SET], contatoDaChave: new Map([['marcia lamounier', { id: 7, nome: 'Márcia', cpf: '52998224725' }]]),
    notasParaConferir: [{ id: 60, pessoa: 'Marcia Lamounier', valor_total: 900, data_emissao: '2026-09-30', opcoes: 3 }]
  };
  const r = p.pendencias({ competencia: '2026-09', dados });
  assert.deepEqual(r.map(x => [x.nivel, x.chave, x.titulo.replace(/ /g, ' ')]), [
    ['aviso', 'pessoas_sem_cadastro', '1 pessoa que recebe sem o CPF/CNPJ'],
    ['aviso', 'nota_pessoa_conferir_60', 'A nota de Marcia Lamounier (R$ 900,00) não achou a parte dela no fechamento']
  ]);
  assert.match(r[0].descricao, /^Barral & Lamounier · ligue cada nome/);
  assert.deepEqual(r[0].filtro, { acao: 'pessoas' });
  assert.deepEqual(p.pendencias({ competencia: '2026-09', dados: null }), []);
});
