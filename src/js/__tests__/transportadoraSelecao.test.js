/**
 * O seletor de transportadora do orçamento (src/js/utils/transportadoras.js).
 *
 * "Não Definida" é um VALOR, não um vazio. A transportadora é gravada no
 * orçamento como texto, e a conversão em pedido exige que ela não seja vazia —
 * é ela que diz como a peça sai da fábrica. Só que nem todo orçamento nasce
 * sabendo: o cliente ainda vai dizer, ou a entrega é retirada. Antes disto o
 * campo ficava em branco e o orçamento não podia ser salvo.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ARQUIVO = path.join(__dirname, '..', 'utils', 'transportadoras.js');

// ---------------------------------------------------------------------------
// Duplo de DOM
// ---------------------------------------------------------------------------

function criarElemento(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(),
    id: '', textContent: '', disabled: false, selected: false, hidden: false,
    filhos: [], dataset: {}, atributos: {}, _value: ''
  };

  el.appendChild = f => { el.filhos.push(f); return f; };
  el.replaceChildren = (...novos) => { el.filhos = novos; };
  el.setAttribute = (n, v) => { el.atributos[n] = String(v); };
  el.getAttribute = n => el.atributos[n] ?? null;

  // `value` de um `<select>` só aceita o que existe entre as opções: atribuir
  // um valor ausente não erra, simplesmente não muda nada. Sem isto o duplo
  // deixaria passar código que "seleciona" uma opção inexistente.
  Object.defineProperty(el, 'value', {
    get() { return el._value; },
    set(v) {
      const alvo = v === null || v === undefined ? '' : String(v);
      if (el.tagName !== 'SELECT') { el._value = alvo; return; }
      if (alvo === '' || el.filhos.some(o => o.value === alvo)) el._value = alvo;
    }
  });

  Object.defineProperty(el, 'options', { get() { return el.filhos; } });
  Object.defineProperty(el, 'selectedIndex', {
    get() { return el.filhos.findIndex(o => o.value === el._value); }
  });

  return el;
}

/** Carrega o utilitário com um `fetch` de mentira e devolve o que publicou. */
function montar(rotas = {}) {
  const chamadas = [];
  const sandbox = {
    document: { createElement: criarElemento },
    apiConfig: { getApiBaseUrl: async () => 'http://local' },
    fetch: async (url, opcoes = {}) => {
      const metodo = opcoes.method || 'GET';
      chamadas.push({ url, metodo, corpo: opcoes.body ? JSON.parse(opcoes.body) : null });
      const r = rotas[`${metodo} ${new URL(url).pathname}`] || rotas[metodo];
      const resposta = typeof r === 'function' ? r() : r;
      return {
        ok: (resposta?.status || 200) < 400,
        status: resposta?.status || 200,
        json: async () => resposta?.corpo ?? []
      };
    },
    URL, JSON, Array, Number, String, Object, console, encodeURIComponent
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(ARQUIVO, 'utf8'), sandbox, { filename: 'transportadoras.js' });

  return { T: sandbox.Transportadoras, chamadas };
}

const nomes = select => select.options.filter(o => o.value).map(o => o.value);

// ---------------------------------------------------------------------------
// "Não Definida"
// ---------------------------------------------------------------------------

test('"Não Definida" existe sempre, e vem antes das outras', async () => {
  const { T } = montar({
    GET: { corpo: [{ id: 1, nome: 'Rodonaves' }, { id: 2, nome: 'Braspress' }] }
  });
  const select = criarElemento('select');
  await T.carregar(select, 50);

  // Enterrá-la no fim de uma lista de quinze transportadoras é o mesmo que
  // escondê-la: é a escolha de quem ainda não sabe, e quem não sabe procura no
  // começo.
  assert.deepStrictEqual(nomes(select), ['Não Definida', 'Rodonaves', 'Braspress']);
});

test('cliente sem transportadora nenhuma ainda pode escolher', async () => {
  const { T } = montar({ GET: { corpo: [] } });
  const select = criarElemento('select');
  await T.carregar(select, 50);

  // Sem "Não Definida" aqui, o campo — que é `required` — ficaria impossível
  // de preencher, e o orçamento inteiro travava por causa de um cadastro que
  // ninguém tinha feito ainda.
  assert.deepStrictEqual(nomes(select), ['Não Definida']);
});

test('erro de rede não tira a saída de quem precisa salvar', async () => {
  const { T } = montar({ GET: { status: 500, corpo: { error: 'fora do ar' } } });
  const select = criarElemento('select');
  await T.carregar(select, 50);

  // Um erro de rede não pode ser o que impede alguém de salvar o orçamento.
  assert.deepStrictEqual(nomes(select), ['Não Definida']);
});

test('"Não Definida" é escolhível de verdade', async () => {
  const { T } = montar({ GET: { corpo: [{ id: 1, nome: 'Rodonaves' }] } });
  const select = criarElemento('select');
  await T.carregar(select, 50);

  select.value = T.NAO_DEFINIDA;
  assert.strictEqual(select.value, 'Não Definida');

  // E não tem cadastro para excluir: ela é a resposta de quem ainda não sabe,
  // não uma empresa.
  assert.strictEqual(T.idEscolhido(select), null);
});

test('o valor da opção é o NOME, não o id', async () => {
  const { T } = montar({ GET: { corpo: [{ id: 7, nome: 'Rodonaves' }] } });
  const select = criarElemento('select');
  await T.carregar(select, 50);

  // É o nome que o orçamento grava — o id não sobrevive à gravação. Com o id
  // no valor, o orçamento sairia com "7" escrito no campo de transportadora.
  select.value = 'Rodonaves';
  assert.strictEqual(select.value, 'Rodonaves');

  // O id fica à mão para quem for excluir.
  assert.strictEqual(T.idEscolhido(select), 7);
});

// ---------------------------------------------------------------------------
// Cadastrar e excluir
// ---------------------------------------------------------------------------

test('cadastrar repinta a lista e deixa a nova escolhida', async () => {
  const { T, chamadas } = montar({
    'POST /api/transportadoras': {
      status: 201,
      corpo: {
        nome: 'Rodonaves Express',
        id: 9,
        transportadoras: [{ id: 9, nome: 'Rodonaves Express' }]
      }
    }
  });
  const select = criarElemento('select');

  await T.cadastrar({ select, clienteId: 50, nome: '  rodonaves express ' });

  // O nome vai como a pessoa digitou: quem normaliza é o servidor, porque é
  // ele que atende todo caminho que cria uma.
  assert.strictEqual(chamadas.at(-1).corpo.transportadora, '  rodonaves express ');
  assert.strictEqual(chamadas.at(-1).corpo.id_cliente, 50);

  // Recém-cadastrada já vem escolhida: quem acabou de cadastrar é porque quer
  // usar aquela.
  assert.strictEqual(select.value, 'Rodonaves Express');
  assert.deepStrictEqual(nomes(select), ['Não Definida', 'Rodonaves Express']);
});

test('excluir repinta e não deixa nada escolhido', async () => {
  const { T, chamadas } = montar({
    'DELETE /api/transportadoras/9': {
      corpo: { sucesso: true, id: 9, transportadoras: [{ id: 3, nome: 'Braspress' }] }
    }
  });
  const select = criarElemento('select');

  await T.excluir({ select, clienteId: 50, id: 9 });

  // O cliente vai na consulta: sem ele o servidor não tem como conferir que a
  // transportadora é mesmo desta empresa.
  assert.match(chamadas.at(-1).url, /id_cliente=50/);

  assert.deepStrictEqual(nomes(select), ['Não Definida', 'Braspress']);
  assert.strictEqual(select.value, '', 'ficou com a transportadora que acabou de sumir');
});

test('a recusa do servidor chega a quem chamou', async () => {
  const { T } = montar({
    'POST /api/transportadoras': {
      status: 409,
      corpo: { error: '"Rodonaves" já está cadastrada para este cliente' }
    }
  });
  const select = criarElemento('select');

  // Duplicata é o caso comum. Engolir a recusa deixaria a pessoa achando que
  // cadastrou, e a lista sem a linha nova.
  await assert.rejects(
    () => T.cadastrar({ select, clienteId: 50, nome: 'Rodonaves' }),
    /já está cadastrada/
  );
});

test('a escolha anterior sobrevive ao repinte', async () => {
  const { T } = montar({
    GET: { corpo: [{ id: 1, nome: 'Rodonaves' }, { id: 2, nome: 'Braspress' }] }
  });
  const select = criarElemento('select');

  await T.carregar(select, 50);
  select.value = 'Braspress';

  // Recarregar a mesma lista — a restauração de trabalho faz isso — não pode
  // apagar o que a pessoa escolheu.
  await T.carregar(select, 50);
  assert.strictEqual(select.value, 'Braspress');
});

// ---------------------------------------------------------------------------
// As DUAS telas de orçamento se comportam igual
//
// "Novo" e "Editar" tinham cada uma a sua cópia da montagem do seletor, e as
// duas já haviam divergido: a de lá ganhou "Não Definida" e a daqui não. A
// mesma escolha existia numa tela e não na outra, e quem editava um orçamento
// não conseguia fazer o que quem criava um fazia.
// ---------------------------------------------------------------------------

const MODAIS_DE_ORCAMENTO = [
  { nome: 'Novo Orçamento', js: 'orcamento-novo.js', html: 'novo.html', prefixo: 'novo' },
  { nome: 'Editar Orçamento', js: 'orcamento-editar.js', html: 'editar.html', prefixo: 'editar' }
];

const lerJs = arquivo =>
  fs.readFileSync(path.join(__dirname, '..', 'modals', arquivo), 'utf8');
const lerHtml = arquivo =>
  fs.readFileSync(path.join(__dirname, '..', '..', 'html', 'modals', 'orcamentos', arquivo), 'utf8');

test('as duas telas montam o seletor pelo MESMO utilitário', () => {
  for (const modal of MODAIS_DE_ORCAMENTO) {
    const js = lerJs(modal.js);

    assert.match(js, /window\.Transportadoras\?\.carregar\(/,
      `${modal.nome}: não usa o utilitário para carregar`);

    // A cópia antiga montava as opções à mão. Enquanto existir, ela volta a
    // divergir na primeira mudança — foi assim que "Não Definida" ficou só
    // numa das telas.
    assert.doesNotMatch(js, /opt\.value = tp\.id/,
      `${modal.nome}: voltou a montar as opções por conta própria`);
  }
});

test('as duas telas têm os botões de cadastrar e excluir', () => {
  for (const modal of MODAIS_DE_ORCAMENTO) {
    const html = lerHtml(modal.html);
    const js = lerJs(modal.js);

    for (const acao of ['Add', 'Del']) {
      const id = `${modal.prefixo}Transportadora${acao}`;
      assert.ok(html.includes(`id="${id}"`), `${modal.nome}: falta o botão ${id}`);
      assert.ok(js.includes(id), `${modal.nome}: o botão ${id} não está ligado a nada`);
    }
  }
});

test('as duas telas gravam o NOME, não o id da opção', () => {
  for (const modal of MODAIS_DE_ORCAMENTO) {
    const js = lerJs(modal.js);

    // O valor da opção é o nome — é o nome que o orçamento grava, e o id não
    // sobrevive à gravação. Ler o `textContent` dava o mesmo por um caminho
    // mais frágil: bastava um espaço a mais na marcação.
    assert.doesNotMatch(js, /Transportadora\.options\[[^\]]+selectedIndex\]\?\.textContent/,
      `${modal.nome}: ainda lê o texto da opção em vez do valor`);
  }
});

test('as duas telas protegem o segundo clique e pedem confirmação', () => {
  for (const modal of MODAIS_DE_ORCAMENTO) {
    const js = lerJs(modal.js);

    // Dois cliques cadastram a mesma transportadora duas vezes, e a segunda só
    // é recusada depois de ir ao servidor.
    assert.match(js, /BotaoAcao\?\.bind/,
      `${modal.nome}: os botões não travam o segundo clique`);

    // Excluir não tem volta.
    assert.match(js, /DialogPadrao\?\.confirm/,
      `${modal.nome}: exclui sem confirmar`);
  }
});

test('as duas telas reaproveitam o sub-modal que pede o nome', () => {
  for (const modal of MODAIS_DE_ORCAMENTO) {
    const js = lerJs(modal.js);

    // Uma segunda tela para pedir um nome divergiria desta na aparência, no
    // tratamento de Esc e na proteção do segundo envio.
    assert.match(js, /modals\/clientes\/transportadora\.html/,
      `${modal.nome}: não usa o sub-modal do cadastro de cliente`);

    // E soltam a promessa quando a pessoa desiste: sem isso o botão fica em
    // carregando para sempre.
    //
    // A escuta E a remoção dela: procurar só o nome do evento passaria com a
    // escuta apagada, porque a remoção também o menciona.
    assert.match(js, /addEventListener\('modalFechado'/,
      `${modal.nome}: não escuta o fechamento sem salvar`);
    assert.match(js, /removeEventListener\('modalFechado'/,
      `${modal.nome}: deixa a escuta pendurada depois de responder`);
  }
});

test('o parcelamento das duas telas vem do mesmo lugar', () => {
  for (const modal of MODAIS_DE_ORCAMENTO) {
    const js = lerJs(modal.js);

    // O teto de parcelas é do utilitário. Uma tela que montasse o próprio
    // seletor continuaria em 5 sem ninguém notar.
    assert.match(js, /Parcelamento\.init\(/,
      `${modal.nome}: não usa o parcelamento compartilhado`);
    assert.doesNotMatch(js, /<option value="5">5<\/option>/,
      `${modal.nome}: tem uma lista de parcelas própria`);
  }
});
