/**
 * Corrigir as datas de um pedido JÁ ENVIADO (decisões do dono, 24/09/2026).
 *
 * Para que serve: o pedido foi marcado como "Enviado" SEM NF-e do sistema — a
 * nota foi emitida fora e é informada depois — e a data de envio ficou
 * errada (o envio vem com hoje e a pessoa esqueceu de trocar). Pedido com
 * NF-e do sistema não passa por aqui: a data de saída e os vencimentos saíram
 * na nota. Entregue, devolvido por inteiro, cancelado: também não.
 *
 * O que dá para mudar:
 *   - a data de envio (`embarcar_real`) e a previsão de embarque;
 *   - o início do faturamento, pela mesma escolha do pedido:
 *       ao_embarcar   conta da data de envio: mudar o envio MOVE as parcelas;
 *       ao_converter  o dia da conversão: mudar o envio não mexe nelas;
 *       data          a data escolhida;
 *   - os dias de cada parcela (`pedidos.prazo`).
 *
 * Parcela paga, com boleto (do BB ou de fora) ou com ordem de pagamento fica
 * TRAVADA: o vencimento e o prazo dela não mudam. E só muda o vencimento da
 * parcela cujo início ou prazo mudou — o que ninguém mexeu fica como está,
 * mesmo que não bata com a conta (pedido antigo, vencimento acertado à mão).
 *
 * A produção confirmada no envio e as competências fechadas não são tocadas.
 * Tudo aqui é puro; a rota é `/api/pedidos/:id/envio` (pedidosController).
 */
const {
  REGRAS_FATURAMENTO,
  diaValido,
  somarDias,
  prazosDoTexto,
  validarDatas,
  baseDoFaturamento
} = require('./faturamentoPedido');
const { ROTULO_DA_TRAVA } = require('./pedidoParcelas');

/** Nota do sistema que já vale (ou está saindo): com ela, as datas seguem a nota. */
const NOTAS_QUE_TRAVAM = new Set(['autorizada', 'cancelamento_pendente', 'processando', 'enviando']);

/** O prazo de uma parcela passa disto é dígito a mais, não combinado. */
const PRAZO_MAXIMO = 3650;

const ROTULO_DA_REGRA = {
  ao_embarcar: 'no envio',
  ao_converter: 'na conversão',
  data: 'data escolhida'
};

const texto = dia => {
  const d = diaValido(dia);
  return d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '(sem data)';
};

/**
 * Por que este pedido NÃO pode ter as datas do envio corrigidas, ou null.
 * `notas` são as NF-e do sistema do pedido (`notas_fiscais`).
 */
function motivoDoBloqueio(pedido, notas = []) {
  const situacao = String(pedido?.situacao || '').trim();
  if (situacao === 'Entregue') return 'Pedido entregue: as datas não mudam mais.';
  if (situacao !== 'Enviado') return 'Só dá para corrigir as datas do envio de pedido enviado.';
  if (pedido?.devolucao === 'total') return 'Pedido devolvido por inteiro: as datas não mudam mais.';
  const nota = (Array.isArray(notas) ? notas : [])
    .filter(n => n && String(n.pedido_id) === String(pedido.id) && NOTAS_QUE_TRAVAM.has(String(n.status_fiscal)))
    .sort((a, b) => Number(b.id) - Number(a.id))[0];
  if (!nota) return null;
  if (['processando', 'enviando'].includes(String(nota.status_fiscal))) {
    return 'A NF-e deste pedido está saindo pela SEFAZ: espere o retorno. Com a nota autorizada, a data de envio e os vencimentos seguem a nota.';
  }
  const numero = nota.numero ? ` nº ${nota.numero}` : '';
  return `Pedido enviado com NF-e${numero}: a data de envio e os vencimentos seguem a nota.`;
}

/**
 * As parcelas como o modal as mostra, na ordem do número: valor, vencimento
 * de hoje, o prazo (dias) de cada uma e a trava, quando há.
 * `travas` é o Map de pedidoParcelas.travasDasParcelas.
 */
function parcelasDoPedido({ pedido, parcelas = [], travas = new Map() }) {
  const ordenadas = (Array.isArray(parcelas) ? parcelas : [])
    .filter(p => p && p.id !== undefined && p.id !== null && String(p.pedido_id) === String(pedido?.id))
    .sort((a, b) => (Number(a.numero_parcela) || 0) - (Number(b.numero_parcela) || 0) || Number(a.id) - Number(b.id));
  const prazos = prazosDoTexto(pedido?.prazo, ordenadas.length);
  return ordenadas.map((p, i) => {
    const numero = Number(p.numero_parcela) || i + 1;
    const trava = travas.get(numero) || null;
    return {
      id: p.id,
      numero,
      valor: Math.round((Number(p.valor) || 0) * 100) / 100,
      vencimento: diaValido(p.data_vencimento),
      prazo: prazos[i],
      travada: Boolean(trava),
      trava: trava ? `Tem ${ROTULO_DA_TRAVA[trava.origem] || 'pagamento'}: o vencimento não muda.` : null
    };
  });
}

/**
 * Confere o que veio da tela. `quantidade` é o número de parcelas do pedido:
 * `prazos`, quando vem, traz um número por parcela.
 */
function lerEntrada(corpo, quantidade) {
  const dados = corpo && typeof corpo === 'object' ? corpo : {};
  const envioBruto = dados.data_envio;
  if (envioBruto === undefined || envioBruto === null || String(envioBruto).trim() === '') {
    return { ok: false, erro: 'Informe a data de envio.' };
  }
  const dataEnvio = diaValido(String(envioBruto));
  if (!dataEnvio) return { ok: false, erro: 'A data de envio não é uma data válida.' };

  const datas = validarDatas(dados);
  if (!datas.ok) return datas;

  let prazos = null;
  if (dados.prazos !== undefined && dados.prazos !== null) {
    if (!Array.isArray(dados.prazos) || dados.prazos.length !== quantidade) {
      return { ok: false, erro: 'Os prazos não batem com as parcelas do pedido. Feche e abra de novo.' };
    }
    prazos = [];
    for (let i = 0; i < dados.prazos.length; i++) {
      const bruto = dados.prazos[i];
      const n = bruto === '' || bruto === null ? NaN : Number(bruto);
      if (!Number.isInteger(n) || n < 0 || n > PRAZO_MAXIMO) {
        return { ok: false, erro: `O prazo da ${i + 1}ª parcela precisa ser um número de dias entre 0 e ${PRAZO_MAXIMO}.` };
      }
      prazos.push(n);
    }
  }

  return {
    ok: true,
    data_envio: dataEnvio,
    embarcar_previsao: datas.embarcar_previsao,
    faturamento_regra: datas.faturamento_regra,
    inicio_faturamento: datas.inicio_faturamento,
    prazos
  };
}

/** De onde o faturamento conta, pela escolha — a data de envio é a do formulário. */
function inicioDaRegra({ regra, dataEnvio, inicioEscolhido, dataConversao }) {
  if (regra === 'ao_embarcar') return diaValido(dataEnvio);
  if (regra === 'ao_converter') return diaValido(dataConversao);
  if (regra === 'data') return diaValido(inicioEscolhido);
  return null;
}

/**
 * O que gravar. `parcelas` vem de `parcelasDoPedido`; `entrada`, de
 * `lerEntrada`. Devolve `{ ok: false, erro }` ou
 * `{ ok: true, nada, campos, parcelas, mudancas, descricao }`, com cada
 * parcela trazendo `vencimento_antes`, `vencimento`, `prazo_antes`, `prazo`
 * e `muda`.
 */
function planejar({ pedido, parcelas = [], entrada, dataConversao }) {
  const regra = entrada.faturamento_regra;
  if (!REGRAS_FATURAMENTO.includes(regra)) return { ok: false, erro: 'Escolha quando o faturamento começa.' };
  const inicio = inicioDaRegra({
    regra, dataEnvio: entrada.data_envio, inicioEscolhido: entrada.inicio_faturamento, dataConversao
  });
  if (!inicio) {
    return {
      ok: false,
      erro: regra === 'ao_converter'
        ? 'Não foi possível saber o dia da conversão deste pedido. Escolha outra opção de início do faturamento.'
        : 'Informe a data de início do faturamento.'
    };
  }

  const inicioAntes = baseDoFaturamento(pedido);
  const baseMudou = inicio !== inicioAntes;
  const planejadas = parcelas.map((p, i) => {
    const prazoPedido = entrada.prazos ? entrada.prazos[i] : p.prazo;
    const prazo = p.travada ? p.prazo : prazoPedido;
    let vencimento = p.vencimento;
    if (!p.travada && (baseMudou || prazo !== p.prazo || !p.vencimento)) vencimento = somarDias(inicio, prazo);
    return {
      id: p.id,
      numero: p.numero,
      valor: p.valor,
      travada: p.travada,
      trava: p.trava,
      prazo_antes: p.prazo,
      prazo,
      vencimento_antes: p.vencimento,
      vencimento,
      muda: vencimento !== p.vencimento
    };
  });

  const campos = {};
  const mudancas = [];
  const envioAntes = diaValido(pedido?.embarcar_real);
  if (entrada.data_envio !== envioAntes) {
    campos.embarcar_real = entrada.data_envio;
    mudancas.push(`data de envio ${texto(envioAntes)} → ${texto(entrada.data_envio)}`);
  }
  const previsaoAntes = diaValido(pedido?.embarcar_previsao);
  if (entrada.embarcar_previsao !== previsaoAntes) {
    campos.embarcar_previsao = entrada.embarcar_previsao;
    mudancas.push(`previsão de embarque ${texto(previsaoAntes)} → ${texto(entrada.embarcar_previsao)}`);
  }
  const regraAntes = REGRAS_FATURAMENTO.includes(pedido?.faturamento_regra) ? pedido.faturamento_regra : null;
  if (regra !== regraAntes || inicio !== diaValido(pedido?.inicio_faturamento)) {
    campos.faturamento_regra = regra;
    campos.inicio_faturamento = inicio;
    mudancas.push(`início do faturamento ${texto(inicioAntes)} → ${texto(inicio)} (${ROTULO_DA_REGRA[regra]})`);
  }
  const prazoAntes = parcelas.map(p => p.prazo).join('/');
  const prazoNovo = planejadas.map(p => p.prazo).join('/');
  if (parcelas.length && prazoNovo !== prazoAntes) {
    campos.prazo = prazoNovo;
    mudancas.push(`prazos ${prazoAntes} → ${prazoNovo} dias`);
  }
  const movidas = planejadas.filter(p => p.muda);
  if (movidas.length) {
    mudancas.push(`vencimentos: ${movidas.map(p => `${p.numero}ª ${texto(p.vencimento_antes)} → ${texto(p.vencimento)}`).join(', ')}`);
  }

  const nada = !Object.keys(campos).length && !movidas.length;
  return {
    ok: true,
    nada,
    campos,
    parcelas: planejadas,
    mudancas,
    descricao: nada ? null : `Datas do envio corrigidas: ${mudancas.join('; ')}.`
  };
}

module.exports = {
  NOTAS_QUE_TRAVAM,
  PRAZO_MAXIMO,
  ROTULO_DA_REGRA,
  motivoDoBloqueio,
  parcelasDoPedido,
  lerEntrada,
  inicioDaRegra,
  planejar
};
