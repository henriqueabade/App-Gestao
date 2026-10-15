/** Relatório real: demanda atual, faltas históricas e auditoria também no PDF. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { criarAmbiente, esperarTarefas } = require('./apoio/domMinimo');

const RAIZ = path.join(__dirname, '..', '..');
const ler = arquivo => fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');
const FONTE = ler('js/modals/pedido-relatorio-producao.js');
const HTML = ler('html/modals/pedidos/relatorio-producao.html');
const plano = valor => JSON.parse(JSON.stringify(valor));
const normalizar = texto => texto.replace(/\u00a0/g, ' ');
const PEDIDO = { id: 121, numero: 'PED121', data_emissao: '2026-10-14T14:00:00Z' };
const PROCESSOS = [{
  processo: 'Marcenaria',
  pecas: [{ peca: 'Caixa Rio - G', itens: [{ insumo_nome: 'MDF', quantidade: 2.125, unidade: 'm²' }] }],
  totais: [{ insumo_nome: 'MDF', quantidade: 2.125, unidade: 'm²' }],
  faltantes: [{ insumo_nome: 'MDF', quantidade: 0.125, unidade: 'm²' }]
}];
const PECAS = [{ peca: 'Caixa Rio - G', origem: 'Do zero', quantidade: 2, etapa: 'Por começar', item_parada: 'MDF', itens_faltantes: 1, itens_da_rota: 3 }];
const EDICOES = [{
  id: 71, data: '2026-10-15T13:25:00Z', concluida: true,
  motivo: 'Trocar caixa <script>alert(1)</script> & manter "desconto"',
  valor_antes: 2000, valor_depois: 2236.36,
  linhas: [
    { item_id: 501, produto_id: 10, peca: 'Caixa Rio - P', tipo: 'existente', quantidade_antes: 2, quantidade_depois: 1, novas: 0 },
    { item_id: 502, produto_id: 10, peca: 'Caixa Rio - P', tipo: 'juntada', quantidade_antes: 1, quantidade_depois: 0, juntar_em: 501, novas: 0 },
    { item_id: 503, produto_id: 30, peca: 'Caixa Rio - G', tipo: 'nova', quantidade_antes: 0, quantidade_depois: 2, novas: 2 }
  ],
  saidas: [{ peca: 'Caixa Rio - P', quantidade: 1, origem: 'Do zero', destino: 'Estoque na Marcenaria', confirmado: true }],
  materia_prima_devolvida: [{ insumo_id: 1, nome: 'MDF <b>18</b>', unidade: 'm²', quantidade: 0.125, confirmado: true }],
  materia_prima_nova_prevista: [{ insumo_id: 2, nome: 'Cola', unidade: 'kg', quantidade: 0.2457 }],
  avisos: ['Conferir <img src=x> & saldo.']
}, {
  id: 72, data: '2026-10-15T14:00:00Z', motivo: 'Cliente confirmou a composição', valor_antes: 2236.36, valor_depois: 2236.36,
  linhas: [], saidas: [], materia_prima_devolvida: [], materia_prima_nova_prevista: [], avisos: []
}];

function abrir({ relatorio = {}, pecas = {} } = {}) {
  const amb = criarAmbiente();
  const { janela, documento } = amb;
  amb.montar(HTML);
  documento.baseURI = 'file:///workspace/App-Gestao/src/html/menu.html';
  const registro = { requisicoes: [], pdfs: [], aberturas: [] };
  const dadosRelatorio = { pedido: PEDIDO, processos: PROCESSOS, temItens: true, edicoes: EDICOES, ...relatorio };
  const dadosPecas = { pedido: PEDIDO, pecas: PECAS, selecaoOriginal: [], alteracoes: [], destinacoes: [], houve_edicao: true, edicoes: EDICOES, ...pecas };
  janela.URL = URL;
  janela.apiConfig = { getApiBaseUrl: async () => 'http://api.teste' };
  janela.relatorioProducaoContext = { pedidoId: 121, cliente: 'LS Selection & Casa' };
  janela.fetch = async url => {
    registro.requisicoes.push(url);
    const dados = url.endsWith('/relatorio-producao') ? dadosRelatorio : dadosPecas;
    assert.ok(url === 'http://api.teste/api/pedidos/121/relatorio-producao' || url === 'http://api.teste/api/pedidos/121/pecas-selecionadas');
    return { ok: true, json: async () => plano(dados) };
  };
  janela.Modal = { close() {}, signalReady() {} };
  janela.VisualizadorPdf = {
    deHtml(html) { registro.pdfs.push(html); return async () => 'pdf'; },
    abrir(opcoes) { registro.aberturas.push(opcoes); }
  };
  const carregado = new Promise(resolve => janela.addEventListener('pedidoModalLoaded', resolve));
  vm.runInContext(FONTE, vm.createContext(janela), { filename: 'pedido-relatorio-producao.js' });
  const $ = id => documento.getElementById(id);
  return {
    ...amb, $, carregado, registro,
    corpo: () => $('relatorioProducaoCorpo'),
    texto: () => normalizar($('relatorioProducaoCorpo').textContent),
    async alternar() { $('verPecasRelatorio').click(); await esperarTarefas(); },
    async imprimir() { $('imprimirRelatorioProducao').click(); await esperarTarefas(); }
  };
}

test('folha de insumos mantém demanda e faltas registradas e acrescenta auditoria completa e escapada', async () => {
  const m = abrir();
  await m.carregado;
  const folhas = m.corpo().querySelectorAll('.rp-folha');
  assert.equal(folhas.length, 2, 'a auditoria vem numa folha depois do processo');
  assert.match(folhas[0].textContent, /Processo Marcenaria/);
  assert.match(folhas[0].textContent, /Faltas registradas — Processo Marcenaria/);
  assert.match(folhas[0].textContent, /Faltas históricas limitadas à demanda atual/);
  assert.match(folhas[0].textContent, /2,125/);
  assert.match(folhas[0].querySelector('.rp-tabela-falta').textContent, /0,125/);
  assert.ok(!m.texto().includes('Itens Fora do Estoque'));
  const auditoria = normalizar(folhas[1].textContent);
  assert.ok(auditoria.indexOf('Edição 71') < auditoria.indexOf('Edição 72'), 'preserva a ordem devolvida pela API');
  assert.match(auditoria, /15\/10\/2026/);
  assert.match(auditoria, /R\$ 2\.000,00 → R\$ 2\.236,36/);
  assert.match(auditoria, /Caixa Rio - P: 2 → 1 un\. · Quantidade alterada/);
  assert.match(auditoria, /Caixa Rio - P: 1 → 0 un\. · Linha juntada · juntada à linha 501/);
  assert.match(auditoria, /Caixa Rio - G: 0 → 2 un\. · Peça nova · 2 unidade\(s\) nova\(s\)/);
  assert.match(auditoria, /Retorno de peça/);
  assert.match(auditoria, /1 × Caixa Rio - P \(Do zero\) → Estoque na Marcenaria/);
  assert.match(auditoria, /Matéria-prima devolvida/);
  assert.match(auditoria, /MDF <b>18<\/b>: 0,125 m²/);
  assert.match(auditoria, /Novos consumos previstos/);
  assert.match(auditoria, /Cola: 0,2457 kg/);
  assert.match(auditoria, /Aviso/);
  assert.match(auditoria, /Conferir <img src=x> & saldo\./);
  assert.equal(m.corpo().querySelector('script'), null);
  assert.equal(m.corpo().querySelector('img'), null);
  assert.equal(m.corpo().querySelector('b'), null);
  assert.match(m.corpo().innerHTML, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(m.corpo().innerHTML, /&lt;b&gt;18&lt;\/b&gt;/);
  assert.equal(m.$('imprimirRelatorioProducao').disabled, false);
  await m.imprimir();
  assert.equal(m.registro.aberturas[0].nomeArquivo, 'relatorio-producao-PED121');
  assert.match(m.registro.pdfs[0], /folha-relatorio\.css/);
  assert.match(m.registro.pdfs[0], /Faltas registradas/);
  assert.match(m.registro.pdfs[0], /Edições do pedido/);
  assert.match(m.registro.pdfs[0], /Novos consumos previstos/);
  assert.ok(!m.registro.pdfs[0].includes('<script>alert(1)</script>'));
});

test('composição atual e auditoria aparecem nas peças, no PDF e após voltar para o relatório', async () => {
  const m = abrir();
  await m.carregado;
  const folhaAuditoria = m.corpo().querySelectorAll('.rp-folha')[1].outerHTML;
  await m.alternar();
  assert.match(m.texto(), /Composição atual/);
  assert.ok(!m.texto().includes('Peças selecionadas na conversão'));
  assert.ok(!m.texto().includes('Seleção original da conversão'));
  const folhas = m.corpo().querySelectorAll('.rp-folha');
  assert.equal(folhas.length, 2);
  assert.equal(folhas[1].outerHTML, folhaAuditoria, 'os dois modos usam a mesma auditoria');
  assert.match(folhas[0].textContent, /Caixa Rio - G/);
  await m.imprimir();
  assert.equal(m.registro.aberturas[0].nomeArquivo, 'pecas-PED121');
  assert.match(m.registro.pdfs[0], /Composição atual/);
  assert.match(m.registro.pdfs[0], /Edições do pedido/);
  await m.alternar();
  assert.match(m.texto(), /Faltas registradas/);
  assert.equal(m.corpo().querySelectorAll('.rp-folha')[1].outerHTML, folhaAuditoria);
  await m.alternar();
  assert.match(m.texto(), /Composição atual/);
  assert.equal(m.registro.requisicoes.length, 2, 'alternar não consulta saldos ou recalcula estoque');
});

test('sem processos após edição, os retornos continuam visíveis e podem ser impressos', async () => {
  const m = abrir({ relatorio: { processos: [], somentePecasProntas: true } });
  await m.carregado;
  assert.match(m.texto(), /Não há demanda atual de fabricação/);
  assert.ok(!m.texto().includes('nenhum insumo foi consumido'));
  assert.match(m.texto(), /Matéria-prima devolvida/);
  assert.equal(m.$('imprimirRelatorioProducao').disabled, false);
  await m.imprimir();
  assert.match(m.registro.pdfs[0], /Edições do pedido/);
  assert.match(m.registro.pdfs[0], /Retorno de peça/);
});

test('sem edições mantém seleção da conversão, sem auditoria, e não interpreta falta vazia como saldo atual', async () => {
  const m = abrir({
    relatorio: { edicoes: undefined, processos: [{ ...PROCESSOS[0], faltantes: [] }] },
    pecas: { houve_edicao: false, edicoes: undefined }
  });
  await m.carregado;
  assert.equal(m.corpo().querySelectorAll('.rp-folha').length, 1);
  assert.match(m.texto(), /Nenhuma falta registrada para a demanda atual/);
  assert.ok(!m.texto().includes('o estoque cobria'));
  await m.alternar();
  assert.match(m.texto(), /Peças selecionadas na conversão/);
  assert.ok(!m.texto().includes('Edições do pedido'));
});

test('sinal houve_edicao ou registros de edição bastam para identificar a composição atual', async () => {
  for (const pecas of [{ houve_edicao: true, edicoes: [] }, { houve_edicao: undefined, edicoes: EDICOES }]) {
    const m = abrir({ pecas });
    await m.carregado;
    await m.alternar();
    assert.match(m.texto(), /Composição atual/);
    assert.ok(!m.texto().includes('Peças selecionadas na conversão'));
  }
});

test('aviso de auditoria indisponível permanece visível nos dois modos e PDFs mesmo sem registros acessíveis', async () => {
  const avisos = ['O perfil pode ver o relatório, mas não consultar as edições <script>alert(2)</script>.'];
  const m = abrir({
    relatorio: { edicoes: [], avisos_auditoria: avisos },
    pecas: { edicoes: [], houve_edicao: true, avisos_auditoria: avisos }
  });
  await m.carregado;
  assert.equal(m.corpo().querySelectorAll('.rp-folha').length, 2);
  assert.match(m.texto(), /O perfil pode ver o relatório, mas não consultar as edições/);
  assert.equal(m.corpo().querySelector('script'), null);
  assert.match(m.corpo().innerHTML, /&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
  await m.imprimir();
  assert.match(m.registro.pdfs[0], /O perfil pode ver o relatório, mas não consultar as edições/);
  await m.alternar();
  assert.match(m.texto(), /Composição atual/);
  assert.match(m.texto(), /O perfil pode ver o relatório, mas não consultar as edições/);
  assert.ok(!m.texto().includes('Peças selecionadas na conversão'));
  await m.imprimir();
  assert.match(m.registro.pdfs[1], /O perfil pode ver o relatório, mas não consultar as edições/);
});

test('aviso de auditoria sem processos ou registros mantém impressão disponível', async () => {
  const m = abrir({ relatorio: { processos: [], somentePecasProntas: true, edicoes: [], avisos_auditoria: ['Histórico de edições indisponível para este perfil.'] } });
  await m.carregado;
  assert.match(m.texto(), /Não há demanda atual de fabricação/);
  assert.match(m.texto(), /Histórico de edições indisponível para este perfil/);
  assert.equal(m.$('imprimirRelatorioProducao').disabled, false);
  await m.imprimir();
  assert.match(m.registro.pdfs[0], /Histórico de edições indisponível para este perfil/);
});

test('edição sem conclusão registrada informa o estado nos dois modos e no PDF', async () => {
  const edicoes = [{ ...EDICOES[0], concluida: false, avisos: ['A gravação da edição não terminou.'] }];
  const m = abrir({ relatorio: { edicoes }, pecas: { edicoes } });
  await m.carregado;
  assert.match(m.texto(), /Conclusão não registrada; valores e mudanças são o plano/);
  assert.match(m.texto(), /A gravação da edição não terminou/);
  await m.alternar();
  assert.match(m.texto(), /Conclusão não registrada; valores e mudanças são o plano/);
  await m.imprimir();
  assert.match(m.registro.pdfs[0], /Conclusão não registrada; valores e mudanças são o plano/);
  const legado = abrir();
  await legado.carregado;
  assert.ok(!legado.texto().includes('Conclusão não registrada'), 'ausência do campo em registros antigos não indica falha');
});
