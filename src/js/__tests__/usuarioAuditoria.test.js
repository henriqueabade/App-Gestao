const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { criarAmbiente, esperarTarefas } = require('./apoio/domMinimo');

const RAIZ = path.join(__dirname, '..', '..');
const ler = arquivo => fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');
const FONTE = ler('js/modals/usuario-auditoria.js');
const HTML = ler('html/modals/usuarios/auditoria.html');
const plano = v => JSON.parse(JSON.stringify(v));
const REGISTROS = [{
  id: 1, usuario_id: 7, criado_em: '2026-10-15T14:00:00Z', modulo: 'pedidos', acao: 'editar', entidade: 'pedido', entidade_id: 121,
  origem: 'manual', resultado: 'sucesso', descricao: 'Cliente pediu outra peça <script>alert(1)</script>',
  acao_id: 'acao-121', contexto: { tela: 'pedidos', evento: 'salvar-edicao', alvo_id: 121, canal: 'api', rota: '/api/pedido-edicao/121' },
  mudancas: [{ campo: 'quantidade', antes: 1, depois: 2 }, { campo: 'observacao', antes: null, depois: '<img src=x> & pronto' }]
}, {
  id: 2, usuario_id: 7, criado_em: '2026-10-15T14:01:00Z', modulo: 'financeiro', acao: 'recalcular', entidade: 'parcelas', entidade_id: 121,
  origem: 'automatico', resultado: 'sucesso', descricao: 'Parcelas recalculadas automaticamente', mudancas: []
}, {
  id: 3, usuario_id: 7, criado_em: '2026-10-15T14:02:00Z', modulo: 'produtos', acao: 'atualizar', entidade: 'produto', entidade_id: 30,
  origem: 'nao_confirmada', resultado: 'falha', descricao: 'Origem da tentativa não confirmada', mudancas: []
}];

function pagina(registros, query, extra = {}) {
  const numero = Number(query.get('pagina'));
  const limite = Number(query.get('limite'));
  return {
    registros: registros.slice((numero - 1) * limite, numero * limite), total: registros.length,
    pagina: numero, limite, paginas: Math.max(1, Math.ceil(registros.length / limite)),
    tem_mais: numero * limite < registros.length, proxima_pagina: numero * limite < registros.length ? numero + 1 : null,
    completo: true, sql_pendente: false, snapshot: 9001, fuso: 'America/Sao_Paulo', ...extra
  };
}

function abrir(handler = query => ({ corpo: pagina(REGISTROS, query) })) {
  const amb = criarAmbiente();
  const { janela, documento } = amb;
  const wrapper = amb.montar(HTML);
  documento.baseURI = 'file:///workspace/App-Gestao/src/html/menu.html';
  const registro = { requisicoes: [], pdfs: [], aberturas: [], fechados: [] };
  janela.URL = URL;
  janela.URLSearchParams = URLSearchParams;
  janela.usuarioAuditoriaContext = { usuarioId: 7, nome: 'Henrique & equipe', email: 'h@exemplo.com' };
  janela.apiConfig = { getApiBaseUrl: async () => 'http://api.teste' };
  janela.fetch = async url => {
    const destino = new URL(url);
    assert.equal(destino.pathname, '/api/auditoria-usuarios');
    registro.requisicoes.push(destino.searchParams);
    const resposta = await handler(destino.searchParams, registro.requisicoes.length);
    const status = resposta.status || 200;
    return { ok: status >= 200 && status < 300, status, json: async () => plano(resposta.corpo) };
  };
  janela.Modal = { signalReady() {}, close(id) { registro.fechados.push(id); wrapper.remove(); } };
  janela.VisualizadorPdf = {
    deHtml(html) { registro.pdfs.push(html); return async () => 'pdf'; },
    abrir(opcoes) { registro.aberturas.push(opcoes); }
  };
  const carregado = new Promise(resolve => janela.addEventListener('usuarioAuditoriaLoaded', resolve));
  vm.runInContext(FONTE, vm.createContext(janela), { filename: 'usuario-auditoria.js' });
  const $ = sufixo => documento.getElementById(`usuarioAuditoria${sufixo}`);
  return {
    ...amb, $, wrapper, registro, carregado,
    texto: () => $('Corpo').textContent,
    async clicar(sufixo) { $(sufixo).click(); await esperarTarefas(); },
    mudar(sufixo, valor) { $(sufixo).value = valor; amb.disparar($(sufixo), 'change'); }
  };
}

test('botão de auditoria em Ações abre o usuário certo e é restrito ao Sup Admin', () => {
  const fonte = ler('js/usuarios.js');
  const trecho = fonte.slice(fonte.indexOf('function criarBotaoAuditoriaUsuario('), fonte.indexOf('function fecharPopoversUsuarios('));
  assert.match(fonte, /actionsWrapper\.appendChild\(criarBotaoAuditoriaUsuario\(u\)\)/);
  for (const permitido of [true, false]) {
    const amb = criarAmbiente();
    const aberturas = [];
    amb.janela.ehSupAdminLogado = () => permitido;
    // Com o spinner da casa (15/10/2026): `Modal.open` sozinho deixava o
    // overlay `hidden` — "clico e nada aparece".
    amb.janela.Modal = { open: () => { throw new Error('não use Modal.open: o modal fica escondido'); } };
    amb.janela.openModalWithSpinner = (...args) => aberturas.push(args);
    const criarBotao = vm.runInContext(`${trecho}\ncriarBotaoAuditoriaUsuario`, vm.createContext(amb.janela));
    const botao = criarBotao({ id: 7, nome: 'Henrique', email: 'h@exemplo.com' });
    assert.equal(botao.disabled, !permitido);
    assert.equal(botao.dataset.acao, 'auditoria');
    botao.click();
    assert.equal(aberturas.length, permitido ? 1 : 0);
    if (permitido) {
      assert.deepStrictEqual(aberturas[0], ['modals/usuarios/auditoria.html', '../js/modals/usuario-auditoria.js', 'usuarioAuditoria']);
      assert.equal(amb.janela.usuarioAuditoriaContext.usuarioId, 7);
    }
  }
  // O modal avisa o spinner que está pronto (é o que tira o `hidden`).
  assert.match(ler('js/modals/usuario-auditoria.js'), /new CustomEvent\('modalSpinnerLoaded', \{ detail: overlayId \}\)/);
});

test('o "i" do usuário: uma última ação e o atalho para a auditoria completa (só o Sup Admin)', () => {
  const fonte = ler('js/usuarios.js');
  assert.match(fonte, /data-usuario-id="\$\{escapeHtml\(String\(u\.id \?\? ''\)\)\}"/);
  assert.match(fonte, /<span class="usuario-popover-label">Última ação<\/span>/);
  assert.match(fonte, /const temAuditoria = ehSupAdminLogado\(\) && botao\.dataset\.usuarioId/);
  assert.match(fonte, /origem: 'manual', pagina: '1', limite: '1'/);
  assert.match(fonte, /abrirAuditoriaUsuario\(\{ id: botao\.dataset\.usuarioId, nome: botao\.dataset\.nome \|\| '', email: botao\.dataset\.email \|\| '' \}\)/);
  const preencher = fonte.slice(fonte.indexOf('async function preencherUltimasAcoes('), fonte.indexOf('function abrirPopoverUsuario('));
  assert.ok(preencher.length > 100 && !/innerHTML/.test(preencher), 'as ações vêm do banco: só textContent');
});

test('modal real mostra antes/depois, horário de Brasília e separa ações manuais de eventos automáticos ou não confirmados', async () => {
  const m = abrir();
  await m.carregado;
  assert.equal(m.registro.requisicoes[0].get('usuario_id'), '7');
  assert.match(m.registro.requisicoes[0].get('inicio'), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(m.wrapper.firstElementChild.id, 'usuarioAuditoriaOverlay', 'o gerenciador de modal sobe o primeiro elemento');
  const tabelas = m.$('Corpo').querySelectorAll('table');
  assert.equal(tabelas.length, 3);
  assert.match(tabelas[0].textContent, /Ações do usuário/);
  assert.match(tabelas[0].textContent, /15\/10\/2026, 11:00:00/);
  assert.match(tabelas[0].textContent, /Antes: 1/);
  assert.match(tabelas[0].textContent, /Depois: 2/);
  assert.match(tabelas[0].textContent, /Antes: Vazio/);
  assert.match(tabelas[0].textContent, /Vínculo da ação: acao-121/);
  assert.match(tabelas[0].textContent, /Tela: pedidos · Evento: salvar-edicao · Alvo: 121/);
  assert.ok(!tabelas[0].textContent.includes('Parcelas recalculadas'));
  assert.match(tabelas[1].textContent, /Eventos automáticos e do sistema/);
  assert.match(tabelas[1].textContent, /não representa uma alteração manual deste usuário/);
  assert.match(tabelas[2].textContent, /Origem não confirmada/);
  assert.match(tabelas[2].textContent, /não confirma se a ação foi manual ou automática/);
  assert.ok(!tabelas[2].textContent.includes('Evento automático ou do sistema'));
  assert.equal(m.$('Corpo').querySelector('script'), null);
  assert.equal(m.$('Corpo').querySelector('img'), null);
  assert.match(m.$('Corpo').innerHTML, /&lt;img src=x&gt; &amp; pronto/);
  assert.match(m.$('Contagem').textContent, /3 registro\(s\)/);
  assert.match(m.wrapper.textContent, /atividades anteriores à ativação do registro não são reconstruídas/);
});

test('período inválido não consulta e filtros novos são enviados com uma nova consulta', async () => {
  const m = abrir();
  await m.carregado;
  m.mudar('Inicio', '2026-10-16');
  m.mudar('Fim', '2026-10-01');
  assert.equal(m.$('Pdf').disabled, true, 'filtros pendentes não exportam uma consulta antiga');
  await m.clicar('Consultar');
  assert.equal(m.registro.requisicoes.length, 1);
  assert.match(m.$('Aviso').textContent, /data inicial deve ser anterior/);
  m.mudar('Inicio', '2026-10-01');
  m.mudar('Fim', '2026-10-15');
  m.mudar('Modulo', 'pedidos');
  m.mudar('Acao', 'editar');
  m.mudar('Origem', 'nao_confirmada');
  m.mudar('Resultado', 'falha');
  await m.clicar('Consultar');
  const query = m.registro.requisicoes[1];
  assert.equal(query.get('inicio'), '2026-10-01');
  assert.equal(query.get('fim'), '2026-10-15');
  assert.equal(query.get('modulo'), 'pedidos');
  assert.equal(query.get('acao'), 'editar');
  assert.equal(query.get('origem'), 'nao_confirmada');
  assert.equal(query.get('resultado'), 'falha');
  assert.equal(query.has('snapshot'), false, 'uma nova consulta captura outro snapshot');
});

test('paginação mantém o snapshot e o PDF exporta todo o período em várias páginas sem truncar a página da tela', async () => {
  const registros = Array.from({ length: 501 }, (_, i) => ({ ...REGISTROS[0], id: i + 1, descricao: `Registro completo ${i + 1}` }));
  const m = abrir(query => ({ corpo: pagina(registros, query) }));
  await m.carregado;
  assert.match(m.$('Contagem').textContent, /501 registro\(s\) · Página 1 de 21/);
  assert.ok(!m.texto().includes('Registro completo 501'));
  await m.clicar('Proxima');
  assert.equal(m.registro.requisicoes[1].get('pagina'), '2');
  assert.equal(m.registro.requisicoes[1].get('snapshot'), '9001');
  assert.match(m.$('Contagem').textContent, /Página 2 de 21/);
  await m.clicar('Pdf');
  const exportacoes = m.registro.requisicoes.slice(2);
  assert.deepStrictEqual(exportacoes.map(q => [q.get('pagina'), q.get('limite'), q.get('snapshot')]), [['1', '500', '9001'], ['2', '500', '9001']]);
  assert.equal(m.registro.pdfs.length, 1);
  assert.match(m.registro.pdfs[0], /501 registros · período completo/);
  assert.match(m.registro.pdfs[0], /Registro completo 1/);
  assert.match(m.registro.pdfs[0], /Registro completo 501/);
  assert.equal((m.registro.pdfs[0].match(/Registro completo \d+/g) || []).length, 501);
  assert.match(m.registro.pdfs[0], /usuario-auditoria\.css/);
  assert.equal(m.registro.aberturas[0].tituloSalvar, 'Salvar relatório completo de atividades');
  assert.match(m.$('Aviso').textContent, /PDF completo preparado: 501/);
});

test('limite explícito de PDF recusa exportação parcial e pede um período menor', async () => {
  const m = abrir(query => ({ corpo: pagina(REGISTROS, query, { total: 5001, paginas: Math.ceil(5001 / Number(query.get('limite'))), tem_mais: true }) }));
  await m.carregado;
  await m.clicar('Pdf');
  assert.equal(m.registro.pdfs.length, 0);
  assert.match(m.$('Aviso').textContent, /5001 registros/);
  assert.match(m.$('Aviso').textContent, /aceita até 5000/);
  assert.match(m.$('Aviso').textContent, /nenhum PDF parcial foi gerado/);
});

test('falha ou página faltando durante exportação nunca abre PDF parcial', async () => {
  const registros = Array.from({ length: 501 }, (_, i) => ({ ...REGISTROS[0], id: i + 1 }));
  for (const falha of ['servidor', 'incompleta', 'duplicada']) {
    const m = abrir(query => {
      if (query.get('limite') === '500' && query.get('pagina') === '2') {
        if (falha === 'servidor') return { status: 503, corpo: { error: 'Serviço temporariamente indisponível.' } };
        return { corpo: pagina(registros, query, { registros: falha === 'duplicada' ? [registros[0]] : [] }) };
      }
      return { corpo: pagina(registros, query) };
    });
    await m.carregado;
    await m.clicar('Pdf');
    assert.equal(m.registro.pdfs.length, 0, falha);
    assert.equal(m.registro.aberturas.length, 0, falha);
    assert.ok(m.$('Aviso').textContent.includes(falha === 'servidor' ? 'Serviço temporariamente indisponível' : 'PDF parcial'));
  }
});

test('SQL pendente, acesso negado e erro da API aparecem explicitamente, sem parecer auditoria vazia', async () => {
  for (const [status, corpo, esperado] of [
    [409, { sql_pendente: true, arquivo: 'backend/scripts/ddl_usuarios_auditoria.sql' }, /Execute backend\/scripts\/ddl_usuarios_auditoria\.sql/],
    [403, { error: 'Sem permissão' }, /Acesso negado.*Sup Admin/],
    [500, { error: 'Não foi possível ler o registro.' }, /Não foi possível ler o registro/]
  ]) {
    const m = abrir(() => ({ status, corpo }));
    await m.carregado;
    assert.match(m.$('Aviso').textContent, esperado);
    assert.equal(m.$('Corpo').textContent, '');
    assert.equal(m.$('Pdf').disabled, true);
    assert.equal(m.$('Proxima').disabled, true);
  }
});
