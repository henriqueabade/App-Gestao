/**
 * Quando a leitura aponta para uma peça ou um cliente que JÁ existe.
 *
 * ---------------------------------------------------------------------------
 * O QUE ACONTECIA
 *
 * Escolher, na linha, a peça ou o cliente que a leitura casou é dizer "é este".
 * Mas o botão continuava abrindo o formulário de CADASTRO — ou seja, pedindo
 * para criar um SEGUNDO registro da mesma coisa. Salvo, o programa passava a
 * ter dois "Móveis Aurora", cada um com metade dos contatos, e nada no sistema
 * volta a juntá-los depois.
 *
 * ---------------------------------------------------------------------------
 * AS DUAS REGRAS SÃO OPOSTAS DE PROPÓSITO
 *
 * CAMPOS — só os VAZIOS. O que está na tela veio do banco e foi conferido por
 *          alguém; o documento é palpite de leitura automática. Completar o que
 *          falta ajuda; trocar o CNPJ conferido pelo que o OCR leu de um
 *          carimbo torto, calado, estraga.
 *
 * LISTAS — SOMA. Contato e insumo não se substituem: um cliente tem vários
 *          contatos, uma peça vários insumos. O que já está lá fica; o que a
 *          leitura trouxe e não está lá entra como registro NOVO.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const raiz = path.join(__dirname, '..', '..', '..');
const ler = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const detalhes = () => ler('src', 'js', 'modals', 'ia-detalhes.js');

/** Recorta o trecho que vai de `de` até (exclusive) `ate`. */
function recortar(texto, de, ate) {
  const i = texto.indexOf(de);
  const f = texto.indexOf(ate, i + 1);
  assert.ok(i >= 0, `não achei "${de}"`);
  assert.ok(f > i, `não achei "${ate}" depois de "${de}"`);
  return texto.slice(i, f);
}

/**
 * As funções de junção, executadas de verdade.
 *
 * O recorte vai de `chaveDeContato` até `abrirNoModulo` e leva junto
 * `chaveDeInsumo`, `somenteOsQueFaltam` e `SOMAR_NO_REGISTRO`. Cada coisa
 * fingida no contexto é uma coisa que o teste NÃO mede: as duas APIs dos
 * modais de editar e o disparo de evento.
 */
function montar({ contatosNaFicha = [], insumosNaFicha = [] } = {}) {
  const trecho = recortar(detalhes(),
    '  function chaveDeContato(contato) {', '  function rotuloDoDestino(item) {');

  const eventos = [];
  const adicionados = [];

  const contexto = {
    console,
    Set,
    String,
    Number,
    Array,
    CustomEvent: class { constructor(nome, init) { this.type = nome; this.detail = init?.detail; } },
    window: {
      clienteEditarAPI: { obterContatos: () => contatosNaFicha.map(c => ({ ...c })) },
      produtoEditarAPI: {
        obterItens: () => insumosNaFicha.map(i => ({ ...i })),
        adicionarProcessoItens: arr => adicionados.push(...arr)
      },
      dispatchEvent: e => eventos.push(e)
    }
  };
  vm.createContext(contexto);
  // As declarações de função entram sozinhas no contexto; `const`, não. Sem a
  // linha extra, `SOMAR_NO_REGISTRO` fica invisível daqui e os testes dele
  // passariam a testar `undefined`.
  vm.runInContext(`${trecho}\nglobalThis.SOMAR_NO_REGISTRO = SOMAR_NO_REGISTRO;`, contexto);

  return { contexto, eventos, adicionados };
}

// ---------------------------------------------------------------------------
// Identidade de um contato
// ---------------------------------------------------------------------------

test('o e-mail identifica o contato antes do nome', () => {
  const { contexto } = montar();

  // O mesmo e-mail é a mesma pessoa, ainda que o documento escreva o nome de
  // outro jeito. O contrário — casar por nome — juntaria dois "João Silva"
  // diferentes da mesma empresa.
  assert.equal(
    contexto.chaveDeContato({ nome: 'Maria Silva', email: 'MARIA@aurora.com' }),
    contexto.chaveDeContato({ nome: 'MARIA S.', email: 'maria@aurora.com  ' })
  );
});

test('sem e-mail, o telefone conta só os dígitos', () => {
  const { contexto } = montar();

  // O cadastro guarda "(11) 99999-0000" e o documento traz "11999990000".
  // Comparados como texto, seriam duas pessoas — e a ficha ganharia o mesmo
  // contato duas vezes.
  assert.equal(
    contexto.chaveDeContato({ nome: 'Ana', telefone_celular: '(11) 99999-0000' }),
    contexto.chaveDeContato({ nome: 'Ana', telefone_celular: '11999990000' })
  );
});

test('sem e-mail nem telefone, sobra o nome', () => {
  const { contexto } = montar();
  assert.equal(
    contexto.chaveDeContato({ nome: '  Carlos Souza ' }),
    contexto.chaveDeContato({ nome: 'carlos souza' })
  );
});

test('contatos sem nada em comum são pessoas diferentes', () => {
  const { contexto } = montar();
  assert.notEqual(
    contexto.chaveDeContato({ nome: 'Ana', email: 'ana@x.com' }),
    contexto.chaveDeContato({ nome: 'Ana', email: 'ana@y.com' })
  );
});

// ---------------------------------------------------------------------------
// Identidade de um insumo dentro da peça
// ---------------------------------------------------------------------------

test('o mesmo insumo em processos diferentes são duas linhas', () => {
  const { contexto } = montar();

  // A mesma cola entra em Marcenaria e em Montagem, com quantidades
  // diferentes. Tratá-las como uma só faria a segunda sumir da ficha.
  assert.notEqual(
    contexto.chaveDeInsumo({ insumo_id: 7, processo: 'Marcenaria' }),
    contexto.chaveDeInsumo({ insumo_id: 7, processo: 'Montagem' })
  );
});

test('o insumo é identificado pelo id, não pelo nome', () => {
  const { contexto } = montar();

  // O nome vem do documento e varia; o id vem do cadastro de Matéria-prima e
  // é o que a ficha grava.
  assert.equal(
    contexto.chaveDeInsumo({ insumo_id: 7, nome: 'Cola Branca', processo: 'Marcenaria' }),
    contexto.chaveDeInsumo({ insumo_id: 7, nome: 'COLA PVA', processo: 'marcenaria' })
  );
});

// ---------------------------------------------------------------------------
// A soma
// ---------------------------------------------------------------------------

test('só entra o que a ficha ainda não tem', () => {
  const { contexto } = montar();
  const naFicha = [{ nome: 'Ana', email: 'ana@x.com' }];
  const daLeitura = [
    { nome: 'Ana Paula', email: 'ana@x.com' },
    { nome: 'Bruno', email: 'bruno@x.com' }
  ];

  const r = contexto.somenteOsQueFaltam(daLeitura, naFicha, contexto.chaveDeContato);
  assert.deepEqual(Array.from(r.novos, c => c.nome), ['Bruno']);
  assert.equal(r.repetidos.length, 1,
    'o que já estava lá é contado para poder ser dito — somar em silêncio o '
    + 'que já existia é tão ruim quanto duplicar em silêncio');
});

test('documento que repete o mesmo contato não o insere duas vezes', () => {
  const { contexto } = montar();
  const daLeitura = [
    { nome: 'Bruno', email: 'bruno@x.com' },
    { nome: 'Bruno Costa', email: 'bruno@x.com' }
  ];

  const r = contexto.somenteOsQueFaltam(daLeitura, [], contexto.chaveDeContato);
  assert.equal(r.novos.length, 1, 'a segunda ocorrência é a mesma pessoa');
  assert.equal(r.repetidos.length, 1);
});

test('ficha vazia recebe tudo', () => {
  const { contexto } = montar();
  const daLeitura = [{ nome: 'Ana', email: 'a@x.com' }, { nome: 'Bruno', email: 'b@x.com' }];
  const r = contexto.somenteOsQueFaltam(daLeitura, [], contexto.chaveDeContato);
  assert.equal(r.novos.length, 2);
  assert.equal(r.repetidos.length, 0);
});

// ---------------------------------------------------------------------------
// O que chega ao modal de editar
// ---------------------------------------------------------------------------

test('os contatos novos entram pelo caminho do próprio modal', () => {
  const { contexto, eventos } = montar({
    contatosNaFicha: [{ nome: 'Ana', email: 'ana@x.com' }]
  });

  const r = contexto.SOMAR_NO_REGISTRO.clientes({
    contatos: [
      { nome: 'Ana Paula', email: 'ana@x.com', principal: true },
      { nome: 'Bruno', email: 'bruno@x.com', principal: false }
    ]
  });

  assert.equal(r.quantos, 1);
  assert.equal(r.repetidos, 1);

  // É o MESMO evento que o sub-modal de contato dispara, e é ele que marca
  // `status: 'new'` — a marca que faz o salvamento INSERIR em vez de atualizar.
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].type, 'clienteContatoAdicionado');
  assert.equal(eventos[0].detail.nome, 'Bruno');
});

test('o contato somado não chega reivindicando ser o principal', () => {
  const { contexto, eventos } = montar({ contatosNaFicha: [{ nome: 'Ana', email: 'a@x.com' }] });

  contexto.SOMAR_NO_REGISTRO.clientes({
    contatos: [{ nome: 'Bruno', email: 'b@x.com', principal: true }]
  });

  // `principal` é de quem CRIA a empresa. Numa ficha que já existe o principal
  // já foi escolhido, e chegar marcando outro trocaria por baixo quem responde
  // pelo cliente.
  assert.equal('principal' in eventos[0].detail, false);
});

test('os insumos novos entram pela API do modal de peça', () => {
  const { contexto, adicionados } = montar({
    insumosNaFicha: [{ insumo_id: 7, processo: 'Marcenaria', ordem: 3 }]
  });

  const r = contexto.SOMAR_NO_REGISTRO.produto_insumos({
    insumos: [
      { insumo_id: 7, nome: 'Cola', processo: 'Marcenaria', quantidade: 2, ordem: 0 },
      { insumo_id: 9, nome: 'Verniz', processo: 'Acabamento', quantidade: 1, ordem: 1 }
    ]
  });

  assert.equal(r.quantos, 1);
  assert.equal(r.repetidos, 1);
  assert.equal(adicionados.length, 1);
  assert.equal(adicionados[0].insumo_id, 9);

  // A `ordem` da leitura conta do zero; quem acrescenta continua a ordem da
  // ficha. Uma ordem herdada colidiria com as que já estão lá.
  assert.equal('ordem' in adicionados[0], false);
});

test('leitura sem lista não mexe em nada', () => {
  const { contexto, eventos, adicionados } = montar();

  assert.equal(contexto.SOMAR_NO_REGISTRO.clientes({}).quantos, 0);
  assert.equal(contexto.SOMAR_NO_REGISTRO.produto_insumos({}).quantos, 0);
  assert.equal(eventos.length, 0);
  assert.equal(adicionados.length, 0);
});

// ---------------------------------------------------------------------------
// A ligação com o resto — o que um `grep` alcança
// ---------------------------------------------------------------------------

test('os dois destinos declaram o modal de editar', () => {
  const js = detalhes();

  for (const [destino, overlay] of [['clientes', 'editarCliente'], ['produto_insumos', 'editarProduto']]) {
    const bloco = js.slice(js.indexOf(`    ${destino}: {`), js.indexOf(`    ${destino}: {`) + 1400);
    assert.match(bloco, /edicao: \{/, `${destino}: falta o modal de editar`);
    assert.ok(bloco.includes(`overlay: '${overlay}'`), `${destino}: overlay errado`);
    assert.match(bloco, /contexto: registro =>/,
      `${destino}: os modais de editar recebem o registro por variável global, `
      + 'e alguém tem de pô-lo lá antes de abrir');
  }
});

test('o registro do alvo vem do backend, inteiro', () => {
  const backend = ler('backend', 'iaPreenchimento.js');

  // A tela precisa do registro para `window.produtoSelecionado` /
  // `window.clienteEditar`. Ele já foi buscado ali para tirar o nome; deixar a
  // tela buscá-lo de novo seria uma segunda ida ao servidor pelo mesmo dado.
  assert.match(backend, /registro: achado/,
    'o alvo precisa levar o registro inteiro, não só o nome');
});

test('campos só completam; listas somam', () => {
  const js = detalhes();

  assert.match(js, /somenteVazios: editando/,
    'editando, a leitura não pode escrever por cima do que veio do banco');

  // O caminho da restauração SUBSTITUI a lista inteira. Usado aqui, a ficha
  // perderia os contatos e os insumos que ela já tinha.
  assert.match(js, /const conteudo = editando\s*\r?\n\s*\? null/,
    'editando, o conteúdo não pode ir pelo caminho que substitui');
});

test('a espera é maior quando o modal ainda vai buscar o registro', () => {
  const js = detalhes();

  // O modal de editar busca o registro DEPOIS de abrir. Desistir cedo faria o
  // preenchimento acontecer antes dos dados, e a resposta do banco apagaria
  // tudo em seguida.
  assert.match(js, /abrirPorCima\(alvoAberto, \{ limiteMs: editando \? \d+ : \d+ \}\)/,
    'a espera precisa ser maior ao editar');
});

test('os modais de editar avisam que salvaram', () => {
  // Sem o aviso, a linha da leitura fica pendente para sempre mesmo depois de
  // a peça ou o cliente ter sido salvo: a revisão não gravou nada e não fica
  // olhando o banco.
  for (const [arquivo, overlay] of [
    ['produto-editar.js', 'editarProduto'],
    ['cliente-editar.js', 'editarCliente']
  ]) {
    const js = ler('src', 'js', 'modals', arquivo);
    assert.ok(
      js.includes(`new CustomEvent('moduloSalvou', { detail: { overlay: '${overlay}' } })`),
      `${arquivo}: não anuncia o salvamento`);
  }
});

test('o botão diz qual formulário vai abrir', () => {
  const js = detalhes();

  // Prometer "Novo Cliente" e abrir a ficha de um cliente que já existe é o
  // tipo de surpresa que faz a pessoa fechar achando que clicou errado.
  assert.match(js, /const rotulo = rotuloDoDestino\(proxima\);/);
  assert.match(js, /function apontaParaExistente\(item\)/);
});

test('no orçamento, apontar para um cliente NÃO é editar aquele cliente', () => {
  const js = detalhes();

  // Ali o alvo é um vínculo: o orçamento NOVO se prende ao cliente. Abrir a
  // ficha do cliente seria abrir o formulário errado.
  const bloco = js.slice(js.indexOf('    orcamentos: {'), js.indexOf('    orcamentos: {') + 700);
  assert.doesNotMatch(bloco, /edicao: \{/,
    'orçamentos não pode declarar modal de editar: o alvo dele é vínculo');
});
