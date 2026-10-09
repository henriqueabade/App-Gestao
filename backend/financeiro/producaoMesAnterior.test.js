/**
 * Trava do fechamento da produção (08/10/2026): setembro/2026 é o primeiro
 * mês; dele em diante, as peças de um mês só são confirmadas depois que o mês
 * anterior foi fechado — e a competência também só fecha nessa ordem.
 */
const test = require('node:test');
const assert = require('node:assert');
const confirmacao = require('./producaoConfirmacao');
const fechamentos = require('./fechamentos');

const apiCom = linhas => ({ get: async () => linhas });

test('setembro/2026 é o primeiro mês: confirma sem olhar o anterior', async () => {
  await confirmacao.exigirMesAnteriorFechado(apiCom([]), '2026-09');
});

test('outubro só confirma peças com a produção de setembro fechada', async () => {
  await assert.rejects(
    confirmacao.exigirMesAnteriorFechado(apiCom([]), '2026-10'),
    e => e.status === 409 && /Feche antes a produção de setembro\/2026/.test(e.message)
  );
  // "fechando" (tentativa em andamento) não conta como fechado.
  await assert.rejects(
    confirmacao.exigirMesAnteriorFechado(apiCom([{ tipo: 'producao', competencia: '2026-09', status: 'fechando' }]), '2026-10'),
    e => e.status === 409
  );
  // Fechamento de COMISSÕES de setembro não libera a produção.
  await assert.rejects(
    confirmacao.exigirMesAnteriorFechado(apiCom([{ tipo: 'comissao', competencia: '2026-09', status: 'fechado' }]), '2026-10'),
    e => e.status === 409
  );
  await confirmacao.exigirMesAnteriorFechado(apiCom([{ tipo: 'producao', competencia: '2026-09', status: 'fechado' }]), '2026-10');
});

test('antes de setembro/2026 não há produção a confirmar', async () => {
  await assert.rejects(
    confirmacao.exigirMesAnteriorFechado(apiCom([]), '2026-08'),
    e => e.status === 409 && /começa em setembro\/2026/.test(e.message)
  );
});

test('a confirmação do fechamento pede o mês anterior fechado; a do envio não', async () => {
  const api = apiCom([]);
  await assert.rejects(
    confirmacao.confirmar({ api, competencia: '2026-10', pedidoId: 1, decisoes: [], origem: 'fechamento', hoje: '2026-10-08' }),
    e => e.status === 409 && /setembro\/2026/.test(e.message)
  );
});

test('o recusado vem com o código que a tela usa para abrir a caixa', async () => {
  await assert.rejects(
    confirmacao.exigirMesAnteriorFechado(apiCom([]), '2026-10'),
    e => e.extra?.codigo === 'MES_ANTERIOR_ABERTO' && e.extra?.mes_anterior === '2026-09'
  );
});

test('tela: a frase da trava sai limpa — do backend ou do meio do erro do banco — e vai para a caixa padrão', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const fonte = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'js', 'modals', 'financeiro-modais.js'), 'utf8');
  const inicio = fonte.indexOf('function fraseDoMesAnterior(');
  const fim = fonte.indexOf('/** Mostra a trava na caixa padrão.', inicio);
  assert.ok(inicio !== -1 && fim > inicio, 'sem fraseDoMesAnterior');
  const fraseDoMesAnterior = vm.runInNewContext(`${fonte.slice(inicio, fim)}\nfraseDoMesAnterior`);

  const doBanco = 'Falha na requisição POST /api/producao_confirmacoes: 500 — Erro no INSERT: Feche antes a produção de setembro/2026: as peças de outubro/2026 só são confirmadas depois que setembro/2026 estiver fechado.';
  assert.strictEqual(fraseDoMesAnterior(doBanco),
    'Feche antes a produção de setembro/2026: as peças de outubro/2026 só são confirmadas depois que setembro/2026 estiver fechado.');
  assert.strictEqual(fraseDoMesAnterior('Outro erro qualquer.'), null);
  assert.strictEqual(fraseDoMesAnterior(undefined), null);

  // A caixa é a padrão (DialogPadrao), na confirmação e no "Fechar competência".
  assert.match(fonte, /title: 'Mês anterior em aberto', tom: 'aviso', icone: 'fa-lock'/);
  // A releitura depois da trava é silenciosa e mantém a peça no lugar (08/10/2026).
  assert.match(fonte, /if \(await avisarMesAnteriorAberto\(e\)\) \{ aviso\(''\); await carregar\([^)]*\); return; \}/);
  assert.match(fonte, /if \(doMesAnterior && await avisarMesAnteriorAberto\(doMesAnterior\)\) return;/);
});

test('"Tudo"/"Nada" nunca sobrescrevem o que já foi decidido (tela e backend)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const tela = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'js', 'modals', 'financeiro-modais.js'), 'utf8');
  const inicio = tela.indexOf('function semDecisaoNoPedido(');
  const fim = tela.indexOf('function resumoDoQueFalta(', inicio);
  assert.ok(inicio !== -1 && fim > inicio, 'sem semDecisaoNoPedido');
  const semDecisaoNoPedido = vm.runInNewContext(`const limite = p => p.disponivel;\n${tela.slice(inicio, fim)}\nsemDecisaoNoPedido`);

  // O caso do PED108: a Marcenaria já tinha 0,8 confirmada; o resto, nada.
  const pedido = {
    pecas: [
      { pedido_item_id: 92, processos: [
        { etapa_id: 1, disponivel: 1, decidido: { prontas: 0.8 } },
        { etapa_id: 3, disponivel: 1, decidido: null }
      ] },
      { pedido_item_id: 81, processos: [{ etapa_id: 1, disponivel: 1, decidido: null }, { etapa_id: 2, disponivel: 0, decidido: null }] }
    ]
  };
  const alvo = semDecisaoNoPedido(pedido).map(({ peca, processo }) => `${peca.pedido_item_id}:${processo.etapa_id}`).join(',');
  assert.strictEqual(alvo, '92:3,81:1', 'a Marcenaria decidida fica de fora');

  // Os dois botões do pedido usam só o que falta e avisam o backend.
  assert.strictEqual((tela.match(/const alvo = semDecisaoNoPedido\(pedido\);/g) || []).length, 2);
  // (com a âncora que deixa a tela parada depois de confirmar, 08/10/2026)
  assert.strictEqual((tela.match(/\{ somente_pendentes: true \}(?:, \{ ancora \})?\);/g) || []).length, 2);
  // O "Tudo"/"Nada" da peça pula o processo já decidido.
  assert.match(tela, /if \(!processo\.saldo \|\| processo\.decidido\) continue;/);

  // Backend: com somente_pendentes, a decisão já tomada fica (até numa tela velha).
  const back = fs.readFileSync(path.join(__dirname, 'producaoConfirmacao.js'), 'utf8');
  // (09/10/2026: a decisão SELADA — de antes de uma troca/avulsa — não conta como tomada.)
  assert.match(back, /if \(somentePendentes && \(processo \? processo\.decidido : decisaoPor\.has\(chave\(d\.pedido_item_id, d\.etapa_id\)\)\)\) continue;/);
  const rota = fs.readFileSync(path.join(__dirname, '..', 'financeiroController.js'), 'utf8');
  assert.match(rota, /somentePendentes: req\.body\?\.somente_pendentes === true/);
});

test('sem nenhum fechamento ainda, só setembro/2026 fecha', () => {
  const estado = { fechados: new Map(), proxima: null, ultimo: null };
  const outubro = fechamentos.conferir({ tipo: 'producao', competencia: '2026-10', estado, hoje: '2026-10-08' });
  assert.ok(outubro.bloqueios.some(b => /Feche antes a produção de setembro\/2026/.test(b)));
  const setembro = fechamentos.conferir({ tipo: 'producao', competencia: '2026-09', estado, hoje: '2026-10-08' });
  assert.ok(!setembro.bloqueios.some(b => /Feche antes/.test(b)));
  // Comissões seguem a regra de antes.
  const comissoes = fechamentos.conferir({ tipo: 'comissao', competencia: '2026-10', estado, hoje: '2026-10-08' });
  assert.ok(!comissoes.bloqueios.some(b => /Feche antes a produção/.test(b)));
});
