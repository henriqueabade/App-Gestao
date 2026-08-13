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
