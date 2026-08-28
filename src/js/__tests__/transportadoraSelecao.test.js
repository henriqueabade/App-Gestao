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
