/**
 * Padronização global de campos numéricos.
 *
 * Regras acordadas com o usuário:
 *  - Todo preenchimento numérico aceita ATÉ 4 casas decimais.
 *  - Na digitação, tanto "," quanto "." valem como separador decimal e o campo
 *    guarda SEMPRE "." (um único separador). O back-end recebe o valor já com
 *    ponto e converte para o tipo da coluna ao salvar.
 *  - Vale para quantidades, preços e porcentagens.
 *
 * Por que trocar `type="number"` por `type="text" inputmode="decimal"`:
 * no Chromium um `input[type=number]` descarta o próprio conteúdo quando o
 * usuário digita "," (o `value` volta vazio), então era impossível "converter a
 * vírgula em ponto" — o caractere nunca chegava ao JS. Com texto controlado a
 * conversão acontece a cada tecla e `parseFloat` continua funcionando porque o
 * campo só contém dígitos e ponto. `min`/`max` deixam de ser validados pelo
 * navegador, por isso são reaplicados aqui no blur.
 */
(() => {
  const MAX_DECIMALS = 4;
  const PREPARED_FLAG = 'numericPrepared';

  /** Campos que parecem numéricos mas NÃO devem ser tratados como decimais. */
  const IGNORED_IDS = new Set(['ncmInput']);

  function isCandidate(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    if (el.dataset[PREPARED_FLAG] === 'true') return false;
    if (el.dataset.numeric === 'false') return false;
    if (IGNORED_IDS.has(el.id)) return false;
    const type = (el.getAttribute('type') || '').toLowerCase();
    return type === 'number' || el.dataset.numeric === 'true';
  }

  /**
   * Reduz qualquer texto ao formato numérico canônico do front: dígitos,
   * no máximo um ".", no máximo `maxDecimals` casas e sinal apenas à frente.
   */
  function sanitize(raw, { maxDecimals = MAX_DECIMALS, allowNegative = false } = {}) {
    let texto = String(raw ?? '');
    const negativo = allowNegative && /^\s*-/.test(texto);

    // Mantém só dígitos e separadores; "," passa a "."
    texto = texto.replace(/[^\d.,]/g, '').replace(/,/g, '.');

    // Preserva apenas o primeiro separador decimal
    const primeiro = texto.indexOf('.');
    if (primeiro !== -1) {
      texto = texto.slice(0, primeiro + 1) + texto.slice(primeiro + 1).replace(/\./g, '');
    }

    // Limita as casas decimais
    const separador = texto.indexOf('.');
    if (separador !== -1 && texto.length - separador - 1 > maxDecimals) {
      texto = texto.slice(0, separador + 1 + maxDecimals);
    }

    return (negativo && texto !== '' ? '-' : '') + texto;
  }

  /** Converte o conteúdo de um campo numérico em Number (NaN se vazio/inválido). */
  function parse(valor) {
    if (typeof valor === 'number') return valor;
    const texto = sanitize(valor, { allowNegative: true });
    if (texto === '' || texto === '-' || texto === '.' || texto === '-.') return NaN;
    return Number(texto);
  }

  /** Formata para exibição com até `maxDecimals` casas, sem zeros à direita. */
  function format(valor, maxDecimals = MAX_DECIMALS) {
    const numero = typeof valor === 'number' ? valor : parse(valor);
    if (!Number.isFinite(numero)) return '';
    const fixo = numero.toFixed(maxDecimals);
    return fixo.includes('.') ? fixo.replace(/\.?0+$/, '') : fixo;
  }

  function optionsFor(el) {
    const decimais = Number(el.dataset.numericDecimals);
    return {
      maxDecimals: Number.isFinite(decimais) && decimais >= 0 ? decimais : MAX_DECIMALS,
      allowNegative: el.dataset.numericNegative === 'true'
    };
  }

  function handleInput(el) {
    const opcoes = optionsFor(el);
    const anterior = el.value;
    const limpo = sanitize(anterior, opcoes);
    if (limpo === anterior) return;

    // Recoloca o cursor descontando só o que foi removido ANTES dele.
    let caret = null;
    try {
      caret = el.selectionStart;
    } catch (_) {
      caret = null;
    }
    el.value = limpo;
    if (caret !== null) {
      const prefixo = anterior.slice(0, caret);
      const removidos = prefixo.length - sanitize(prefixo, opcoes).length;
      const posicao = Math.max(0, Math.min(limpo.length, caret - removidos));
      try {
        el.setSelectionRange(posicao, posicao);
      } catch (_) {
        /* campos sem seleção (ex.: hidden) ignoram */
      }
    }
  }

  function handleBlur(el) {
    const opcoes = optionsFor(el);
    let texto = sanitize(el.value, opcoes);

    if (texto === '' || texto === '-') {
      el.value = '';
      return;
    }
    if (texto.startsWith('.')) texto = `0${texto}`;
    if (texto.startsWith('-.')) texto = texto.replace('-.', '-0.');
    if (texto.endsWith('.')) texto = texto.slice(0, -1);

    // `min`/`max` viraram data-attributes na preparação: reaplica aqui.
    const numero = Number(texto);
    if (Number.isFinite(numero)) {
      const min = Number(el.dataset.numericMin);
      const max = Number(el.dataset.numericMax);
      if (el.dataset.numericMin !== undefined && Number.isFinite(min) && numero < min) {
        texto = format(min, opcoes.maxDecimals);
      } else if (el.dataset.numericMax !== undefined && Number.isFinite(max) && numero > max) {
        texto = format(max, opcoes.maxDecimals);
      }
    }

    if (texto !== el.value) {
      el.value = texto;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function prepare(el) {
    if (!isCandidate(el)) return;
    el.dataset[PREPARED_FLAG] = 'true';

    const tipo = (el.getAttribute('type') || '').toLowerCase();
    if (tipo === 'number') {
      const min = el.getAttribute('min');
      const max = el.getAttribute('max');
      if (min !== null) el.dataset.numericMin = min;
      if (max !== null) el.dataset.numericMax = max;
      if (min !== null && Number(min) < 0) el.dataset.numericNegative = 'true';
      el.setAttribute('type', 'text');
      el.removeAttribute('min');
      el.removeAttribute('max');
      el.setAttribute('step', String(1 / 10 ** MAX_DECIMALS));
    }

    el.setAttribute('inputmode', 'decimal');
    el.setAttribute('autocomplete', 'off');

    // Normaliza um valor já presente no HTML (ex.: value="25").
    const inicial = sanitize(el.value, optionsFor(el));
    if (inicial !== el.value) el.value = inicial;

    el.addEventListener('input', () => handleInput(el));
    el.addEventListener('blur', () => handleBlur(el));
  }

  function scan(raiz = document) {
    if (!raiz) return;
    if (raiz.nodeType === Node.ELEMENT_NODE && isCandidate(raiz)) prepare(raiz);
    raiz.querySelectorAll?.('input[type="number"], input[data-numeric="true"]')
      .forEach(prepare);
  }

  // Modais e linhas de tabela nascem depois do load: observa o documento todo.
  function observar() {
    scan(document);
    new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) scan(node);
        });
      });
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observar);
  } else {
    observar();
  }

  window.NumericInput = {
    MAX_DECIMALS,
    sanitize,
    parse,
    format,
    prepare,
    scan
  };
})();
