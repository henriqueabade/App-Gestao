/**
 * Lógica da tela de Prospecções (src/js/prospeccoes.js).
 *
 * O arquivo é um script de navegador: define funções no escopo global e, no
 * fim, decide se chama `initProspeccoes()` olhando `document.readyState`.
 * Carregamos com readyState 'loading' justamente para que ele registre o
 * listener e NÃO dispare a inicialização (que faria fetch) — sobra o que
 * interessa testar: escape, classificação de etapa e datas, e o filtro.
 *
 * O foco é onde o bug se esconde de verdade:
 *   • data "2026-09-01" comparada como dia local, não deslocada por fuso;
 *   • o filtro combinando vários critérios ao mesmo tempo;
 *   • escape do texto livre que entra por innerHTML.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ARQUIVO = path.join(__dirname, '..', 'prospeccoes.js');

/** Campo de formulário mínimo, com o que o módulo lê/escreve. */
function campo(valor = '') {
  return {
    value: valor,
    checked: false,
    innerHTML: '',
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {},
    dispatchEvent() {},
    closest: () => null,
    textContent: ''
  };
}

function criarSandbox(campos = {}) {
  const elementos = new Map(Object.entries(campos));

  const document = {
    readyState: 'loading',
    addEventListener() {},
    getElementById: id => elementos.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => campo()
  };

  const sandbox = {
    document,
    console,
    Intl,
    setTimeout,
    clearTimeout,
    Event: class {},
    CustomEvent: class {},
    // O módulo registra ouvintes de `prospeccaoAdicionada` e afins no topo.
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    showToast() {},
    fetch: async () => { throw new Error('fetch não deveria ser chamado neste teste'); }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(ARQUIVO, 'utf8'), sandbox, { filename: 'prospeccoes.js' });
  return sandbox;
}

/**
 * `let` no topo de um script vai para o ambiente LEXICAL do contexto, não vira
 * propriedade do objeto global — então `sandbox.todasProspeccoes = x` criaria
 * uma variável paralela que o módulo nunca lê. A atribuição precisa ser
 * executada dentro do próprio contexto.
 */
function definir(sandbox, nome, valor) {
  sandbox.__valorTemporario = valor;
  vm.runInContext(`${nome} = __valorTemporario;`, sandbox);
  delete sandbox.__valorTemporario;
}

// ---------------------------------------------------------------------------
// Escape
// ---------------------------------------------------------------------------

test('esc neutraliza HTML vindo do nome da empresa', () => {
  const s = criarSandbox();
  const perigoso = '<img src=x onerror="alert(1)">';
  const seguro = s.esc(perigoso);

  assert.equal(seguro.includes('<img'), false);
  assert.equal(seguro.includes('onerror="'), false);
  assert.equal(seguro, '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
});

test('esc trata nulo e indefinido como vazio', () => {
  const s = criarSandbox();
  assert.equal(s.esc(null), '');
  assert.equal(s.esc(undefined), '');
  assert.equal(s.esc(0), '0');
});

// ---------------------------------------------------------------------------
// Etapas
// ---------------------------------------------------------------------------

test('slugEtapa remove acento e casa com a classe CSS', () => {
  const s = criarSandbox();
  // "Negociação" precisa virar "negociacao": a classe é .badge-etapa--negociacao
  assert.equal(s.slugEtapa('Negociação'), 'negociacao');
  assert.equal(s.slugEtapa('Novo'), 'novo');
  assert.equal(s.slugEtapa('Perdido'), 'perdido');
  assert.equal(s.slugEtapa('Qualificado'), 'qualificado');
});

test('as 7 etapas do funil têm classe CSS definida', () => {
  const s = criarSandbox();
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'css', 'prospeccoes.css'), 'utf8');
  const etapas = ['Novo', 'Contactado', 'Qualificado', 'Proposta', 'Negociação', 'Ganho', 'Perdido'];

  for (const etapa of etapas) {
    const slug = s.slugEtapa(etapa);
    assert.ok(
      css.includes(`.badge-etapa--${slug}`),
      `falta .badge-etapa--${slug} em prospeccoes.css (etapa "${etapa}")`
    );
    assert.ok(
      css.includes(`.funil-barra--${slug}`),
      `falta .funil-barra--${slug} em prospeccoes.css (etapa "${etapa}")`
    );
  }
});

// ---------------------------------------------------------------------------
// Datas — o ponto onde fuso horário costuma estragar tudo
// ---------------------------------------------------------------------------

test('diaDe interpreta a data como dia LOCAL, sem deslocar por fuso', () => {
  const s = criarSandbox();
  const d = s.diaDe('2026-09-01');

  // new Date('2026-09-01') seria meia-noite UTC e, a oeste de Greenwich,
  // voltaria 31/08 no horário local. Este teste trava essa regressão.
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 8); // setembro
  assert.equal(d.getDate(), 1);
});

test('diaDe aceita timestamp completo e ignora a hora', () => {
  const s = criarSandbox();
  const d = s.diaDe('2026-09-01T23:45:00.000Z');
  assert.equal(d.getDate(), 1);
  assert.equal(d.getMonth(), 8);
});

test('diaDe devolve null para vazio ou lixo', () => {
  const s = criarSandbox();
  assert.equal(s.diaDe(null), null);
  assert.equal(s.diaDe(''), null);
  assert.equal(s.diaDe('nao-e-data'), null);
});

test('combinaProximoPasso classifica atrasado, hoje, semana e sem passo', () => {
  const s = criarSandbox();

  const emDias = n => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const ontem = { proximo_passo: 'x', proximo_passo_data: emDias(-1) };
  const hoje = { proximo_passo: 'x', proximo_passo_data: emDias(0) };
  const daquiTres = { proximo_passo: 'x', proximo_passo_data: emDias(3) };
  const daquiTrinta = { proximo_passo: 'x', proximo_passo_data: emDias(30) };
  const semPasso = { proximo_passo: null, proximo_passo_data: null };

  assert.equal(s.combinaProximoPasso(ontem, 'atrasado'), true);
  assert.equal(s.combinaProximoPasso(hoje, 'atrasado'), false);

  assert.equal(s.combinaProximoPasso(hoje, 'hoje'), true);
  assert.equal(s.combinaProximoPasso(ontem, 'hoje'), false);

  assert.equal(s.combinaProximoPasso(hoje, 'semana'), true);
  assert.equal(s.combinaProximoPasso(daquiTres, 'semana'), true);
  assert.equal(s.combinaProximoPasso(daquiTrinta, 'semana'), false);
  // Atrasado não é "próximos 7 dias".
  assert.equal(s.combinaProximoPasso(ontem, 'semana'), false);

  assert.equal(s.combinaProximoPasso(semPasso, 'sem'), true);
  assert.equal(s.combinaProximoPasso(hoje, 'sem'), false);

  // Sem modo escolhido, tudo passa.
  assert.equal(s.combinaProximoPasso(semPasso, ''), true);
  assert.equal(s.combinaProximoPasso(ontem, ''), true);
});

// ---------------------------------------------------------------------------
// Filtro
// ---------------------------------------------------------------------------

const PROSPECCOES = [
  {
    id: 1, nome_fantasia: 'Marmoraria Vitória', cnpj: '12.345.678/0001-90',
    origem: 'Indicação', etapa: 'Novo', valor_estimado: 48000, probabilidade: 10,
    responsavel: 'João Silva', pais: 'Brasil', estado: 'São Paulo',
    proximo_passo: 'Ligar', proximo_passo_data: null,
    contato_principal: { nome: 'Rogério Tavares', email: 'rogerio@vitoria.com.br' }
  },
  {
    id: 2, nome_fantasia: 'Studio Lumina', origem: 'Redes Sociais', etapa: 'Novo',
    valor_estimado: 26500, probabilidade: 10, responsavel: 'Maria Santos',
    pais: 'Brasil', estado: 'Rio de Janeiro',
    contato_principal: { nome: 'Beatriz Nogueira', email: 'bia@lumina.arq.br' }
  },
  {
    id: 3, nome_fantasia: 'Construtora Alvorada', origem: 'Evento', etapa: 'Contactado',
    valor_estimado: 185000, probabilidade: 25, responsavel: 'João Silva',
    pais: 'Brasil', estado: 'Minas Gerais',
    contato_principal: { nome: 'Marcelo Assunção', email: 'marcelo@alvorada.com.br' }
  },
  {
    id: 4, nome_fantasia: 'Hotel Costa Serena', origem: 'Website', etapa: 'Qualificado',
    valor_estimado: 92000, probabilidade: 50, responsavel: 'Maria Santos',
    pais: 'Portugal', estado: 'Lisboa',
    contato_principal: null
  }
];

/** Monta a sandbox com os campos de filtro que a tela tem. */
function comFiltros(valores = {}) {
  const campos = {
    filtroBusca: campo(valores.busca || ''),
    filtroEtapa: campo(valores.etapa || ''),
    filtroOrigem: campo(valores.origem || ''),
    filtroResponsavel: campo(valores.responsavel || ''),
    filtroValorMin: campo(valores.valorMin || ''),
    filtroValorMax: campo(valores.valorMax || ''),
    filtroProximoPasso: campo(valores.proximoPasso || ''),
    prospeccoesTableBody: campo(),
    prospeccoesResumo: campo(),
    prospeccoesTableWrapper: campo(),
    prospeccoesEmptyState: campo(),
    prospeccoesLoading: campo(),
    prospeccoesErro: campo(),
    prospeccoesFunilCard: campo(),
    prospeccoesEmptyTitulo: campo(),
    prospeccoesEmptyTexto: campo(),
    prospeccoesEmptyNew: campo()
  };

  const s = criarSandbox(campos);
  definir(s, 'todasProspeccoes', PROSPECCOES);

  // Captura o que renderTabela receberia, sem depender do DOM real.
  const recebidos = [];
  definir(s, 'renderTabela', lista => recebidos.push(lista));
  definir(s, 'renderResumo', () => {});

  return {
    sandbox: s,
    geo: valor => definir(s, 'filtroGeo', valor),
    resultado: () => recebidos.at(-1) || []
  };
}

test('filtro sem critério devolve tudo', () => {
  const { sandbox, resultado } = comFiltros();
  sandbox.aplicarFiltros();
  assert.equal(resultado().length, 4);
});

test('busca cobre empresa, CNPJ e o contato principal', () => {
  const porEmpresa = comFiltros({ busca: 'lumina' });
  porEmpresa.sandbox.aplicarFiltros();
  assert.deepEqual(porEmpresa.resultado().map(p => p.id), [2]);

  const porCnpj = comFiltros({ busca: '12.345' });
  porCnpj.sandbox.aplicarFiltros();
  assert.deepEqual(porCnpj.resultado().map(p => p.id), [1]);

  const porContato = comFiltros({ busca: 'marcelo' });
  porContato.sandbox.aplicarFiltros();
  assert.deepEqual(porContato.resultado().map(p => p.id), [3]);
});

test('busca ignora acento e caixa', () => {
  const { sandbox, resultado } = comFiltros({ busca: 'VITORIA' });
  sandbox.aplicarFiltros();
  // "Marmoraria Vitória" tem acento; a busca digitada não.
  assert.deepEqual(resultado().map(p => p.id), [1]);
});

test('filtro por etapa e por responsável se combinam', () => {
  const { sandbox, resultado } = comFiltros({ etapa: 'Novo', responsavel: 'João Silva' });
  sandbox.aplicarFiltros();
  assert.deepEqual(resultado().map(p => p.id), [1]);
});

test('faixa de valor respeita mínimo e máximo', () => {
  const min = comFiltros({ valorMin: '50000' });
  min.sandbox.aplicarFiltros();
  assert.deepEqual(min.resultado().map(p => p.id).sort(), [3, 4]);

  const faixa = comFiltros({ valorMin: '30000', valorMax: '100000' });
  faixa.sandbox.aplicarFiltros();
  assert.deepEqual(faixa.resultado().map(p => p.id).sort(), [1, 4]);
});

test('faixa de valor aceita vírgula como separador decimal', () => {
  const { sandbox, resultado } = comFiltros({ valorMin: '26500,50' });
  sandbox.aplicarFiltros();
  // 26.500,50 exclui a de 26.500 exatos.
  assert.equal(resultado().some(p => p.id === 2), false);
});

test('filtro geográfico corta por país e por estado', () => {
  const porPais = comFiltros();
  porPais.geo({ paises: ['Portugal'], estados: [] });
  porPais.sandbox.aplicarFiltros();
  assert.deepEqual(porPais.resultado().map(p => p.id), [4]);

  const porEstado = comFiltros();
  porEstado.geo({ paises: [], estados: ['Minas Gerais'] });
  porEstado.sandbox.aplicarFiltros();
  assert.deepEqual(porEstado.resultado().map(p => p.id), [3]);
});

test('filtro combinado que não casa com ninguém devolve lista vazia', () => {
  const { sandbox, resultado } = comFiltros({ etapa: 'Ganho', responsavel: 'João Silva' });
  sandbox.aplicarFiltros();
  assert.equal(resultado().length, 0);
});

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------

test('formatarMoedaCompacta encurta milhares e milhões', () => {
  const s = criarSandbox();
  assert.equal(s.formatarMoedaCompacta(320000), 'R$ 320.0 mil');
  assert.equal(s.formatarMoedaCompacta(1500000), 'R$ 1.5 mi');
  assert.match(s.formatarMoedaCompacta(750), /750/);
  assert.equal(s.formatarMoedaCompacta(0), formatarZero(s));
});

function formatarZero(s) {
  return s.formatarMoedaCompacta(0);
}

// ---------------------------------------------------------------------------
// Exibição de data — a regressão que fazia o dia aparecer errado
// ---------------------------------------------------------------------------

test('formatarData exibe o MESMO dia que foi gravado, sem recuar por fuso', () => {
  const s = criarSandbox();
  // `new Date('2026-09-20')` é meia-noite UTC por norma; no Brasil (UTC-3) o
  // toLocaleDateString devolvia 19/09. Um próximo passo agendado para o dia 20
  // aparecia como 19 na grade e no detalhe.
  assert.equal(s.formatarData('2026-09-20'), '20/09/2026');
  assert.equal(s.formatarData('2026-01-01'), '01/01/2026');
  assert.equal(s.formatarData('2026-12-31'), '31/12/2026');
});

test('formatarData aceita timestamp completo e mantém o dia', () => {
  const s = criarSandbox();
  assert.equal(s.formatarData('2026-09-20T00:00:00.000Z'), '20/09/2026');
  assert.equal(s.formatarData('2026-09-20T23:59:00.000Z'), '20/09/2026');
});

test('formatarData devolve vazio para nulo e lixo', () => {
  const s = criarSandbox();
  assert.equal(s.formatarData(null), '');
  assert.equal(s.formatarData(''), '');
  assert.equal(s.formatarData('nao-e-data'), '');
});

test('o popover (i) traz o contato primeiro e a data sem recuar', () => {
  const s = criarSandbox();
  const emDias = n => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const html = s.criarConteudoPopupLinha({
    id: 7,
    nome_fantasia: 'Incorporadora Terra Nova',
    cnpj: '67.890.123/0001-45',
    valor_estimado: 320000,
    probabilidade: 65,
    proximo_passo: 'Defender a proposta',
    proximo_passo_data: '2026-09-20',
    atualizado_em: '2026-08-11T13:56:00.000Z',
    contato_principal: {
      nome: 'Ricardo Mourão', cargo: 'Diretor',
      email: 'ricardo@terranovainc.com.br', telefone_celular: '(61) 98211-3344'
    }
  });

  // O contato abre o corpo do popover — foi para isso que ele saiu da coluna.
  const posContato = html.indexOf('Ricardo Mourão');
  const posValor = html.indexOf('Valor estimado');
  assert.ok(posContato > -1 && posValor > -1);
  assert.ok(posContato < posValor, 'o contato deveria vir antes das métricas');

  assert.match(html, /ricardo@terranovainc\.com\.br/);
  assert.match(html, /Diretor/);
  // Data pura não pode recuar um dia (ver formatarData).
  assert.match(html, /20\/09\/2026/);
  // Previsão ponderada: 320.000 x 65%
  assert.match(html, /208\.000,00/);
  // Cada campo movido carrega a sua permissão de coluna.
  ['col_pros_id', 'col_pros_valor', 'col_pros_proximo_passo',
   'col_pros_proximo_passo_data', 'col_pros_atualizado_em'].forEach(chave => {
    assert.ok(html.includes(chave), `faltou data-perm-col ${chave} no popover`);
  });
});

test('popover marca o próximo passo atrasado', () => {
  const s = criarSandbox();
  const ontem = new Date(); ontem.setDate(ontem.getDate() - 1);
  const iso = `${ontem.getFullYear()}-${String(ontem.getMonth() + 1).padStart(2, '0')}-${String(ontem.getDate()).padStart(2, '0')}`;
  const html = s.criarConteudoPopupLinha({ id: 1, nome_fantasia: 'X', proximo_passo_data: iso });
  assert.match(html, /prox-passo-atrasado/);
  assert.match(html, /atrasado/);
});

test('popover sem contato avisa em vez de quebrar', () => {
  const s = criarSandbox();
  const html = s.criarConteudoPopupLinha({ id: 2, nome_fantasia: 'Sem Contato' });
  assert.match(html, /Nenhum contato cadastrado/);
});

test('popover escapa o nome do contato', () => {
  const s = criarSandbox();
  const html = s.criarConteudoPopupLinha({
    id: 3, nome_fantasia: 'X',
    contato_principal: { nome: '<img src=x onerror=alert(1)>' }
  });
  assert.equal(html.includes('<img src=x'), false);
  assert.match(html, /&lt;img/);
});

// ---------------------------------------------------------------------------
// Popover: botões de copiar e CNPJ inteiro
// ---------------------------------------------------------------------------

test('nome, e-mail e telefone do contato ganham botão de copiar', () => {
  const s = criarSandbox();
  const html = s.criarConteudoPopupLinha({
    id: 1,
    nome_fantasia: 'Marmoraria Vitória',
    contato_principal: {
      nome: 'Rogério Tavares',
      cargo: 'Sócio-proprietário',
      email: 'rogerio@marmorariavitoria.com.br',
      telefone_celular: '(11) 98812-4455'
    }
  });

  const copiaveis = [...html.matchAll(/data-copiar="([^"]*)"/g)].map(m => m[1]);
  assert.equal(copiaveis.length, 3, 'esperava três botões de copiar');
  assert.ok(copiaveis.includes('Rogério Tavares'));
  assert.ok(copiaveis.includes('rogerio@marmorariavitoria.com.br'));
  assert.ok(copiaveis.includes('(11) 98812-4455'));

  // O cargo NÃO recebe botão: ninguém copia "Sócio-proprietário".
  assert.equal(copiaveis.includes('Sócio-proprietário'), false);
});

test('o valor copiado sai do atributo, não do texto com ícone junto', () => {
  const s = criarSandbox();
  const html = s.criarConteudoPopupLinha({
    id: 1, nome_fantasia: 'X',
    contato_principal: { nome: 'Ana', email: 'ana@x.com' }
  });
  // O texto fica num <span> próprio, separado do ícone e do botão — é o que
  // permite quebrar a linha sem levar o botão junto.
  assert.match(html, /popup-contato-texto/);
  assert.match(html, /data-copiar="ana@x\.com"/);
  assert.match(html, /data-rotulo="E-mail"/);
});

test('botão de copiar escapa aspas no valor', () => {
  const s = criarSandbox();
  const html = s.criarConteudoPopupLinha({
    id: 1, nome_fantasia: 'X',
    contato_principal: { nome: 'Ana "A" Silva' }
  });
  // Sem escape, a aspa fecharia o atributo e o resto viraria marcação.
  assert.equal(html.includes('data-copiar="Ana "A" Silva"'), false);
  assert.match(html, /data-copiar="Ana &quot;A&quot; Silva"/);
});

test('CNPJ é marcado para não quebrar no meio', () => {
  const s = criarSandbox();
  const html = s.criarConteudoPopupLinha({
    id: 1, nome_fantasia: 'X', cnpj: '12.345.678/0001-90'
  });
  // A classe é o que impede o "12.345.678/0001-" numa linha e o "90" na outra.
  assert.match(html, /popup-info-value--inteiro/);
  const trecho = /<p class="popup-info-value popup-info-value--inteiro">([^<]*)<\/p>/.exec(html);
  assert.ok(trecho, 'não achei o parágrafo do CNPJ');
  assert.equal(trecho[1], '12.345.678/0001-90');
});

test('CNPJ ausente vira travessão em vez de campo vazio', () => {
  const s = criarSandbox();
  const html = s.criarConteudoPopupLinha({ id: 1, nome_fantasia: 'X' });
  assert.match(html, /popup-info-value--inteiro">—</);
});

test('a classe do CNPJ existe na folha de estilo do módulo', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'css', 'prospeccoes.css'), 'utf8');
  assert.match(css, /\.popup-info-value--inteiro\s*\{[^}]*white-space:\s*nowrap/);
  assert.match(css, /\.popup-copiar\s*\{/);
});

test('anotação do cadastro aparece no popover da grade', () => {
  const s = criarSandbox();
  const html = s.criarConteudoPopupLinha({
    id: 1, nome_fantasia: 'X',
    anotacoes: 'Indicada pelo cliente Alpha. Trabalham com bancadas sob medida.'
  });
  assert.match(html, /Anotação do cadastro/);
  assert.match(html, /Indicada pelo cliente Alpha/);
});

test('sem anotação, a seção não aparece', () => {
  const s = criarSandbox();
  const html = s.criarConteudoPopupLinha({ id: 1, nome_fantasia: 'X' });
  assert.equal(html.includes('Anotação do cadastro'), false);
  // Espaço em branco também não conta como anotação.
  const comEspaco = s.criarConteudoPopupLinha({ id: 1, nome_fantasia: 'X', anotacoes: '   ' });
  assert.equal(comEspaco.includes('Anotação do cadastro'), false);
});

test('anotação do cadastro é escapada', () => {
  const s = criarSandbox();
  const html = s.criarConteudoPopupLinha({
    id: 1, nome_fantasia: 'X', anotacoes: '<img src=x onerror=alert(1)>'
  });
  assert.equal(html.includes('<img src=x'), false);
  assert.match(html, /&lt;img/);
});

// ---------------------------------------------------------------------------
// Ícone de trocar responsável na grade
//
// Ele é privativo do Sup Admin. O backend recusa de qualquer jeito (403), mas
// oferecer o botão a quem vai levar negativa é ruim — e o inverso, escondê-lo
// de quem pode, esconde a única porta para a ação.
// ---------------------------------------------------------------------------

/** Renderiza uma linha e devolve o HTML gerado, com Permissoes.supAdmin dado. */
function renderizarLinha(supAdmin, prospeccao) {
  let html = '';
  const linha = {
    className: '', dataset: {},
    set innerHTML(v) { html = v; },
    get innerHTML() { return html; },
    querySelector: () => null,
    // O módulo varre a linha atrás dos ícones travados (`[data-inerte]`).
    querySelectorAll: () => [],
    addEventListener() {}
  };
  const tbody = { innerHTML: '', appendChild() {}, classList: { add() {}, remove() {} } };

  const s = criarSandbox({ prospeccoesTableBody: tbody });
  s.document.createElement = () => linha;
  s.Permissoes = { supAdmin };
  definir(s, 'todasProspeccoes', []);

  vm.runInContext('renderTabela(__lista);', Object.assign(s, {
    __lista: [prospeccao || {
      id: 1, nome_fantasia: 'Marmoraria', etapa: 'Contato', probabilidade: 10, responsavel: 'João'
    }]
  }));
  return html;
}

test('Sup Admin vê o ícone de trocar responsável', () => {
  const html = renderizarLinha(true);
  assert.match(html, /acao-responsavel/);
  assert.match(html, /acao-tabela--responsavel/);
});

test('quem não é Sup Admin não vê o ícone', () => {
  const html = renderizarLinha(false);
  assert.equal(html.includes('acao-responsavel'), false);
  // As demais ações continuam lá — a restrição é só desta.
  assert.match(html, /acao-editar/);
  assert.match(html, /acao-excluir/);
});

test('sem Permissoes carregado, o ícone não aparece', () => {
  // Falha fechada: se as permissões não carregaram, não oferece a ação restrita.
  let html = '';
  const linha = {
    className: '', dataset: {},
    set innerHTML(v) { html = v; }, get innerHTML() { return html; },
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {}
  };
  const s = criarSandbox({ prospeccoesTableBody: { innerHTML: '', appendChild() {}, classList: { add() {}, remove() {} } } });
  s.document.createElement = () => linha;
  definir(s, 'todasProspeccoes', []);
  s.__lista = [{ id: 1, nome_fantasia: 'X', etapa: 'Contato', probabilidade: 0 }];
  vm.runInContext('renderTabela(__lista);', s);
  assert.equal(html.includes('acao-responsavel'), false);
});

test('o módulo publica abrirTrocarResponsavel para o menu', () => {
  // As funções vivem dentro do IIFE do menu.js; sem export explícito, o
  // onclick da grade não alcançaria nada.
  const s = criarSandbox();
  assert.equal(typeof s.ProspeccoesModulo?.abrirTrocarResponsavel, 'function');
});

test('a cor da ação de responsável existe na folha de estilo', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'css', 'prospeccoes.css'), 'utf8');
  assert.match(css, /\.acao-tabela--responsavel\s*\{[^}]*color/);
});

// ---------------------------------------------------------------------------
// Folha de estilo do módulo
//
// O menu carrega apenas `../css/{pagina}.css`. O que a tela de Prospecções usa
// e essa folha não define simplesmente não existe — foi o que aconteceu com o
// botão "Limpar", que ficou sem fundo nenhum.
// ---------------------------------------------------------------------------

const CSS_PROSPECCOES = fs.readFileSync(
  path.join(__dirname, '..', '..', 'css', 'prospeccoes.css'), 'utf8');
const HTML_PROSPECCOES = fs.readFileSync(
  path.join(__dirname, '..', '..', 'html', 'prospeccoes.html'), 'utf8');

test('toda classe btn-* usada na tela existe na folha do módulo', () => {
  const usadas = new Set();
  for (const m of HTML_PROSPECCOES.matchAll(/class="([^"]*)"/g)) {
    for (const c of m[1].split(/\s+/)) if (/^btn-[a-z-]+$/.test(c)) usadas.add(c);
  }
  assert.ok(usadas.size > 0, 'não achei classes btn-* no HTML');

  const semDefinicao = [...usadas].filter(c => !CSS_PROSPECCOES.includes('.' + c + ' {'));
  assert.deepEqual(semDefinicao, [], 'classes sem definição em prospeccoes.css: ' + semDefinicao.join(', '));
});

test('o botão Funil é violeta', () => {
  const botao = /id="btnOcultarGraficoFunil"[\s\S]*?class="([^"]*)"/.exec(HTML_PROSPECCOES);
  assert.ok(botao, 'não achei o botão Funil');
  assert.match(botao[1], /btn-violet/);
  assert.match(CSS_PROSPECCOES, /\.btn-violet\s*\{[^}]*var\(--color-violet\)/);
});

test('os botões da barra de filtros são centrados nos dois eixos', () => {
  // Com `h-12` e conteúdo inline, o ícone e o rótulo assentavam pela linha de
  // base e o texto "Funil" saía do centro.
  const regra = /#bt-actions\s*>\s*button\s*\{([^}]*)\}/.exec(CSS_PROSPECCOES);
  assert.ok(regra, 'faltou a regra de centralização');
  assert.match(regra[1], /align-items:\s*center/);
  assert.match(regra[1], /justify-content:\s*center/);
});

test('esconder o calendário nativo NÃO vale para os modais de prospecção', () => {
  // Os modais de próximo passo / concluir passo têm campo de data e nenhum
  // ícone próprio: uma regra global apagaria a única pista de calendário deles.
  // Um bloco por regra: o seletor é tudo que vem antes do `{`.
  const blocos = CSS_PROSPECCOES.split('}')
    .filter(b => b.includes('calendar-picker-indicator'));
  assert.ok(blocos.length > 0, 'a regra do indicador nativo sumiu');
  for (const bloco of blocos) {
    const seletor = bloco.split('{')[0];
    assert.match(seletor, /#(novo|editar|visualizar)OrcamentoOverlay/,
      'seletor sem escopo de overlay: ' + seletor.trim());
  }
});

test('o modal Concluir Passo usa o tamanho fixo do Detalhes', () => {
  // `max-w-xl` e `max-h-[90vh]` NÃO existem no build offline do Tailwind — sem
  // limite de largura nem de altura, o modal tomava a tela inteira.
  const html = fs.readFileSync(
    path.join(__dirname, '..', '..', 'html', 'modals', 'prospeccoes', 'concluir-passo.html'), 'utf8');
  assert.match(html, /class="modal-prospeccao /);
  assert.match(html, /modal-prospeccao__corpo/);

  // Só o que está em `class="..."` conta — o comentário do arquivo cita as
  // utilitárias justamente para explicar por que saíram.
  const classes = [...html.matchAll(/class="([^"]*)"/g)]
    .flatMap(m => m[1].split(/\s+/));
  assert.equal(classes.includes('max-w-xl'), false);
  assert.equal(classes.includes('max-h-[90vh]'), false);
});

test('as utilitárias de tamanho usadas nos modais existem no build offline', () => {
  // Trava para a armadilha da folha gerada: uma classe ausente não avisa, só
  // deixa o modal sem limite.
  const tw = fs.readFileSync(
    path.join(__dirname, '..', '..', 'styles', 'tailwind-offline.css'), 'utf8');
  const modais = ['concluir-passo', 'detalhes', 'responsavel', 'etapa', 'nota', 'campanha'];
  const faltando = [];
  for (const nome of modais) {
    const caminho = path.join(__dirname, '..', '..', 'html', 'modals', 'prospeccoes', nome + '.html');
    if (!fs.existsSync(caminho)) continue;
    const html = fs.readFileSync(caminho, 'utf8');
    for (const m of html.matchAll(/class="([^"]*)"/g)) {
      for (const c of m[1].split(/\s+/)) {
        if (!/^max-w-|^max-h-|^h-\[/.test(c)) continue;
        const escapada = c.replace(/([.[\]()])/g, '\$1');
        if (!new RegExp('\.' + escapada + '[\s,{:]').test(tw)) faltando.push(nome + ': ' + c);
      }
    }
  }
  assert.deepEqual(faltando, [], 'classes de tamanho inexistentes no build: ' + faltando.join(', '));
});

// ---------------------------------------------------------------------------
// Proteção das ações: duplo clique, carregamento e confirmação de exclusão
//
// A rede automática do BotaoAcao libera o botão rastreando promessas de
// `window.electronAPI`. Este módulo fala por `fetch` com o backend local, então
// sem o registro EXPLÍCITO o bloqueio durava só a janela mínima — dois cliques
// rápidos na lixeira ou no olho empilhavam duas ações.
// ---------------------------------------------------------------------------

/** Elemento mínimo que registra o que foi feito com ele. */
function elementoFalso() {
  return {
    dataset: {},
    classList: { add() {}, remove() {}, contains: () => false },
    ouvintes: [],
    addEventListener(tipo, fn) { this.ouvintes.push({ tipo, fn }); },
    removeAttribute() {}, setAttribute() {}
  };
}

function sandboxDaGrade({ comBotaoAcao = true } = {}) {
  const s = criarSandbox();
  s.registrados = [];
  if (comBotaoAcao) {
    s.BotaoAcao = {
      bind(el, handler) {
        el.dataset.acaoGerida = 'true';
        s.registrados.push({ el, handler });
      }
    };
  }
  return s;
}

test('ícone da grade é registrado pelo BotaoAcao, não por addEventListener', () => {
  const s = sandboxDaGrade();
  const icone = elementoFalso();
  s.__icone = icone;
  s.__acao = () => {};
  vm.runInContext('ligarAcao(__icone, __acao);', s);

  assert.equal(s.registrados.length, 1, 'deveria ter ido para o BotaoAcao');
  assert.equal(icone.dataset.acaoGerida, 'true');
  assert.equal(icone.ouvintes.length, 0, 'não pode registrar o clique por fora da proteção');
});

test('sem BotaoAcao, o ícone ainda funciona', () => {
  // O utilitário é global no menu.html, mas o módulo não pode quebrar se ele
  // faltar — só perde a proteção.
  const s = sandboxDaGrade({ comBotaoAcao: false });
  const icone = elementoFalso();
  s.__icone = icone;
  s.__acao = () => {};
  vm.runInContext('ligarAcao(__icone, __acao);', s);
  assert.equal(icone.ouvintes.length, 1);
});

test('o clique no ícone não vaza para a linha', () => {
  // A linha inteira é clicável e abre a ficha. Sem o stopPropagation, clicar na
  // lixeira abriria a ficha ao mesmo tempo.
  const s = sandboxDaGrade();
  const icone = elementoFalso();
  let chamou = 0;
  s.__icone = icone;
  s.__acao = () => { chamou += 1; return 'feito'; };
  vm.runInContext('ligarAcao(__icone, __acao);', s);

  let parou = 0;
  const retorno = s.registrados[0].handler({ stopPropagation() { parou += 1; } });
  assert.equal(parou, 1, 'stopPropagation não foi chamado');
  assert.equal(chamou, 1);
  // O retorno precisa subir: é a promessa que mantém o ícone carregando.
  assert.equal(retorno, 'feito');
});

test('ligarAcao ignora ícone ausente sem quebrar', () => {
  // `.acao-responsavel` só existe para Sup Admin; nas demais linhas é null.
  const s = sandboxDaGrade();
  s.__acao = () => {};
  assert.doesNotThrow(() => vm.runInContext('ligarAcao(null, __acao);', s));
  assert.equal(s.registrados.length, 0);
});

// ---------------------------------------------------------------------------
// Confirmação de exclusão — checagem no código-fonte
//
// Nenhuma exclusão pode chamar a API direto: todas passam pela caixa de
// diálogo padrão. Guarda contra alguém acrescentar uma lixeira nova e esquecer.
// ---------------------------------------------------------------------------

const FONTE_DETALHES = fs.readFileSync(
  path.join(__dirname, '..', 'modals', 'prospeccao-detalhes.js'), 'utf8');

test('todo tipo de exclusão da ficha tem texto de confirmação próprio', () => {
  // Os `data-remover` desenhados na tela e as chaves de COMO_EXCLUIR precisam
  // bater: um tipo sem entrada simplesmente não apagaria nada.
  const desenhados = new Set(
    [...FONTE_DETALHES.matchAll(/data-remover="([a-z]+)"/g)].map(m => m[1]));
  assert.ok(desenhados.size >= 3, 'esperava nota, campanha e histórico');

  const bloco = /const COMO_EXCLUIR = \{([\s\S]*?)\n  \};/.exec(FONTE_DETALHES);
  assert.ok(bloco, 'não achei o mapa COMO_EXCLUIR');
  const declarados = new Set(
    [...bloco[1].matchAll(/^\s{4}([a-z]+):\s*\{/gm)].map(m => m[1]));

  for (const tipo of desenhados) {
    assert.ok(declarados.has(tipo), `"${tipo}" tem lixeira na tela e nenhuma confirmação`);
  }
});

test('a exclusão de contato pergunta antes', () => {
  const trecho = /data-remover-contato[\s\S]{0,900}?\}\);/.exec(FONTE_DETALHES);
  assert.ok(trecho, 'não achei o handler de remover contato');
  assert.match(trecho[0], /confirmarEExecutar/);
});

test('a confirmação usa o diálogo padrão do sistema e o véu de carregamento', () => {
  const helper = /async function confirmarEExecutar\([\s\S]*?\n  \}/.exec(FONTE_DETALHES);
  assert.ok(helper, 'não achei confirmarEExecutar');
  assert.match(helper[0], /DialogPadrao\?\.confirm/);
  assert.match(helper[0], /BotaoAcao\?\.comCarregamento/);
  // Sem o `if (!ok) return`, cancelar apagaria assim mesmo.
  assert.match(helper[0], /if \(!ok\) return;/);
});

test('remover contato no formulário de edição também pergunta', () => {
  const fonte = fs.readFileSync(
    path.join(__dirname, '..', 'modals', 'prospeccao-form-comum.js'), 'utf8');
  // Ancora no handler, não na primeira aparição da classe (que está no
  // template HTML da linha, algumas dezenas de linhas antes).
  const trecho = /querySelector\('\.acao-remover-contato'\)[\s\S]{0,1400}?\n        \}\);/.exec(fonte);
  assert.ok(trecho, 'não achei o handler do formulário');
  assert.match(trecho[0], /DialogPadrao\?\.confirm/);
  // Só o que já existe no banco merece cerimônia — o que foi digitado agora e
  // nunca saiu da tela não precisa.
  assert.match(trecho[0], /status !== 'new'/);
});

test('nenhum botão de ação da ficha ficou com addEventListener cru', () => {
  const crus = [...FONTE_DETALHES.matchAll(/get\('(detProsp[A-Za-z]+)'\)\?\.addEventListener\('click'/g)]
    .map(m => m[1])
    // A aba de contatos usa delegação de propósito: as linhas são repintadas.
    .filter(id => id !== 'detProspContatos');
  assert.deepEqual(crus, [], 'botões sem proteção: ' + crus.join(', '));
});


// ---------------------------------------------------------------------------
// Ganho e Perdido travam as ações da grade
//
// Negócio encerrado não volta ao funil nem tem a ficha reescrita: isso
// desencontraria o registro do que de fato aconteceu.
// ---------------------------------------------------------------------------

/** Quais ações vieram travadas, pela classe do ícone. */
function acoesTravadas(html) {
  const travadas = [];
  for (const m of html.matchAll(/acao-tabela--([a-z]+) acao-tabela--inerte/g)) {
    travadas.push(m[1]);
  }
  return travadas.sort();
}

const ENCERRADA = { id: 1, nome_fantasia: 'Fechada', etapa: 'Ganho', probabilidade: 100 };
const PERDIDA = { id: 2, nome_fantasia: 'Caiu', etapa: 'Perdido', probabilidade: 0 };
const ATIVA = { id: 3, nome_fantasia: 'Em jogo', etapa: 'Proposta', probabilidade: 65 };

test('prospecção Ganha trava mover, editar e responsável', () => {
  const html = renderizarLinha(true, ENCERRADA);
  assert.deepEqual(acoesTravadas(html), ['editar', 'mover', 'responsavel']);
});

test('prospecção Perdida trava as mesmas ações', () => {
  const html = renderizarLinha(true, PERDIDA);
  assert.deepEqual(acoesTravadas(html), ['editar', 'mover', 'responsavel']);
});

test('prospecção em andamento não trava nada', () => {
  assert.deepEqual(acoesTravadas(renderizarLinha(true, ATIVA)), []);
});

test('ver detalhes continua liberado numa prospecção encerrada', () => {
  // Travar a leitura seria esconder o histórico de quem quer entender o que
  // aconteceu — o oposto do que a regra pede.
  const html = renderizarLinha(true, ENCERRADA);
  assert.match(html, /acao-tabela--ver acao-ver/);
});

test('excluir encerrada é liberado só para o Sup Admin', () => {
  const comSup = renderizarLinha(true, ENCERRADA);
  assert.equal(acoesTravadas(comSup).includes('excluir'), false);
  assert.match(comSup, /acao-tabela--excluir acao-excluir/);

  const semSup = renderizarLinha(false, ENCERRADA);
  assert.ok(acoesTravadas(semSup).includes('excluir'));
});

test('a ação travada perde o gancho do clique', () => {
  // É assim que o handler não chega a ser registrado: a busca pela classe do
  // gancho devolve null e o ligarAcao sai pela porta dos fundos.
  const html = renderizarLinha(true, ENCERRADA);
  assert.equal(html.includes('acao-mover'), false);
  assert.equal(html.includes('acao-editar'), false);
  assert.match(html, /data-inerte="true"/);
});

test('o motivo da trava vai no title', () => {
  const html = renderizarLinha(true, PERDIDA);
  assert.match(html, /title="Prospecção Perdido — negociação encerrada"/);
});

test('a classe da ação travada existe na folha de estilo', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'css', 'prospeccoes.css'), 'utf8');
  const regra = /\.acao-tabela--inerte\s*\{([^}]*)\}/.exec(css);
  assert.ok(regra, 'faltou a classe .acao-tabela--inerte');
  // Sem pointer-events: none — ele mataria o tooltip junto com o clique, e o
  // title é onde está a explicação do bloqueio.
  assert.equal(/pointer-events/.test(regra[1]), false);
});
