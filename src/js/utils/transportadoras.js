/**
 * O seletor de transportadora de um orçamento: carregar, cadastrar, excluir.
 *
 * ---------------------------------------------------------------------------
 * POR QUE UM UTILITÁRIO E NÃO CÓDIGO EM CADA MODAL
 *
 * Dois modais mexem nisto — "Novo Orçamento" e "Editar Orçamento" — e os dois
 * precisam da mesma lista, do mesmo "Não Definida" e das mesmas duas ações.
 * Escritos duas vezes, divergiriam na primeira mudança, e a divergência
 * apareceria como uma transportadora que existe numa tela e não na outra.
 *
 * ---------------------------------------------------------------------------
 * "NÃO DEFINIDA" É UM VALOR, NÃO UM VAZIO
 *
 * A transportadora é gravada no orçamento como TEXTO, e a conversão em pedido
 * exige que ela não seja vazia — é ela que diz como a peça sai da fábrica.
 *
 * Só que nem todo orçamento nasce sabendo: o cliente ainda vai dizer, ou a
 * entrega é retirada em loja. Antes disso, o campo ficava em branco e o
 * orçamento não podia ser salvo. "Não Definida" é a resposta explícita a essa
 * pergunta — atravessa o processo inteiro e diz, a quem converter em pedido,
 * que a decisão ficou para depois.
 */
(function (global) {
  'use strict';

  /** O texto exato gravado no orçamento. Um só lugar o define. */
  const NAO_DEFINIDA = 'Não Definida';

  async function base() {
    return global.apiConfig ? global.apiConfig.getApiBaseUrl() : '';
  }

  async function pedir(caminho, opcoes) {
    const resp = await fetch(`${await base()}${caminho}`, {
      headers: { 'content-type': 'application/json' },
      ...opcoes
    });
    const corpo = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(corpo.error || `Erro ${resp.status}`);
    return corpo;
  }

  /**
   * Repinta o seletor.
   *
   * "Não Definida" vem SEMPRE, e vem primeiro: é a escolha de quem ainda não
   * sabe, e enterrá-la no fim de uma lista de quinze transportadoras é o mesmo
   * que escondê-la.
   */
  function pintar(select, transportadoras, escolhido) {
    const anterior = escolhido ?? select.value;

    select.replaceChildren();
    const vazio = document.createElement('option');
    vazio.value = '';
    vazio.disabled = true;
    vazio.selected = true;
    vazio.hidden = true;
    select.appendChild(vazio);

    const naoDefinida = document.createElement('option');
    naoDefinida.value = NAO_DEFINIDA;
    naoDefinida.textContent = NAO_DEFINIDA;
    naoDefinida.dataset.naoDefinida = 'true';
    select.appendChild(naoDefinida);

    for (const t of transportadoras) {
      const op = document.createElement('option');
      // O valor é o NOME: é o nome que o orçamento grava, e o id não sobrevive
      // à gravação. Guardamos o id à parte, para quem for excluir.
      op.value = t.nome;
      op.textContent = t.nome;
      op.dataset.id = String(t.id);
      select.appendChild(op);
    }

    if (anterior && [...select.options].some(o => o.value === anterior)) {
      select.value = anterior;
    }
    select.setAttribute('data-filled', select.value ? 'true' : 'false');
  }

  /** As transportadoras cadastradas para o cliente. */
  async function carregar(select, clienteId, escolhido) {
    if (!select) return [];
    if (!clienteId) { pintar(select, [], escolhido); return []; }

    try {
      const lista = await pedir(`/api/transportadoras/${clienteId}`);
      pintar(select, Array.isArray(lista) ? lista : [], escolhido);
      return lista;
    } catch (err) {
      console.error('Erro ao carregar transportadoras', err);
      // Mesmo sem lista, "Não Definida" continua disponível: um erro de rede
      // não pode ser o que impede alguém de salvar o orçamento.
      pintar(select, [], escolhido);
      return [];
    }
  }

  /**
   * Cadastra uma transportadora para o cliente e a deixa escolhida.
   *
   * O nome vai como a pessoa digitou; quem normaliza é o servidor, porque é
   * ele que atende todo caminho que cria uma — inclusive o preenchimento pela
   * IA. Normalizar aqui também seria uma segunda regra sobre o mesmo campo.
   */
  async function cadastrar({ select, clienteId, nome }) {
    const r = await pedir('/api/transportadoras', {
      method: 'POST',
      body: JSON.stringify({ id_cliente: clienteId, transportadora: nome })
    });
    pintar(select, r.transportadoras || [], r.nome);
    return r;
  }

  /** Remove a transportadora escolhida. */
  async function excluir({ select, clienteId, id }) {
    const r = await pedir(
      `/api/transportadoras/${id}?id_cliente=${encodeURIComponent(clienteId)}`,
      { method: 'DELETE' }
    );
    pintar(select, r.transportadoras || [], '');
    return r;
  }

  /** O id da opção escolhida, ou null — "Não Definida" não tem cadastro. */
  function idEscolhido(select) {
    const opcao = select?.options?.[select.selectedIndex];
    const id = Number(opcao?.dataset?.id);
    return Number.isFinite(id) ? id : null;
  }

  global.Transportadoras = {
    NAO_DEFINIDA,
    pintar,
    carregar,
    cadastrar,
    excluir,
    idEscolhido
  };
})(window);
