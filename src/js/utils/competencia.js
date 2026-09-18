/**
 * O seletor de COMPETÊNCIA (mês/ano) do Financeiro — o mesmo no módulo e em
 * todos os modais.
 *
 * São três controles, nesta ordem: o MÊS (nomes, à esquerda), o ANO (2025 a
 * 2100, que também aceita digitar) e a LUPA, que é quem "entra" no mês. Nada
 * é lido do servidor enquanto o usuário escolhe: só ao clicar na lupa (ou ao
 * apertar Enter no ano) o valor muda e o `change` é disparado.
 *
 * O valor canônico ('AAAA-MM') fica num <input type="hidden"> que guarda o id
 * antigo do <select>: quem já lia `campo.value` e ouvia `change` continua
 * funcionando sem saber que a tela mudou.
 *
 *   <div class="fin-competencia-campo" data-competencia>
 *     <select data-competencia-mes>…</select>
 *     <input data-competencia-ano list="finCompetenciaAnos" />
 *     <button data-competencia-ir>🔍</button>
 *     <input type="hidden" id="finXCompetencia" />
 *   </div>
 */
(() => {
  if (window.Competencia) return;

  const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const ANO_MIN = 2025;
  const ANO_MAX = 2100;
  const LISTA_ANOS = 'finCompetenciaAnos';

  const valida = valor => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(valor || ''));
  const atual = (hoje = new Date()) => `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  const rotulo = valor => (valida(valor)
    ? `${MESES[Number(String(valor).slice(5, 7)) - 1]} / ${String(valor).slice(0, 4)}`
    : '—');
  const limites = ano => Math.min(ANO_MAX, Math.max(ANO_MIN, Number(ano) || new Date().getFullYear()));

  /** A lista de anos (2025–2100) vive uma vez só no documento. */
  function listaDeAnos() {
    let lista = document.getElementById(LISTA_ANOS);
    if (lista) return lista;
    lista = document.createElement('datalist');
    lista.id = LISTA_ANOS;
    for (let ano = ANO_MIN; ano <= ANO_MAX; ano += 1) {
      const opcao = document.createElement('option');
      opcao.value = String(ano);
      lista.appendChild(opcao);
    }
    document.body.appendChild(lista);
    return lista;
  }

  const partes = raiz => ({
    mes: raiz?.querySelector('[data-competencia-mes]') || null,
    ano: raiz?.querySelector('[data-competencia-ano]') || null,
    ir: raiz?.querySelector('[data-competencia-ir]') || null
  });

  const caixaDe = campo => (campo?.closest ? campo.closest('[data-competencia]') : null);

  /** O que está escolhido na tela (pode ainda não ter virado valor). */
  function escolhido(campo) {
    const { mes, ano } = partes(caixaDe(campo));
    if (!mes || !ano) return campo?.value || '';
    const m = String(mes.value || '01').padStart(2, '0');
    return `${limites(ano.value)}-${m}`;
  }

  /**
   * Põe um valor no seletor (sem avisar ninguém). Vazio só vale onde existe a
   * opção "Todas" — nas listas que filtram por mês.
   */
  function definir(campo, valor) {
    if (!campo) return;
    const { mes, ano } = partes(caixaDe(campo));
    const aceitaVazio = Boolean(mes && [...(mes.options || [])].some(o => o.value === ''));
    if (!valor && aceitaVazio) {
      campo.value = '';
      mes.value = '';
      return;
    }
    const alvo = valida(valor) ? valor : atual();
    campo.value = alvo;
    if (mes) mes.value = alvo.slice(5, 7);
    if (ano) ano.value = alvo.slice(0, 4);
  }

  /** Liga/desliga o seletor inteiro (o hidden não tem como ficar cinza sozinho). */
  function desabilitar(campo, desligado) {
    const caixa = caixaDe(campo);
    if (!caixa) return;
    const { mes, ano, ir } = partes(caixa);
    for (const parte of [mes, ano, ir]) if (parte) parte.disabled = Boolean(desligado);
    caixa.classList.toggle('fin-competencia-campo--desligado', Boolean(desligado));
  }

  /**
   * Monta o seletor. `valor` é a competência inicial; `aoEntrar` roda depois
   * do `change` (a leitura de verdade), e `vazio` cria a opção "Todas"
   * (competência vazia) para as listas que filtram por mês.
   */
  function montar(campo, { valor = null, aoEntrar = null, vazio = '' } = {}) {
    if (!campo) return null;
    const caixa = caixaDe(campo);
    const { mes, ano, ir } = partes(caixa);
    if (!caixa || !mes || !ano) {
      // Sem a casa nova (teste, HTML antigo): o hidden sozinho ainda guarda o valor.
      campo.value = valida(valor) ? valor : atual();
      return campo;
    }
    listaDeAnos();
    mes.replaceChildren();
    if (vazio) {
      const opcao = document.createElement('option');
      opcao.value = '';
      opcao.textContent = vazio;
      mes.appendChild(opcao);
    }
    MESES.forEach((nome, i) => {
      const opcao = document.createElement('option');
      opcao.value = String(i + 1).padStart(2, '0');
      opcao.textContent = nome;
      mes.appendChild(opcao);
    });
    ano.setAttribute('list', LISTA_ANOS);
    ano.min = String(ANO_MIN);
    ano.max = String(ANO_MAX);
    definir(campo, valor);

    // "Entrar no mês": só aqui o valor muda e quem ouve `change` relê.
    const entrar = () => {
      if (vazio && !mes.value) {
        // "Todas": a lista sai do filtro de competência.
        campo.value = '';
      } else {
        const alvo = escolhido(campo);
        if (!valida(alvo)) return;
        definir(campo, alvo);
      }
      campo.dispatchEvent(new Event('change', { bubbles: true }));
      if (typeof aoEntrar === 'function') aoEntrar(campo.value);
    };
    ir?.addEventListener('click', entrar);
    ano.addEventListener('keydown', evento => {
      if (evento.key !== 'Enter') return;
      evento.preventDefault();
      entrar();
    });
    // Ano fora da faixa volta para dentro dela assim que o campo perde o foco.
    ano.addEventListener('blur', () => { ano.value = String(limites(ano.value)); });
    if (vazio) mes.addEventListener('change', () => { if (!mes.value) entrar(); });
    caixa.dataset.competenciaPronta = '1';
    return campo;
  }

  window.Competencia = { MESES, ANO_MIN, ANO_MAX, LISTA_ANOS, valida, atual, rotulo, montar, definir, desabilitar, escolhido };
})();
