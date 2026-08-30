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
 * LISTAS — SOMAM. Contato e insumo não se substituem: um cliente tem vários
 *          contatos, uma peça vários insumos. O que já está lá fica, e o que a
 *          leitura trouxe entra como registro NOVO.
 *
 *          As duas listas divergem num ponto, e o motivo é o programa e não o
 *          gosto: CONTATO é conferido contra o que a ficha já tem, porque dois
 *          contatos iguais viram dois registros e ficam. INSUMO não é — o
 *          modal de peça já junta as linhas do mesmo insumo no salvamento e
 *          soma as quantidades, avisando. Conferir aqui seria uma segunda
 *          regra sobre a mesma coisa, e esconderia do revisor que o documento
 *          trouxe uma quantidade diferente da que a peça tinha.
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
 * O recorte vai de `chaveDeContato` até `rotuloDoDestino` e leva junto
 * `somenteOsQueFaltam` e `SOMAR_NO_REGISTRO`. Cada coisa fingida no contexto é
 * uma coisa que o teste NÃO mede: as duas APIs dos modais de editar e o
 * disparo de evento.
 */
function montar({ contatosNaFicha = [], insumosNaFicha = [], resposta = {} } = {}) {
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
        adicionarProcessoItens: arr => { adicionados.push(...arr); return resposta; }
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

test('a leitura inteira vai para o modal, sem conferência prévia', () => {
  const { contexto, adicionados } = montar({
    insumosNaFicha: [{ insumo_id: 7, processo: 'Marcenaria', quantidade: 5, ordem: 3 }]
  });

  contexto.SOMAR_NO_REGISTRO.produto_insumos({
    insumos: [
      { insumo_id: 7, nome: 'Cola', processo: 'Marcenaria', quantidade: 2, ordem: 0 },
      { insumo_id: 9, nome: 'Verniz', processo: 'Acabamento', quantidade: 1, ordem: 1 }
    ]
  });

  // Quem decide o que é repetido é o modal da peça, que é quem conhece a ficha
  // e a regra do banco. Conferir aqui também seria uma segunda regra sobre a
  // mesma coisa, e as duas divergiriam.
  assert.deepEqual(Array.from(adicionados, i => i.insumo_id), [7, 9]);

  // A `ordem` da leitura conta do zero; quem acrescenta continua a ordem da
  // ficha. Uma ordem herdada colidiria com as que já estão lá.
  assert.equal('ordem' in adicionados[0], false);
});

test('o que foi somado numa linha existente é contado à parte', () => {
  const { contexto } = montar({ resposta: { acrescentados: 1, somados: 1 } });

  const r = contexto.SOMAR_NO_REGISTRO.produto_insumos({
    insumos: [{ insumo_id: 7, quantidade: 2 }, { insumo_id: 9, quantidade: 1 }]
  });

  assert.equal(r.quantos, 2, 'os dois vieram da leitura');
  assert.equal(r.somadosNaLinha, 1,
    'é a linha que JÁ estava lá que mudou de quantidade, e é ela que precisa '
    + 'ser conferida — dizer só "2 insumos" esconderia isso');
});

// ---------------------------------------------------------------------------
// O insumo repetido, no modal da peça
//
// O banco tem `UNIQUE (produto_codigo, insumo_id)`: a mesma peça NÃO pode
// listar o mesmo insumo duas vezes. Uma segunda linha existia na tela até o
// salvamento e morria lá, com um erro cru do Postgres na cara de quem só
// queria salvar — depois de toda a revisão.
// ---------------------------------------------------------------------------

/** `adicionarProcessoItens` e o que ela usa, recortados do modal de peça. */
function montarAdicionar({ naFicha = [], etapas = [] } = {}) {
  const fonte = ler('src', 'js', 'modals', 'produto-editar.js');

  const partes = [
    fonte.slice(fonte.indexOf('    const semAcentoMinusculo ='),
      fonte.indexOf('    const normalizarNomeColecao =')),
    fonte.slice(fonte.indexOf('    function chaveDoInsumo(item, indice){'),
      fonte.indexOf('    function normalizeItensParaSalvar(){')),
    fonte.slice(fonte.indexOf('    function processoJaUsado(nome) {'),
      fonte.indexOf('    // API para comunicação com outros modais')),
    fonte.slice(fonte.indexOf('      adicionarProcessoItens(arr){'),
      fonte.indexOf('      obterItens(){'))
  ];

  const contexto = {
    String, Number, parseFloat,
    itens: naFicha,
    etapasOrdem: etapas,
    renderItens: () => {}
  };
  vmSecao.createContext(contexto);
  // O corpo do método vira função solta: o objeto da API não cabe no recorte.
  vmSecao.runInContext(
    `${partes[0]}\n${partes[1]}\n${partes[2]}\nfunction adicionar${partes[3].slice(partes[3].indexOf('(arr){')).replace(/,\s*$/, '')}\nglobalThis.adicionar = adicionar;`,
    contexto);
  return contexto;
}

test('insumo que a ficha já tem SOMA na linha dele', () => {
  const ficha = [
    { id: 100, insumo_id: 7, nome: 'Cola', processo: 'Marcenaria', quantidade: 5, status: 'unchanged' }
  ];
  const ctx = montarAdicionar({ naFicha: ficha });

  const r = ctx.adicionar([{ insumo_id: 7, nome: 'Cola', processo: 'MARCENARIA', quantidade: 3 }]);

  assert.equal(ficha.length, 1, 'a segunda linha não cabe no banco');
  assert.equal(ficha[0].quantidade, 8, '5 que estavam lá + 3 que a leitura trouxe');
  assert.equal(ficha[0].status, 'updated', 'a linha existente é ATUALIZADA, não inserida');
  assert.deepEqual({ ...r }, { acrescentados: 0, somados: 1 });
});

test('insumo novo entra como linha nova', () => {
  const ficha = [
    { id: 100, insumo_id: 7, processo: 'Marcenaria', quantidade: 5, status: 'unchanged', ordem: 3 }
  ];
  const ctx = montarAdicionar({ naFicha: ficha, etapas: ['Marcenaria', 'Acabamento'] });

  const r = ctx.adicionar([{ insumo_id: 9, nome: 'Verniz', processo: 'ACABAMENTO', quantidade: 1 }]);

  assert.equal(ficha.length, 2);
  assert.equal(ficha[1].status, 'new');
  assert.equal(ficha[1].ordem, 4, 'a ordem continua a da ficha');
  assert.equal(ficha[1].processo, 'Acabamento', 'com a grafia que a ficha já usa');
  assert.deepEqual({ ...r }, { acrescentados: 1, somados: 0 });
});

test('a linha somada NÃO muda de seção', () => {
  const ficha = [
    { id: 100, insumo_id: 7, processo: 'Marcenaria', quantidade: 5, status: 'unchanged' }
  ];
  const ctx = montarAdicionar({ naFicha: ficha, etapas: ['Marcenaria', 'Montagem'] });

  ctx.adicionar([{ insumo_id: 7, processo: 'Montagem', quantidade: 1 }]);

  // Mudá-la de seção porque o documento escreveu outro processo moveria um
  // insumo que alguém já posicionou na ficha.
  assert.equal(ficha[0].processo, 'Marcenaria');
  assert.equal(ficha[0].quantidade, 6);
});

test('linha marcada para exclusão não recebe a soma', () => {
  const ficha = [
    { id: 100, insumo_id: 7, processo: 'Marcenaria', quantidade: 5, status: 'deleted' }
  ];
  const ctx = montarAdicionar({ naFicha: ficha });

  ctx.adicionar([{ insumo_id: 7, processo: 'Marcenaria', quantidade: 3 }]);

  // Somar numa linha que vai ser apagada é jogar a quantidade fora — e a peça
  // ficaria sem o insumo que a leitura trouxe.
  assert.equal(ficha[0].quantidade, 5, 'a linha apagada fica como está');
  assert.equal(ficha.length, 2);
  assert.equal(ficha[1].status, 'new');
});

test('a linha que ainda não foi gravada soma sem virar "updated"', () => {
  const ficha = [{ insumo_id: 7, processo: 'Marcenaria', quantidade: 2, status: 'new' }];
  const ctx = montarAdicionar({ naFicha: ficha });

  ctx.adicionar([{ insumo_id: 7, processo: 'Marcenaria', quantidade: 3 }]);

  assert.equal(ficha[0].quantidade, 5);
  assert.equal(ficha[0].status, 'new',
    'marcá-la como "updated" mandaria um PUT para uma linha que não existe '
    + 'no banco');
});

test('a chave do insumo é a mesma na soma e na normalização', () => {
  const modal = ler('src', 'js', 'modals', 'produto-editar.js');

  // Duas leituras diferentes do que é "o mesmo insumo" divergem, e a
  // divergência aparece como o erro de chave duplicada do banco, no
  // salvamento, depois de toda a revisão.
  assert.match(modal, /function chaveDoInsumo\(item, indice\)\{/);
  assert.doesNotMatch(modal, /const rawKey = it\.insumo_id \?\? it\.id;/,
    'a normalização voltou a ter a própria cópia da chave');
  assert.equal((modal.match(/chaveDoInsumo\(/g) || []).length >= 3, true,
    'a chave precisa ser usada nos dois lugares');
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

// ---------------------------------------------------------------------------
// A SEÇÃO DE PROCESSO NÃO PODE SER RECRIADA
//
// A tabela da ficha agrupa os insumos por texto EXATO do processo. "MONTAGEM"
// vindo de um documento e "Montagem" vinda do cadastro viram DUAS seções com o
// mesmo nome na tela, e o insumo acrescentado cai na de baixo em vez de entrar
// na que já estava lá.
//
// Havia dois caminhos para isso, e os dois estão fechados aqui:
//   - a grafia diferente (resolvida no modal, ao acrescentar);
//   - o id de etapa cru virando nome de seção (resolvido no backend).
// ---------------------------------------------------------------------------

const vmSecao = require('node:vm');

/** `processoJaUsado` e o normalizador, recortados do modal de peça. */
function montarProcesso({ naFicha = [], etapas = [] } = {}) {
  const fonte = ler('src', 'js', 'modals', 'produto-editar.js');

  const normalizador = fonte.slice(
    fonte.indexOf('    const semAcentoMinusculo ='),
    fonte.indexOf('    const normalizarNomeColecao ='));
  const funcao = fonte.slice(
    fonte.indexOf('    function processoJaUsado(nome) {'),
    fonte.indexOf('    // API para comunicação com outros modais'));

  const contexto = { String, itens: naFicha, etapasOrdem: etapas };
  vmSecao.createContext(contexto);
  vmSecao.runInContext(`${normalizador}\n${funcao}\nglobalThis.semAcentoMinusculo = semAcentoMinusculo;`, contexto);
  return contexto;
}

test('o processo entra com a grafia que a ficha já usa', () => {
  const ctx = montarProcesso({
    naFicha: [{ processo: 'Montagem', status: 'unchanged' }]
  });

  // O documento grita; o cadastro não. Sem isto, a peça ficava com duas seções
  // "MONTAGEM"/"Montagem" e o insumo novo na de baixo.
  assert.equal(ctx.processoJaUsado('MONTAGEM'), 'Montagem');
  assert.equal(ctx.processoJaUsado('montagem'), 'Montagem');
});

test('acento não separa a seção', () => {
  const ctx = montarProcesso({ naFicha: [{ processo: 'Acabamento', status: 'unchanged' }] });
  assert.equal(ctx.processoJaUsado(' ACABAMENTO '), 'Acabamento');
});

test('a ficha manda mais que a etapa cadastrada', () => {
  const ctx = montarProcesso({
    naFicha: [{ processo: 'Marcenaria Fina', status: 'unchanged' }],
    etapas: ['MARCENARIA FINA']
  });

  // O que agrupa a tabela é a grafia que está NA TELA. Preferir a do cadastro
  // criaria a segunda seção justamente para consertar a primeira.
  assert.equal(ctx.processoJaUsado('marcenaria fina'), 'Marcenaria Fina');
});

test('sem a ficha ter, vale a etapa cadastrada', () => {
  const ctx = montarProcesso({ naFicha: [], etapas: ['Montagem', 'Acabamento'] });

  // Resolve também a ORDEM: um processo fora de `etapasOrdem` vai para o fim
  // da tabela, longe de onde deveria estar.
  assert.equal(ctx.processoJaUsado('MONTAGEM'), 'Montagem');
});

test('processo que não existe em lugar nenhum cria seção nova', () => {
  const ctx = montarProcesso({ naFicha: [{ processo: 'Montagem' }], etapas: ['Montagem'] });

  // Devolver null é a resposta certa: aí a seção é criada mesmo, com o nome
  // que veio. "Não recriar" não pode virar "nunca criar".
  assert.equal(ctx.processoJaUsado('Serralheria'), null);
  assert.equal(ctx.processoJaUsado(''), null);
  assert.equal(ctx.processoJaUsado(undefined), null);
});

test('seção de insumo já apagado não conta', () => {
  const ctx = montarProcesso({
    naFicha: [{ processo: 'Montagem', status: 'deleted' }],
    etapas: []
  });

  // A seção some da tela junto com o último insumo dela. Reaproveitar a grafia
  // de uma linha que já foi apagada é reaproveitar uma seção que não existe.
  assert.equal(ctx.processoJaUsado('montagem'), null);
});

test('acrescentar passa pela grafia da ficha', () => {
  const modal = ler('src', 'js', 'modals', 'produto-editar.js');
  const api = modal.slice(modal.indexOf('adicionarProcessoItens(arr){'),
    modal.indexOf('obterItens(){'));

  assert.match(api, /processo: processoJaUsado\(it\.processo\) \|\| it\.processo/,
    'o insumo acrescentado precisa adotar a grafia que a ficha já usa');
});

test('o normalizador é um só, para coleção e processo', () => {
  const modal = ler('src', 'js', 'modals', 'produto-editar.js');

  // Mesma regra escrita duas vezes diverge na primeira mudança, e o sintoma
  // aparece num lugar só.
  assert.match(modal, /const normalizarNomeColecao = semAcentoMinusculo;/);
  assert.equal((modal.match(/normalize\('NFD'\)/g) || []).length, 1,
    'voltou a existir uma segunda cópia da normalização');
});

test('a etapa do cadastro chega como NOME, não como id', () => {
  const backend = require(path.join(raiz, 'backend', 'iaPreenchimento.js'));

  const materias = [
    // O cadastro guarda a etapa por id.
    { id: 5, nome: 'Cola PVA', unidade: 'ml', preco_unitario: 2, processo: '3' }
  ];
  const etapasPorId = new Map([['3', 'Montagem']]);

  const r = backend.montarInsumos(
    // O documento NÃO diz o processo: é o cadastro que responde.
    [{ nome: 'Cola PVA', quantidade: 10 }],
    backend.indexarPor(materias, 'nome'),
    materias,
    etapasPorId
  );

  assert.equal(r.itens.length, 1);
  assert.equal(r.itens[0].processo, 'Montagem',
    'o id cru viraria uma seção chamada "3", separada da seção certa');
});

test('o processo do documento continua mandando', () => {
  const backend = require(path.join(raiz, 'backend', 'iaPreenchimento.js'));

  const materias = [{ id: 5, nome: 'Cola PVA', unidade: 'ml', preco_unitario: 2, processo: '3' }];
  const etapasPorId = new Map([['3', 'Montagem']]);

  const r = backend.montarInsumos(
    [{ nome: 'Cola PVA', quantidade: 10, processo: 'Montagem' }],
    backend.indexarPor(materias, 'nome'),
    materias,
    etapasPorId
  );

  assert.equal(r.itens[0].processo, 'Montagem');
});
