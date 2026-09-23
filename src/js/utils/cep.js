/**
 * Busca de CEP nos endereços (clientes e prospecções).
 *
 * O usuário digita o CEP e os campos do MESMO endereço se preenchem sozinhos:
 * rua, bairro, cidade, país, estado e — quando a tela tem — o código IBGE da
 * NF-e. Número e complemento nunca são tocados: são do imóvel, não do CEP.
 *
 * Como ligar (os ids seguem o prefixo do bloco: `reg`, `cob`, `ent`, `end`):
 *
 *     window.CepBusca.ligar('reg');
 *
 * Espera `<prefixo>Cep` e preenche o que existir entre `<prefixo>Rua`,
 * `Bairro`, `Cidade`, `Pais`, `Estado` e `CodigoMunicipio`. A busca sai
 * sozinha quando os 8 números ficam prontos e também no botão da lupa
 * (`<prefixo>BuscarCep`, quando existe no HTML) — nunca em campo desligado.
 *
 * O endereço vem de GET /api/cep/:cep (backend/cep.js, ViaCEP com cache).
 */
(function () {
  const PREENCHER = [
    ['Rua', 'logradouro'],
    ['Bairro', 'bairro'],
    ['Cidade', 'cidade']
  ];

  function mascararCep(texto) {
    const n = String(texto ?? '').replace(/\D/g, '').slice(0, 8);
    return n.length > 5 ? `${n.slice(0, 5)}-${n.slice(5)}` : n;
  }

  const digitos = valor => String(valor ?? '').replace(/\D/g, '');

  async function fetchApi(caminho) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${caminho}`, { headers: { Accept: 'application/json' } });
  }

  /** Busca o endereço do CEP. Devolve { endereco } ou { erro }. */
  async function buscar(cep) {
    const numeros = digitos(cep);
    if (numeros.length !== 8) return { erro: 'O CEP tem 8 números.' };
    try {
      const resp = await fetchApi(`/api/cep/${numeros}`);
      const corpo = await resp.json().catch(() => null);
      if (!resp.ok) return { erro: corpo?.error || 'Não foi possível consultar o CEP.' };
      return { endereco: corpo };
    } catch (err) {
      console.error('Falha ao consultar o CEP:', err);
      return { erro: 'Não foi possível falar com o aplicativo. Tente de novo.' };
    }
  }

  /**
   * Escolhe no <select> a opção do país/estado. O país é achado pela sigla
   * (data-code, como as listas do geo-service montam) e o estado pelo nome —
   * a lista de estados só existe depois que o país é escolhido, então o
   * change do país é disparado e a troca espera a lista chegar.
   */
  async function escolherGeografia(prefixo, endereco, escopo) {
    const paisSel = escopo.querySelector(`#${prefixo}Pais`);
    const estadoSel = escopo.querySelector(`#${prefixo}Estado`);
    if (!paisSel || !endereco.estado) return;

    const brasil = Array.from(paisSel.options).find(o => String(o.dataset.code || '').toUpperCase() === 'BR'
      || /^brasil|^brazil/i.test(o.value || ''));
    if (brasil && paisSel.value !== brasil.value) {
      paisSel.value = brasil.value;
      paisSel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (!estadoSel) return;

    const escolher = () => {
      const opcao = Array.from(estadoSel.options).find(o => o.value === endereco.estado);
      if (!opcao) return false;
      estadoSel.disabled = false;
      estadoSel.value = opcao.value;
      estadoSel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };

    // Onde a tela recarrega a lista no change do país (Novo/Editar cliente,
    // prospecções), ela chega em instantes: espera sem prender a tela.
    for (let tentativa = 0; tentativa < 10; tentativa += 1) {
      if (escolher()) return;
      await new Promise(r => setTimeout(r, 100));
    }
    // Onde não recarrega (Detalhes do cliente monta a lista uma vez só), a
    // lista é montada aqui, do mesmo jeito que as telas montam.
    if (!window.geoService?.getStatesByCountry) return;
    try {
      const estados = await window.geoService.getStatesByCountry('BR');
      estadoSel.replaceChildren();
      const vazia = document.createElement('option');
      vazia.value = '';
      vazia.textContent = 'Selecione';
      estadoSel.appendChild(vazia);
      for (const e of estados || []) {
        const opcao = document.createElement('option');
        opcao.value = e.name;
        opcao.textContent = e.name;
        estadoSel.appendChild(opcao);
      }
      escolher();
    } catch (err) {
      console.error('Não foi possível montar a lista de estados:', err);
    }
  }

  /** Escreve o endereço nos campos do bloco. Devolve quantos campos mudaram. */
  async function preencher(prefixo, endereco, escopo) {
    let mudou = 0;
    for (const [sufixo, chave] of PREENCHER) {
      const campo = escopo.querySelector(`#${prefixo}${sufixo}`);
      const valor = String(endereco?.[chave] ?? '').trim();
      if (!campo || campo.disabled || !valor) continue;
      if (campo.value !== valor) mudou += 1;
      campo.value = valor;
      campo.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // O código IBGE só existe no cadastro de clientes (campo da NF-e).
    const ibge = escopo.querySelector(`#${prefixo}CodigoMunicipio`);
    if (ibge && !ibge.disabled && endereco?.codigo_municipio) {
      ibge.value = endereco.codigo_municipio;
      ibge.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await escolherGeografia(prefixo, endereco, escopo);
    return mudou;
  }

  /**
   * Liga a busca no bloco de endereço do prefixo.
   * @returns {{ buscar: () => Promise<void> }} para quem quiser disparar na mão.
   */
  function ligar(prefixo, { escopo = document } = {}) {
    const campo = escopo.querySelector(`#${prefixo}Cep`);
    if (!campo || campo.dataset.cepLigado === 'true') return { buscar: async () => {} };
    campo.dataset.cepLigado = 'true';
    const botao = escopo.querySelector(`#${prefixo}BuscarCep`);
    const recado = escopo.querySelector(`#${prefixo}CepRecado`);
    let ultimoBuscado = '';
    let buscando = false;

    function mostrar(texto, tom = 'info') {
      if (!recado) return;
      recado.textContent = texto || '';
      recado.classList.toggle('hidden', !texto);
      recado.style.color = tom === 'erro' ? 'var(--color-red)' : 'var(--color-primary-light)';
    }

    async function procurar({ silencioso = false } = {}) {
      const numeros = digitos(campo.value);
      if (buscando || campo.disabled) return;
      if (numeros.length !== 8) {
        if (!silencioso) mostrar('O CEP tem 8 números.', 'erro');
        return;
      }
      buscando = true;
      if (botao) botao.disabled = true;
      mostrar('Buscando o endereço…');
      try {
        const { endereco, erro } = await buscar(numeros);
        if (erro) { mostrar(erro, 'erro'); return; }
        ultimoBuscado = numeros;
        campo.value = endereco.cep || mascararCep(numeros);
        await preencher(prefixo, endereco, escopo);
        mostrar(`${endereco.cidade || ''}${endereco.cidade && endereco.uf ? '/' : ''}${endereco.uf || ''} — confira o número e o complemento.`);
      } finally {
        buscando = false;
        if (botao) botao.disabled = false;
      }
    }

    campo.addEventListener('input', () => {
      const mascarado = mascararCep(campo.value);
      if (mascarado !== campo.value) campo.value = mascarado;
      const fim = campo.value.length;
      try { campo.setSelectionRange(fim, fim); } catch (_) { /* campo sem seleção */ }
      mostrar('');
      // Completou os 8 números: busca sozinho, uma vez por CEP.
      if (digitos(campo.value).length === 8 && digitos(campo.value) !== ultimoBuscado) procurar({ silencioso: true });
    });
    campo.addEventListener('blur', () => {
      if (digitos(campo.value).length === 8 && digitos(campo.value) !== ultimoBuscado) procurar({ silencioso: true });
    });
    botao?.addEventListener('click', () => { ultimoBuscado = ''; procurar(); });

    return { buscar: procurar };
  }

  window.CepBusca = { ligar, buscar, preencher, mascararCep };
})();
