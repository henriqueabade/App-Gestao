/**
 * Modal "Datas do pedido" (src/js/modals/pedido-datas.js + datas.html).
 *
 * Três camadas:
 *  - as funções puras (máscara, leitura de dd/mm/aaaa, soma de calendário,
 *    início por regra, vencimentos), recortadas do arquivo REAL — se forem
 *    renomeadas ou removidas, o teste falha em vez de exercitar uma cópia;
 *  - o markup: ids, rádios, botão de calendário, campo nativo escondido sem
 *    display:none, guarda de permissão só no Salvar;
 *  - o modal rodando num DOM de mentira (./apoio/domMinimo.js): a conversão
 *    devolve por evento, o pedido grava pela API, o Esc não vaza para os
 *    modais de baixo.
 *
 * O fuso fica fixo em São Paulo: é nele que um 'YYYY-MM-DD' lido por
 * `new Date()` recua um dia, e é isso que os testes de data vigiam.
 */
process.env.TZ = 'America/Sao_Paulo';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { criarAmbiente, esperarTarefas } = require('./apoio/domMinimo');

const RAIZ = path.join(__dirname, '..', '..');
const FONTE = fs.readFileSync(path.join(RAIZ, 'js', 'modals', 'pedido-datas.js'), 'utf8');
const HTML = fs.readFileSync(path.join(RAIZ, 'html', 'modals', 'pedidos', 'datas.html'), 'utf8');

/** Objetos do contexto do `vm` têm outro protótipo; compara-se o conteúdo. */
const simples = valor => JSON.parse(JSON.stringify(valor));

function carregarFuncoesPuras() {
  const inicio = FONTE.indexOf('const REGRAS_FATURAMENTO');
  const fim = FONTE.indexOf('// fim das funções puras');
  assert.ok(inicio !== -1 && fim > inicio, 'o bloco de funções puras não foi encontrado');
  // eslint-disable-next-line no-new-func
  return new Function(`${FONTE.slice(inicio, fim)}
    return { REGRAS_FATURAMENTO, mascararData, diaExiste, lerDataDigitada, diaDeColunaDate,
      textoDoDia, somarDias, diferencaEmDias, prazosValidos, resolverInicio, regraInicial,
      vencimentosDe, rotuloVencimento, textoDaPrevia, corpoDasDatas, datasDaResposta,
      mensagemDeErro };`)();
}

const F = carregarFuncoesPuras();

// ============================================================ funções puras

test('o ambiente do teste está mesmo em São Paulo', () => {
  // Sem isto os testes de "não recua um dia" passariam por acaso, num
  // relógio em UTC.
  assert.equal(new Date('2026-08-10T00:00:00.000Z').getDate(), 9);
});

test('máscara: só dígitos, barras conforme se digita, no máximo 8 dígitos', () => {
  const casos = [
    ['', ''],
    ['1', '1'],
    ['10', '10'],
    ['100', '10/0'],
    ['1008', '10/08'],
    ['10082', '10/08/2'],
    ['10082026', '10/08/2026'],
    ['100820269', '10/08/2026'],
    ['ab10-08x2026', '10/08/2026'],
    ['10/08/2026', '10/08/2026']
  ];
  for (const [digitado, esperado] of casos) {
    assert.equal(F.mascararData(digitado), esperado, `falhou para ${JSON.stringify(digitado)}`);
  }
});

test('máscara: colar uma data ISO vira dd/mm/aaaa, e não 20/26/0810', () => {
  assert.equal(F.mascararData('2026-08-10'), '10/08/2026');
  assert.equal(F.mascararData('2026-08-10T00:00:00.000Z'), '10/08/2026');
});

test('leitura: data real vira ISO; o resto diz por que não', () => {
  assert.deepEqual(F.lerDataDigitada('10/08/2026'), { iso: '2026-08-10', erro: null });
  assert.deepEqual(F.lerDataDigitada('10082026'), { iso: '2026-08-10', erro: null });
  assert.deepEqual(F.lerDataDigitada(''), { iso: null, erro: 'vazia' });
  assert.deepEqual(F.lerDataDigitada('  / /  '), { iso: null, erro: 'vazia' });
  assert.deepEqual(F.lerDataDigitada('10/08/20'), { iso: null, erro: 'incompleta' });
  assert.deepEqual(F.lerDataDigitada('10/08'), { iso: null, erro: 'incompleta' });
});

test('leitura: dia que não existe é recusado, inclusive 29/02 fora do bissexto', () => {
  assert.equal(F.lerDataDigitada('29/02/2027').erro, 'inexistente', '2027 não é bissexto');
  assert.equal(F.lerDataDigitada('29/02/2028').iso, '2028-02-29', '2028 é');
  assert.equal(F.lerDataDigitada('29/02/2100').erro, 'inexistente', 'século não divisível por 400');
  assert.equal(F.lerDataDigitada('31/04/2026').erro, 'inexistente', 'abril tem 30 dias');
  assert.equal(F.lerDataDigitada('00/01/2026').erro, 'inexistente');
  assert.equal(F.lerDataDigitada('10/13/2026').erro, 'inexistente');
  assert.equal(F.lerDataDigitada('01/01/0026').erro, 'inexistente', 'ano com dígito trocado');
  assert.equal(F.diaExiste(2024, 2, 29), true);
  assert.equal(F.diaExiste(2023, 2, 29), false);
});

test('coluna DATE é CORTADA, não lida por new Date(): 10/08 continua 10/08', () => {
  assert.equal(F.diaDeColunaDate('2026-08-10T00:00:00.000Z'), '2026-08-10');
  assert.equal(F.textoDoDia('2026-08-10T00:00:00.000Z'), '10/08/2026');
  assert.equal(F.textoDoDia('2026-08-10'), '10/08/2026');
  // O erro que se evita: em São Paulo, isto dá o dia 9.
  assert.equal(new Date('2026-08-10T00:00:00.000Z').toLocaleDateString('pt-BR'), '09/08/2026');
  assert.equal(F.textoDoDia(null), '');
  assert.equal(F.textoDoDia('lixo'), '');
});

test('somarDias: conta de calendário, sem recuar nem pular um dia', () => {
  assert.equal(F.somarDias('2026-08-10', 15), '2026-08-25', 'o exemplo do usuário');
  assert.equal(F.somarDias('2026-08-10', 0), '2026-08-10');
  assert.equal(F.somarDias('2026-12-20', 15), '2027-01-04', 'vira o ano');
  assert.equal(F.somarDias('2028-02-28', 1), '2028-02-29', 'bissexto');
  assert.equal(F.somarDias('2027-02-28', 1), '2027-03-01');
  // 04/11/2018 foi início de horário de verão em São Paulo: a meia-noite
  // local não existiu. Somar milissegundos a um Date local tropeçava aqui.
  assert.equal(F.somarDias('2018-11-03', 1), '2018-11-04');
  assert.equal(F.somarDias('2018-11-03', 2), '2018-11-05');
  assert.equal(F.somarDias('2026-08-10T00:00:00.000Z', 15), '2026-08-25', 'base serializada com Z');
  assert.equal(F.somarDias(null, 15), null);
  assert.equal(F.somarDias('2026-08-10', 'x'), null);
});

test('diferencaEmDias: positivo quando o primeiro vem depois', () => {
  assert.equal(F.diferencaEmDias('2026-09-14', '2026-09-10'), 4);
  assert.equal(F.diferencaEmDias('2026-09-10', '2026-09-14'), -4);
  assert.equal(F.diferencaEmDias('2026-09-14', '2026-09-14'), 0);
  assert.equal(F.diferencaEmDias(null, '2026-09-14'), null);
});

test('início por regra: previsão, dia da conversão ou a data escolhida', () => {
  const base = { embarcar_previsao: '2026-10-05', inicio_data: '2026-10-20', dataConversao: '2026-09-14' };
  assert.equal(F.resolverInicio({ ...base, regra: 'ao_embarcar' }), '2026-10-05');
  assert.equal(F.resolverInicio({ ...base, regra: 'ao_converter' }), '2026-09-14');
  assert.equal(F.resolverInicio({ ...base, regra: 'data' }), '2026-10-20');
  assert.equal(F.resolverInicio({ ...base, regra: 'outra' }), null);
  assert.equal(F.resolverInicio({ regra: 'ao_embarcar' }), null, 'sem previsão não há início');
  assert.equal(F.resolverInicio({ regra: 'data', embarcar_previsao: '2026-10-05' }), null,
    'na data específica, a previsão não serve de início');
});

test('regra de abertura: a do pedido; sem ela, "data" se já há início; senão "ao embarcar"', () => {
  assert.equal(F.regraInicial({ faturamento_regra: 'ao_converter' }), 'ao_converter');
  assert.equal(F.regraInicial({ inicio_faturamento: '2026-10-01' }), 'data');
  assert.equal(F.regraInicial({}), 'ao_embarcar');
  assert.equal(F.regraInicial({ faturamento_regra: 'embarque' }), 'ao_embarcar', 'regra desconhecida não vale');
});

test('vencimentos: início + o prazo de cada parcela, na ordem', () => {
  assert.deepEqual(F.vencimentosDe('2026-08-10', [15, 30, 45]), [
    { numero: 1, dias: 15, data: '2026-08-25' },
    { numero: 2, dias: 30, data: '2026-09-09' },
    { numero: 3, dias: 45, data: '2026-09-24' }
  ]);
  assert.deepEqual(F.vencimentosDe(null, [15]), [], 'sem início, sem vencimento');
  assert.deepEqual(F.prazosValidos([0, '30', null, '', 'x', -5, 60.7]), [0, 30, 60]);
});

test('rótulo do vencimento: o mesmo formato do pagamento', () => {
  const [primeira, segunda] = F.vencimentosDe('2026-08-10', [15, 30]);
  assert.equal(F.rotuloVencimento(primeira, 2), '1ª — 25/08/2026 (15 dias)');
  assert.equal(F.rotuloVencimento(segunda, 2), '2ª — 09/09/2026 (30 dias)');
  assert.equal(F.rotuloVencimento(primeira, 1), '25/08/2026 (15 dias)', 'uma parcela só, sem "1ª"');
  assert.equal(F.rotuloVencimento({ numero: 1, dias: 1, data: '2026-08-11' }, 1), '11/08/2026 (1 dia)');
});

test('corpo da API: o início só vai na data específica', () => {
  const datas = { embarcar_previsao: '2026-10-05', faturamento_regra: 'ao_embarcar', inicio_faturamento: '2026-10-05' };
  assert.deepEqual(F.corpoDasDatas(datas), { embarcar_previsao: '2026-10-05', faturamento_regra: 'ao_embarcar' });
  assert.deepEqual(
    F.corpoDasDatas({ ...datas, faturamento_regra: 'data', inicio_faturamento: '2026-10-20' }),
    { embarcar_previsao: '2026-10-05', faturamento_regra: 'data', inicio_faturamento: '2026-10-20' });
});

test('as datas que valeram são as da resposta do backend', () => {
  const pedidas = { embarcar_previsao: '2026-10-05', faturamento_regra: 'ao_converter', inicio_faturamento: '2026-09-14' };
  // O backend resolve "ao converter" pelo dia (SP) da emissão do pedido.
  const resposta = { inicio_faturamento: '2026-09-01T00:00:00.000Z', faturamento_regra: 'ao_converter' };
  assert.deepEqual(F.datasDaResposta(pedidas, resposta),
    { embarcar_previsao: '2026-10-05', faturamento_regra: 'ao_converter', inicio_faturamento: '2026-09-01' });
  assert.deepEqual(F.datasDaResposta(pedidas, null), pedidas);
});

test('erro do backend vira frase para o usuário', () => {
  assert.match(F.mensagemDeErro(403, { error: 'Permissão negada' }), /permissão para alterar as datas/);
  assert.match(F.mensagemDeErro(404, null), /não encontrado/);
  assert.equal(F.mensagemDeErro(409, { error: 'Só em Produção.', code: 'SITUACAO_NAO_PERMITE' }), 'Só em Produção.');
  assert.match(F.mensagemDeErro(409, {}), /não está mais em produção/);
  assert.equal(F.mensagemDeErro(400, { error: 'Previsão inválida.', code: 'DATAS_INVALIDAS' }), 'Previsão inválida.');
  assert.match(F.mensagemDeErro(500, null), /Não foi possível salvar/);
});

// ================================================================== markup

function montarMarkup() {
  const amb = criarAmbiente();
  const wrapper = amb.montar(HTML);
  return { ...amb, wrapper, overlay: wrapper.firstElementChild };
}

test('markup: moldura dos modais de pedido, título e z acima do converter e do pagamento', () => {
  const { overlay } = montarMarkup();
  assert.equal(overlay.id, 'datasPedidoOverlay',
    'o overlay tem de ser o primeiro elemento: é nele que o Modal.open confere o z-index');
  assert.ok(overlay.classList.contains('hidden'), 'nasce escondido; o script revela quando pronto');
  assert.equal(overlay.getAttribute('data-modal-loading'), 'true');
  assert.ok(overlay.classList.contains('z-[12000]'), 'acima do converter e do pagamento (2000)');
  const dialogo = overlay.querySelector('[role="dialog"]');
  assert.ok(dialogo.classList.contains('max-w-lg'));
  assert.ok(dialogo.classList.contains('glass-surface'));
  assert.equal(overlay.querySelector('#datasPedidoTitulo').textContent, 'Datas do pedido');
  assert.match(overlay.querySelector('#voltarDatasPedido').textContent, /← Voltar/);
});

test('markup: campo de data é texto com máscara, e o calendário é um botão ao lado', () => {
  const { overlay } = montarMarkup();
  for (const base of ['datasPedidoEmbarque', 'datasPedidoInicio']) {
    const texto = overlay.querySelector(`#${base}`);
    assert.equal(texto.type, 'text', `${base}: digitável, não type="date"`);
    assert.equal(texto.getAttribute('maxlength'), '10');
    assert.equal(texto.getAttribute('placeholder'), 'dd/mm/aaaa');
    assert.equal(texto.getAttribute('inputmode'), 'numeric');

    const botao = overlay.querySelector(`#${base}Calendario`);
    assert.equal(botao.getAttribute('type'), 'button', `${base}: botão que não envia nada`);
    assert.ok(botao.querySelector('i.fa-calendar-alt'), `${base}: ícone de calendário`);

    const nativo = overlay.querySelector(`#${base}Nativo`);
    assert.equal(nativo.type, 'date');
    assert.equal(nativo.getAttribute('tabindex'), '-1', 'fora da ordem de tabulação');
    assert.equal(nativo.getAttribute('aria-hidden'), 'true');
    const estilo = nativo.getAttribute('style').replace(/\s+/g, '');
    assert.match(estilo, /opacity:0/);
    assert.match(estilo, /pointer-events:none/);
    assert.match(estilo, /position:absolute/);
    // display:none mata o showPicker: o seletor não tem onde se ancorar.
    assert.doesNotMatch(estilo, /display:none/);
    assert.equal(nativo.classList.contains('hidden'), false);
    assert.equal(nativo.hasAttribute('hidden'), false);
    assert.equal(nativo.disabled, false, 'showPicker recusa campo desabilitado');
    assert.equal(nativo.hasAttribute('readonly'), false, 'showPicker recusa campo só leitura');
    assert.equal(nativo.parentElement, botao.parentElement, 'fica sob o botão, e o seletor abre ali');
    assert.ok(nativo.parentElement.classList.contains('relative'));
    assert.equal(nativo.getAttribute('data-no-restore'), 'true',
      'na restauração, o nativo velho sobrescreveria o texto digitado');
  }
});

test('markup: as três regras de início do faturamento', () => {
  const { overlay } = montarMarkup();
  const radios = overlay.querySelectorAll('input[name="datasPedidoRegra"]');
  assert.deepEqual(radios.map(r => r.value), ['ao_embarcar', 'ao_converter', 'data']);
  radios.forEach(r => assert.equal(r.type, 'radio'));
  const rotulos = radios.map(r => r.closest('label').textContent.replace(/\s+/g, ' ').trim());
  assert.match(rotulos[0], /^Ao embarcar/);
  assert.match(rotulos[1], /^Ao converter/);
  assert.match(rotulos[2], /^Data específica/);
});

test('markup: a guarda ped.dates.edit está só no Salvar do modo pedido', () => {
  const { overlay } = montarMarkup();
  assert.equal(overlay.querySelector('#salvarDatasPedido').getAttribute('data-perm'), 'ped.dates.edit');
  assert.equal(overlay.querySelector('#confirmarDatasPedido').hasAttribute('data-perm'), false,
    'na conversão, quem não pode alterar datas de pedido ainda precisa confirmar');
  assert.deepEqual(overlay.querySelectorAll('[data-perm]').map(e => e.id), ['salvarDatasPedido']);
  assert.ok(overlay.querySelector('#cancelarDatasPedido').classList.contains('btn-danger'));
  assert.ok(overlay.querySelector('#salvarDatasPedido').classList.contains('btn-success'));
  assert.ok(overlay.querySelector('#confirmarDatasPedido').classList.contains('btn-success'));
});

// ====================================================== o modal funcionando

const HOJE = '2026-09-14';

const CONTEXTO_CONVERSAO = {
  modo: 'conversao', numero: 'ORC12', cliente: 'Casa Bela', prazos: [15, 30], dataConversao: HOJE
};

const CONTEXTO_PEDIDO = {
  modo: 'pedido',
  pedidoId: 42,
  numero: 'PED42',
  cliente: 'Atelier Lume',
  prazos: [0, 30],
  embarcar_previsao: '2026-10-05T00:00:00.000Z',
  inicio_faturamento: '2026-10-20',
  faturamento_regra: 'data',
  dataConversao: '2026-09-01'
};

function abrirModal(contexto, { fetch = null, botaoAcao = null, estadoTrabalho = null } = {}) {
  const amb = criarAmbiente();
  const { janela, documento } = amb;
  const wrapper = amb.montar(HTML);
  const registro = { fechados: [], prontos: [], eventos: [], requisicoes: [] };

  janela.Modal = {
    close(id) {
      registro.fechados.push(id);
      wrapper.remove();
      janela.dispatchEvent(new janela.CustomEvent('modalFechado', { detail: id }));
    },
    signalReady(id) { registro.prontos.push(id); }
  };
  janela.apiConfig = { getApiBaseUrl: async () => 'http://api.teste' };
  janela.fetch = async (url, opcoes) => {
    registro.requisicoes.push({ url, opcoes, corpo: opcoes?.body ? JSON.parse(opcoes.body) : null });
    if (!fetch) throw new Error('fetch inesperado');
    return fetch(url, opcoes);
  };
  janela.dateUtils = { getTodayKey: () => HOJE };
  if (botaoAcao) janela.BotaoAcao = botaoAcao;
  if (estadoTrabalho) janela.EstadoTrabalho = estadoTrabalho;
  janela.datasPedidoContext = contexto ? JSON.parse(JSON.stringify(contexto)) : contexto;
  janela.addEventListener('pedido:datas-definidas', e => registro.eventos.push({ tipo: 'definidas', detail: simples(e.detail) }));
  janela.addEventListener('modalFechado', e => registro.eventos.push({ tipo: 'fechado', detail: e.detail }));

  vm.runInContext(FONTE, vm.createContext(janela), { filename: 'pedido-datas.js' });

  const $ = id => documento.getElementById(id);
  return {
    ...amb,
    wrapper,
    registro,
    $,
    digitar(id, texto) {
      const campo = $(id);
      campo.value = texto;
      amb.disparar(campo, 'input');
      return campo;
    },
    sair(id) { amb.disparar($(id), 'blur', { bubbles: false }); },
    tecla(alvo, key) { return amb.disparar(alvo, 'keydown', { key }); },
    chips: () => $('datasPedidoVencimentosLista').children.map(c => c.textContent),
    tipos: () => registro.eventos.map(e => e.tipo)
  };
}

test('conversão: abre revelado, avisa que está pronto e mostra o Confirmar', () => {
  const m = abrirModal(CONTEXTO_CONVERSAO);
  const overlay = m.$('datasPedidoOverlay');

  assert.equal(overlay.classList.contains('hidden'), false);
  assert.equal(overlay.hasAttribute('data-modal-loading'), false);
  assert.deepEqual(m.registro.prontos, ['datasPedido']);

  assert.equal(m.$('confirmarDatasPedido').classList.contains('hidden'), false);
  assert.equal(m.$('salvarDatasPedido'), null, 'o botão com a guarda de pedido sai do DOM na conversão');

  assert.equal(m.$('datasPedidoSubtitulo').textContent, 'ORC12 · Casa Bela');
  assert.equal(m.$('datasPedidoRegraConversaoRotulo').textContent, 'Ao converter');
  assert.equal(m.$('datasPedidoRegraConversaoInfo').textContent, 'hoje, 14/09/2026');
  assert.equal(m.$('datasPedidoRegraEmbarque').checked, true, 'sem regra, abre em "Ao embarcar"');
  assert.equal(m.$('datasPedidoInicio').disabled, true, 'o segundo campo só vale na data específica');
  assert.equal(m.$('datasPedidoInicioCalendario').disabled, true);
  assert.equal(m.documento.activeElement, m.$('datasPedidoEmbarque'), 'o foco começa na previsão');
});

test('conversão sem dataConversao: "ao converter" é hoje em São Paulo', () => {
  const m = abrirModal({ modo: 'conversao', prazos: [] });
  assert.equal(m.$('datasPedidoRegraConversaoInfo').textContent, 'hoje, 14/09/2026');
});

test('digitar aplica a máscara e deixa o cursor no fim', () => {
  const m = abrirModal(CONTEXTO_CONVERSAO);
  const campo = m.digitar('datasPedidoEmbarque', '1008');
  assert.equal(campo.value, '10/08');
  m.digitar('datasPedidoEmbarque', '10/08/2026x9');
  assert.equal(campo.value, '10/08/2026');
  assert.equal(campo.selectionStart, 10);
  assert.equal(campo.selectionEnd, 10);
});

test('a prévia acompanha a previsão, a regra e a data escolhida', () => {
  const m = abrirModal(CONTEXTO_CONVERSAO);
  assert.match(m.$('datasPedidoPreviaTexto').textContent, /Informe a previsão de embarque/);
  assert.deepEqual(m.chips(), []);

  m.digitar('datasPedidoEmbarque', '10/10/2026');
  assert.equal(m.$('datasPedidoPreviaTexto').textContent, 'Faturamento a partir de 10/10/2026.');
  assert.deepEqual(m.chips(), ['1ª — 25/10/2026 (15 dias)', '2ª — 09/11/2026 (30 dias)']);
  assert.match(m.$('datasPedidoRegraEmbarqueInfo').textContent, /^Usa a previsão: 10\/10\/2026\./);

  m.$('datasPedidoRegraConversao').click();
  assert.deepEqual(m.chips(), ['1ª — 29/09/2026 (15 dias)', '2ª — 14/10/2026 (30 dias)'],
    'ao converter: conta de hoje');

  m.$('datasPedidoRegraData').click();
  assert.equal(m.$('datasPedidoInicio').disabled, false);
  assert.equal(m.$('datasPedidoInicioCalendario').disabled, false);
  assert.equal(m.documento.activeElement, m.$('datasPedidoInicio'), 'escolher a data leva ao campo');
  assert.match(m.$('datasPedidoPreviaTexto').textContent, /Informe a data de início/);
  m.digitar('datasPedidoInicio', '01122026');
  assert.equal(m.$('datasPedidoInicio').value, '01/12/2026');
  assert.deepEqual(m.chips(), ['1ª — 16/12/2026 (15 dias)', '2ª — 31/12/2026 (30 dias)']);
});

test('sem prazos, a prévia diz de onde o faturamento parte', () => {
  const m = abrirModal({ ...CONTEXTO_CONVERSAO, prazos: [] });
  m.digitar('datasPedidoEmbarque', '10/10/2026');
  assert.match(m.$('datasPedidoPreviaTexto').textContent, /^Faturamento a partir de 10\/10\/2026\. Os vencimentos aparecem/);
  assert.equal(m.$('datasPedidoVencimentosLista').classList.contains('hidden'), true);
});

test('ao sair do campo, data inexistente ou incompleta é apontada; vazia não', () => {
  const m = abrirModal(CONTEXTO_CONVERSAO);
  const erro = m.$('datasPedidoEmbarqueErro');

  m.digitar('datasPedidoEmbarque', '29/02/2027');
  assert.equal(erro.classList.contains('hidden'), true, 'no meio da digitação não se acusa');
  m.sair('datasPedidoEmbarque');
  assert.equal(erro.textContent, 'Essa data não existe no calendário.');
  assert.equal(erro.classList.contains('hidden'), false);
  const campo = m.$('datasPedidoEmbarque');
  assert.equal(campo.getAttribute('aria-invalid'), 'true');
  assert.equal(campo.style.getPropertyValue('border-color'), 'var(--color-red)',
    'borda vermelha inline: vence a de foco do tema, inclusive com o campo focado');

  m.digitar('datasPedidoEmbarque', '29/02/2028');
  assert.equal(erro.classList.contains('hidden'), true, 'o erro sai assim que a data fica boa');
  assert.equal(campo.style.getPropertyValue('border-color'), '', 'e a borda volta à do tema');

  m.digitar('datasPedidoEmbarque', '10/08/20');
  m.sair('datasPedidoEmbarque');
  assert.equal(erro.textContent, 'Data incompleta — use dd/mm/aaaa.');

  m.digitar('datasPedidoEmbarque', '');
  m.sair('datasPedidoEmbarque');
  assert.equal(erro.classList.contains('hidden'), true, 'vazio só é cobrado ao confirmar');
});

test('previsão no passado: aviso suave, que não impede confirmar', () => {
  const m = abrirModal(CONTEXTO_CONVERSAO);
  const aviso = m.$('datasPedidoAviso');

  m.digitar('datasPedidoEmbarque', '14/09/2026');
  assert.equal(aviso.classList.contains('hidden'), true, 'hoje ainda não passou');

  m.digitar('datasPedidoEmbarque', '10/09/2026');
  assert.equal(aviso.classList.contains('hidden'), false);
  assert.match(aviso.textContent, /10\/09\/2026/);

  m.$('confirmarDatasPedido').click();
  assert.deepEqual(m.tipos(), ['definidas', 'fechado']);
});

test('confirmar sem previsão, ou sem a data específica, não fecha nem responde', () => {
  const m = abrirModal(CONTEXTO_CONVERSAO);
  m.$('confirmarDatasPedido').click();
  assert.equal(m.$('datasPedidoEmbarqueErro').textContent, 'Informe a previsão de embarque.');
  assert.deepEqual(m.registro.eventos, []);

  m.digitar('datasPedidoEmbarque', '10/10/2026');
  m.$('datasPedidoRegraData').click();
  m.$('confirmarDatasPedido').click();
  assert.equal(m.$('datasPedidoInicioErro').textContent, 'Informe a data de início do faturamento.');
  assert.deepEqual(m.registro.eventos, []);
  assert.deepEqual(m.registro.fechados, []);
});

test('conversão: confirmar devolve as datas por evento, ANTES de fechar, sem chamar a API', () => {
  const m = abrirModal(CONTEXTO_CONVERSAO);
  m.digitar('datasPedidoEmbarque', '10/10/2026');
  m.$('confirmarDatasPedido').click();

  assert.deepEqual(m.tipos(), ['definidas', 'fechado'],
    'quem abriu trata a desistência pelo modalFechado: as datas têm de chegar antes');
  assert.deepEqual(m.registro.eventos[0].detail, {
    source: 'pedido-datas',
    modo: 'conversao',
    datas: { embarcar_previsao: '2026-10-10', faturamento_regra: 'ao_embarcar', inicio_faturamento: '2026-10-10' },
    resposta: null
  });
  assert.equal(m.registro.requisicoes.length, 0);
  assert.equal(m.janela.datasPedidoContext, null, 'o contexto não fica para a próxima abertura');
});

test('Enter confirma; Enter no botão de calendário é do botão', () => {
  const m = abrirModal(CONTEXTO_CONVERSAO);
  m.digitar('datasPedidoEmbarque', '10/10/2026');

  m.tecla(m.$('datasPedidoEmbarqueCalendario'), 'Enter');
  assert.deepEqual(m.registro.eventos, []);

  m.tecla(m.$('datasPedidoEmbarque'), 'Enter');
  assert.deepEqual(m.tipos(), ['definidas', 'fechado']);
});

test('Esc fecha sem responder e NÃO chega aos ouvintes de Esc dos modais de baixo', () => {
  const m = abrirModal(CONTEXTO_CONVERSAO);
  let vazou = 0;
  const contar = e => { if (e.key === 'Escape') vazou += 1; };
  // Como o editar e o converter ouvem: no document, borbulhando...
  m.documento.addEventListener('keydown', contar);
  // ...e mesmo quem ouvisse em captura no document.
  m.documento.addEventListener('keydown', contar, true);
  const cliques = [];
  m.documento.addEventListener('click', e => cliques.push(e.target.id), true);

  m.digitar('datasPedidoEmbarque', '10/10/2026');
  const evento = m.tecla(m.$('datasPedidoEmbarque'), 'Escape');

  assert.equal(vazou, 0, 'um Esc aqui fecharia converter e editar em cascata');
  assert.equal(evento.defaultPrevented, true);
  assert.deepEqual(cliques, ['cancelarDatasPedido'],
    'sai pelo Cancelar, que é por onde a guarda de saída (SaidaSegura) pergunta');
  assert.deepEqual(m.registro.fechados, ['datasPedido']);
  assert.deepEqual(m.tipos(), ['fechado'], 'desistência: nenhum evento de datas');

  // Fechado, o ouvinte do window saiu: o próximo Esc é dos modais de baixo.
  m.tecla(m.documento.body, 'Escape');
  assert.equal(vazou, 2);
});

test('com uma caixa de diálogo por cima, o Esc é dela', () => {
  const m = abrirModal(CONTEXTO_CONVERSAO);
  const caixa = m.documento.createElement('dialog');
  caixa.setAttribute('open', '');
  m.documento.body.appendChild(caixa);

  m.tecla(m.$('datasPedidoEmbarque'), 'Escape');
  assert.deepEqual(m.registro.fechados, []);
});

test('Voltar e Cancelar fecham sem evento de datas', () => {
  for (const id of ['voltarDatasPedido', 'cancelarDatasPedido']) {
    const m = abrirModal(CONTEXTO_CONVERSAO);
    m.digitar('datasPedidoEmbarque', '10/10/2026');
    m.$(id).click();
    assert.deepEqual(m.tipos(), ['fechado'], id);
  }
});

test('calendário: showPicker no próprio clique, já no dia escrito; escolher preenche o texto', () => {
  const m = abrirModal(CONTEXTO_CONVERSAO);
  m.digitar('datasPedidoEmbarque', '10/10/2026');
  const nativo = m.$('datasPedidoEmbarqueNativo');
  let chamadas = 0;
  let valorAoAbrir = null;
  nativo.showPicker = () => { chamadas += 1; valorAoAbrir = nativo.value; };

  m.$('datasPedidoEmbarqueCalendario').click();
  assert.equal(chamadas, 1, 'síncrono: depois de um await o showPicker recusa');
  assert.equal(valorAoAbrir, '2026-10-10');

  nativo.value = '2026-11-03';
  m.disparar(nativo, 'change');
  assert.equal(m.$('datasPedidoEmbarque').value, '03/11/2026');
  assert.deepEqual(m.chips(), ['1ª — 18/11/2026 (15 dias)', '2ª — 03/12/2026 (30 dias)']);

  // Sem o seletor (recusou): cai no foco e clique do campo nativo.
  nativo.showPicker = () => { throw new Error('NotAllowedError'); };
  let clicou = false;
  nativo.addEventListener('click', () => { clicou = true; });
  m.$('datasPedidoEmbarqueCalendario').click();
  assert.equal(clicou, true);
  assert.equal(m.documento.activeElement, nativo);
});

test('calendário: com texto inválido, o seletor abre sem dia marcado', () => {
  const m = abrirModal(CONTEXTO_CONVERSAO);
  m.digitar('datasPedidoEmbarque', '31/04/2026');
  const nativo = m.$('datasPedidoEmbarqueNativo');
  nativo.value = '2026-01-01';
  let valorAoAbrir = 'não abriu';
  nativo.showPicker = () => { valorAoAbrir = nativo.value; };
  m.$('datasPedidoEmbarqueCalendario').click();
  assert.equal(valorAoAbrir, '');
});

test('sem contexto válido, o modal se fecha sozinho sem responder', () => {
  for (const contexto of [null, { modo: 'outro' }, { modo: 'pedido', prazos: [] }]) {
    const m = abrirModal(contexto);
    assert.deepEqual(m.registro.fechados, ['datasPedido'], JSON.stringify(contexto));
    assert.deepEqual(m.registro.prontos, ['datasPedido'], 'quem espera o waitForReady não fica pendurado');
    assert.deepEqual(m.tipos(), ['fechado']);
  }
});

test('pedido: abre com as datas do pedido e o Salvar com a guarda', () => {
  const m = abrirModal(CONTEXTO_PEDIDO);

  assert.equal(m.$('confirmarDatasPedido'), null);
  const salvar = m.$('salvarDatasPedido');
  assert.equal(salvar.classList.contains('hidden'), false);
  assert.equal(salvar.getAttribute('data-perm'), 'ped.dates.edit');

  assert.equal(m.$('datasPedidoSubtitulo').textContent, 'PED42 · Atelier Lume');
  assert.equal(m.$('datasPedidoRegraConversaoRotulo').textContent, 'Na conversão (01/09/2026)');
  assert.equal(m.$('datasPedidoEmbarque').value, '05/10/2026', 'coluna DATE com Z não recua um dia');
  assert.equal(m.$('datasPedidoRegraData').checked, true);
  assert.equal(m.$('datasPedidoInicio').value, '20/10/2026');
  assert.equal(m.$('datasPedidoInicio').disabled, false);
  assert.deepEqual(m.chips(), ['1ª — 20/10/2026 (0 dias)', '2ª — 19/11/2026 (30 dias)']);
});

test('pedido: Salvar grava por PUT /datas e responde com o JSON da API', async () => {
  const resposta = {
    ok: true,
    embarcar_previsao: '2026-10-05',
    inicio_faturamento: '2026-10-20',
    faturamento_regra: 'data',
    parcelas: [{ id: 1, numero_parcela: 1, valor: 500, data_vencimento: '2026-10-20' }],
    avisos: []
  };
  const m = abrirModal(CONTEXTO_PEDIDO, {
    fetch: async () => ({ ok: true, status: 200, json: async () => resposta })
  });

  m.$('salvarDatasPedido').click();
  await esperarTarefas();

  assert.equal(m.registro.requisicoes.length, 1);
  const [req] = m.registro.requisicoes;
  assert.equal(req.url, 'http://api.teste/api/pedidos/42/datas');
  assert.equal(req.opcoes.method, 'PUT');
  assert.deepEqual(req.corpo,
    { embarcar_previsao: '2026-10-05', faturamento_regra: 'data', inicio_faturamento: '2026-10-20' });

  assert.deepEqual(m.tipos(), ['definidas', 'fechado']);
  const { detail } = m.registro.eventos[0];
  assert.equal(detail.source, 'pedido-datas');
  assert.equal(detail.modo, 'pedido');
  assert.deepEqual(detail.resposta, resposta);
  assert.deepEqual(detail.datas,
    { embarcar_previsao: '2026-10-05', faturamento_regra: 'data', inicio_faturamento: '2026-10-20' });
});

test('pedido: fora da data específica, o início não vai no corpo', async () => {
  const m = abrirModal(CONTEXTO_PEDIDO, {
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })
  });
  m.$('datasPedidoRegraEmbarque').click();
  m.$('salvarDatasPedido').click();
  await esperarTarefas();
  assert.deepEqual(m.registro.requisicoes[0].corpo,
    { embarcar_previsao: '2026-10-05', faturamento_regra: 'ao_embarcar' });
});

test('pedido: recusa do backend fica no modal, aberto, sem evento', async () => {
  const m = abrirModal(CONTEXTO_PEDIDO, {
    fetch: async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: 'Só pedidos em Produção.', code: 'SITUACAO_NAO_PERMITE' })
    })
  });
  m.$('salvarDatasPedido').click();
  await esperarTarefas();

  const mensagem = m.$('datasPedidoMensagem');
  assert.equal(mensagem.textContent, 'Só pedidos em Produção.');
  assert.equal(mensagem.classList.contains('hidden'), false);
  assert.deepEqual(m.registro.eventos, []);
  assert.deepEqual(m.registro.fechados, []);
  assert.equal(m.$('cancelarDatasPedido').disabled, false, 'depois da resposta dá para desistir');
});

test('pedido: sem conexão, a mensagem diz isso e o modal fica', async () => {
  const m = abrirModal(CONTEXTO_PEDIDO, { fetch: async () => { throw new Error('offline'); } });
  m.$('salvarDatasPedido').click();
  await esperarTarefas();
  assert.match(m.$('datasPedidoMensagem').textContent, /falar com o servidor/);
  assert.deepEqual(m.registro.fechados, []);
});

test('pedido: o Salvar passa pelo BotaoAcao (carregando no botão, sem clique duplo)', async () => {
  const ligados = [];
  const botaoAcao = {
    bind(el, fn) { ligados.push(el.id); el.addEventListener('click', () => fn()); }
  };
  const m = abrirModal(CONTEXTO_PEDIDO, {
    botaoAcao,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })
  });
  assert.deepEqual(ligados, ['salvarDatasPedido']);
  m.$('salvarDatasPedido').click();
  await esperarTarefas();
  assert.deepEqual(m.tipos(), ['definidas', 'fechado']);
});

test('restauração: o modal registra um contexto serializável', () => {
  const registros = [];
  const m = abrirModal(CONTEXTO_PEDIDO, {
    estadoTrabalho: { registrarContexto: (id, obter) => registros.push([id, obter]) }
  });
  assert.equal(registros.length, 1);
  const [id, obter] = registros[0];
  assert.equal(id, 'datasPedido');
  assert.deepEqual(simples(obter()), {
    datasPedidoContext: {
      modo: 'pedido',
      pedidoId: 42,
      numero: 'PED42',
      cliente: 'Atelier Lume',
      prazos: [0, 30],
      embarcar_previsao: '2026-10-05',
      inicio_faturamento: '2026-10-20',
      faturamento_regra: 'data',
      dataConversao: '2026-09-01'
    }
  });
  assert.ok(m);
});
