const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ARQUIVO = path.join(__dirname, '..', '..', 'utils', 'saidaSegura.js');

/**
 * Guarda de saída dos modais (src/utils/saidaSegura.js).
 *
 * O que se testa aqui são as decisões que erram CALADAS:
 *
 *  - deixar passar um Esc num modal preenchido = trabalho perdido sem aviso;
 *  - perguntar num modal intocado = a pessoa aprende a clicar "sair" no
 *    automático, e aí a pergunta não protege mais nada.
 *
 * O DOM é de mentira de propósito: o projeto não usa jsdom, e o que precisa
 * ser exercitado é a lógica da guarda, não o navegador.
 */

class ListaDeClasses {
  constructor() { this.itens = new Set(); }
  add(...c) { c.forEach(x => this.itens.add(x)); }
  remove(...c) { c.forEach(x => this.itens.delete(x)); }
  contains(c) { return this.itens.has(c); }
}

class Elemento {
  constructor(tag, { id = '', pai = null, atributos = {} } = {}) {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.pai = pai;
    this.filhos = [];
    this.atributos = { ...atributos };
    this.classList = new ListaDeClasses();
    this.ouvintes = {};
    this.isConnected = true;
    this.disabled = false;
    this.readOnly = false;
    this.isContentEditable = false;
    if (pai) pai.filhos.push(this);
  }

  hasAttribute(nome) { return Object.prototype.hasOwnProperty.call(this.atributos, nome); }
  getAttribute(nome) { return this.hasAttribute(nome) ? this.atributos[nome] : null; }
  getClientRects() { return [{}]; }
  addEventListener(tipo, fn) { (this.ouvintes[tipo] ||= []).push(fn); }
  click() { (this.ouvintes.click || []).forEach(fn => fn({ type: 'click', target: this })); }

  /** Casa só os seletores que a guarda usa de verdade. */
  bate(seletor) {
    if (seletor === '[id$="Overlay"]') return this.id.endsWith('Overlay');
    if (seletor === '[data-sem-guarda]') return this.hasAttribute('data-sem-guarda');
    if (seletor === 'button, [role="button"], a') {
      return this.tagName === 'BUTTON' || this.tagName === 'A' || this.getAttribute('role') === 'button';
    }
    throw new Error('seletor nao previsto no teste: ' + seletor);
  }

  closest(seletor) {
    let no = this;
    while (no) {
      if (no.bate(seletor)) return no;
      no = no.pai;
    }
    return null;
  }
}

/** Carrega a guarda num contexto isolado, com DOM e DialogPadrao de mentira. */
function montarAmbiente() {
  const raizes = [];
  const captura = {};
  const borbulha = {};

  const doc = {
    addEventListener(tipo, fn, comCaptura) {
      const onde = comCaptura ? captura : borbulha;
      (onde[tipo] ||= []).push(fn);
    },
    removeEventListener(tipo, fn, comCaptura) {
      const onde = comCaptura ? captura : borbulha;
      onde[tipo] = (onde[tipo] || []).filter(f => f !== fn);
    },
    querySelectorAll(seletor) {
      const achados = [];
      const anda = no => {
        if (no.bate(seletor)) achados.push(no);
        no.filhos.forEach(anda);
      };
      raizes.forEach(anda);
      return achados;
    }
  };

  // Perguntas em aberto: o teste responde quando quiser.
  const perguntas = [];
  const janela = {
    document: doc,
    DialogPadrao: {
      open({ onConfirm, onCancel }) {
        const pergunta = {
          confirmar: () => onConfirm(),
          cancelar: () => onCancel(),
          close: () => onCancel()
        };
        perguntas.push(pergunta);
        return pergunta;
      }
    }
  };

  // A guarda reemite o gesto com um KeyboardEvent, global no navegador.
  class TeclaFalsa { constructor(tipo, init) { this.type = tipo; Object.assign(this, init); } }
  const contexto = vm.createContext({ window: janela, document: doc, console, KeyboardEvent: TeclaFalsa });
  contexto.globalThis = contexto;
  vm.runInContext(fs.readFileSync(ARQUIVO, 'utf8'), contexto, { filename: 'saidaSegura.js' });

  /**
   * Um evento de verdade percorre captura e depois borbulha. Aqui a ordem é a
   * mesma, e `stopImmediatePropagation` corta o resto — que é justamente o que
   * a guarda faz para segurar o Esc antes do modal.
   */
  const disparar = (tipo, evento) => {
    let parado = false;
    const e = {
      type: tipo,
      isTrusted: true,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() { parado = true; },
      ...evento
    };
    for (const fn of [...(captura[tipo] || []), ...(borbulha[tipo] || [])]) {
      if (parado) break;
      fn(e);
    }
    return e;
  };

  return { janela, doc, raizes, perguntas, disparar, guarda: janela.SaidaSegura };
}

/** Modal com um campo e um botão de sair, como os do projeto. */
function montarModal(ambiente, { id = 'novoClienteOverlay', idBotao = 'voltarNovoCliente' } = {}) {
  const overlay = new Elemento('div', { id });
  ambiente.raizes.push(overlay);
  const campo = new Elemento('input', { id: 'nome', pai: overlay });
  const botao = new Elemento('button', { id: idBotao, pai: overlay });
  const saidas = [];
  botao.addEventListener('click', () => saidas.push('botao'));

  // O modal ouve o Esc como todos os do projeto: em document, borbulhando.
  ambiente.doc.addEventListener('keydown', e => {
    if (e.key === 'Escape') saidas.push('esc');
  });

  return { overlay, campo, botao, saidas };
}

test('campoConta: o que a pessoa digita conta; apoio e leitura, nao', () => {
  const { guarda } = montarAmbiente();
  const { campoConta } = guarda.__testes__;
  const overlay = new Elemento('div', { id: 'xOverlay' });

  assert.equal(campoConta(new Elemento('input', { pai: overlay })), true, 'input normal conta');
  assert.equal(campoConta(new Elemento('textarea', { pai: overlay })), true, 'textarea conta');
  assert.equal(campoConta(new Elemento('select', { pai: overlay })), true, 'select conta');
  assert.equal(campoConta(new Elemento('div', { pai: overlay })), false, 'div nao e campo');

  const busca = new Elemento('input', { pai: overlay });
  busca.type = 'search';
  assert.equal(campoConta(busca), false, 'procurar nao e preencher');

  const oculto = new Elemento('input', { pai: overlay });
  oculto.type = 'hidden';
  assert.equal(campoConta(oculto), false, 'campo oculto e do codigo, nao da pessoa');

  const travado = new Elemento('input', { pai: overlay });
  travado.disabled = true;
  assert.equal(campoConta(travado), false, 'campo desabilitado nao conta');

  const soLeitura = new Elemento('input', { pai: overlay });
  soLeitura.readOnly = true;
  assert.equal(campoConta(soLeitura), false, 'somente leitura nao conta');

  const filtro = new Elemento('div', { pai: overlay, atributos: { 'data-sem-guarda': '' } });
  assert.equal(campoConta(new Elemento('input', { pai: filtro })), false,
    'campo dentro de data-sem-guarda e dispensado');
});

test('ehBotaoDeSair: a convencao do projeto, com fuga nos dois sentidos', () => {
  const { guarda } = montarAmbiente();
  const { ehBotaoDeSair } = guarda.__testes__;
  const overlay = new Elemento('div', { id: 'xOverlay' });

  const voltar = new Elemento('button', { id: 'voltarNovoCliente', pai: overlay });
  assert.equal(ehBotaoDeSair(voltar), voltar, 'voltarX sai');
  const fechar = new Elemento('button', { id: 'fecharNovoInsumo', pai: overlay });
  assert.equal(ehBotaoDeSair(fechar), fechar, 'fecharX sai');
  const cancelar = new Elemento('button', { id: 'cancelarNovoCliente', pai: overlay });
  assert.equal(ehBotaoDeSair(cancelar), cancelar, 'cancelarX sai');

  // A mesma convencao em sufixo, dos modais de IA e de Permissoes.
  const sufixo = new Elemento('button', { id: 'iaConfigFechar', pai: overlay });
  assert.equal(ehBotaoDeSair(sufixo), sufixo, 'xFechar tambem sai');

  const salvar = new Elemento('button', { id: 'salvarNovoCliente', pai: overlay });
  assert.equal(ehBotaoDeSair(salvar), null, 'salvar nao e saida');
  const parecido = new Elemento('button', { id: 'confirmarCancelamento', pai: overlay });
  assert.equal(ehBotaoDeSair(parecido), null, 'conter a palavra nao basta');

  // Acao com nome de saida: "Confirmar Cancelamento" cancela o PEDIDO.
  const acao = new Elemento('button', {
    id: 'cancelarPedidoConfirmar', pai: overlay, atributos: { 'data-sem-guarda': '' }
  });
  assert.equal(ehBotaoDeSair(acao), null, 'data-sem-guarda tira o botao da guarda');

  // Saida fora da convencao: entra pelo data-modal-sair.
  const fora = new Elemento('button', { id: 'terminar', pai: overlay, atributos: { 'data-modal-sair': '' } });
  assert.equal(ehBotaoDeSair(fora), fora, 'data-modal-sair declara a saida');

  // Um icone dentro do botao: o clique chega no filho, a decisao e do botao.
  const icone = new Elemento('i', { pai: voltar });
  assert.equal(ehBotaoDeSair(icone), voltar, 'sobe do alvo do clique ate o botao');

  const texto = new Elemento('span', { id: 'cancelarPedidoTitulo', pai: overlay });
  assert.equal(ehBotaoDeSair(texto), null, 'id com nome de saida em elemento que nao e botao');
});

test('modal intocado: Esc sai na hora, sem perguntar', () => {
  const ambiente = montarAmbiente();
  const modal = montarModal(ambiente);

  ambiente.disparar('keydown', { key: 'Escape', target: modal.overlay });

  assert.deepEqual(modal.saidas, ['esc'], 'o modal fechou pelo caminho dele');
  assert.equal(ambiente.perguntas.length, 0, 'nada a perder, nada a perguntar');
});

test('modal preenchido: Esc pergunta, e "continuar editando" segura o modal', () => {
  const ambiente = montarAmbiente();
  const modal = montarModal(ambiente);

  ambiente.disparar('input', { target: modal.campo });
  const evento = ambiente.disparar('keydown', { key: 'Escape', target: modal.overlay });

  assert.equal(evento.defaultPrevented, true, 'o Esc foi segurado');
  assert.deepEqual(modal.saidas, [], 'o modal NAO fechou enquanto se pergunta');
  assert.equal(ambiente.perguntas.length, 1, 'perguntou uma vez');

  ambiente.perguntas[0].cancelar();
  assert.deepEqual(modal.saidas, [], 'continuar editando mantem tudo onde estava');
});

test('modal preenchido: confirmar sair reemite o Esc e o modal fecha do jeito dele', async () => {
  const ambiente = montarAmbiente();
  const modal = montarModal(ambiente);
  // A reemissao usa document.dispatchEvent; aqui ela cai no mesmo disparador.
  ambiente.doc.dispatchEvent = evento => ambiente.disparar('keydown', { key: evento.key });

  ambiente.disparar('input', { target: modal.campo });
  ambiente.disparar('keydown', { key: 'Escape', target: modal.overlay });
  ambiente.perguntas[0].confirmar();
  await new Promise(r => setImmediate(r));

  assert.deepEqual(modal.saidas, ['esc'], 'fechou uma vez so, pelo handler do proprio modal');
  assert.equal(ambiente.perguntas.length, 1, 'o Esc reemitido nao pergunta de novo');
});

test('botao de sair em modal preenchido: pergunta e, se confirmado, o clique original vale', async () => {
  const ambiente = montarAmbiente();
  const modal = montarModal(ambiente);

  ambiente.disparar('input', { target: modal.campo });
  const clique = ambiente.disparar('click', { target: modal.botao });

  assert.equal(clique.defaultPrevented, true, 'o clique em Voltar foi segurado');
  assert.deepEqual(modal.saidas, [], 'o botao nao agiu enquanto se pergunta');

  ambiente.perguntas[0].confirmar();
  await new Promise(r => setImmediate(r));
  assert.deepEqual(modal.saidas, ['botao'], 'depois do sim, o botao faz o que sempre fez');
});

test('preenchimento por codigo em modal intocado nao vira pergunta', () => {
  const ambiente = montarAmbiente();
  const modal = montarModal(ambiente);

  // Modal de edicao carregando: varios despacham input/change a mao.
  ambiente.disparar('input', { target: modal.campo, isTrusted: false });
  ambiente.disparar('keydown', { key: 'Escape', target: modal.overlay });

  assert.deepEqual(modal.saidas, ['esc'], 'abrir e desistir nao pergunta nada');
  assert.equal(ambiente.perguntas.length, 0);
});

test('depois que a pessoa encosta no modal, alteracao por codigo conta', () => {
  const ambiente = montarAmbiente();
  const modal = montarModal(ambiente);

  // Seletor customizado: a pessoa clica, o componente escreve no campo.
  ambiente.disparar('pointerdown', { target: modal.campo });
  ambiente.disparar('input', { target: modal.campo, isTrusted: false });
  ambiente.disparar('keydown', { key: 'Escape', target: modal.overlay });

  assert.deepEqual(modal.saidas, [], 'o que a pessoa escolheu esta protegido');
  assert.equal(ambiente.perguntas.length, 1);
});

test('limpar apaga a pendencia - o caminho de quem acabou de salvar', () => {
  const ambiente = montarAmbiente();
  const modal = montarModal(ambiente);

  ambiente.disparar('input', { target: modal.campo });
  assert.equal(ambiente.guarda.temAlteracao(modal.overlay), true);

  ambiente.guarda.limpar(modal.overlay);
  assert.equal(ambiente.guarda.temAlteracao(modal.overlay), false);

  ambiente.disparar('keydown', { key: 'Escape', target: modal.overlay });
  assert.deepEqual(modal.saidas, ['esc'], 'salvo e salvo: sai sem perguntar');
  assert.equal(ambiente.perguntas.length, 0);
});

test('modais empilhados: a pergunta e do modal de cima', () => {
  const ambiente = montarAmbiente();
  const debaixo = montarModal(ambiente, { id: 'novoOrcamentoOverlay', idBotao: 'voltarNovoOrcamento' });
  const emCima = montarModal(ambiente, { id: 'novoClienteOverlay', idBotao: 'voltarNovoCliente' });

  ambiente.disparar('input', { target: debaixo.campo });
  ambiente.disparar('keydown', { key: 'Escape', target: emCima.overlay });

  assert.equal(ambiente.perguntas.length, 0,
    'o de cima esta intocado: o Esc e dele e passa direto');

  ambiente.disparar('input', { target: emCima.campo });
  ambiente.disparar('keydown', { key: 'Escape', target: emCima.overlay });
  assert.equal(ambiente.perguntas.length, 1, 'agora sim, o de cima tem o que perder');
});
