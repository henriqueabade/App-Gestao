/**
 * Motor da conciliação (etapa 5) — funções PURAS sobre listas já lidas.
 *
 * Casa cada lançamento do extrato ainda "a conciliar" com o que o app
 * registrou (liquidacoes.js). A filosofia é a do plano (seção H): automático
 * só com chave exata; o resto é SUGESTÃO que alguém confirma.
 *
 *   automatico   o mesmo valor, na janela de datas, com um par ÚNICO dos dois
 *                lados (só este lançamento serve para esta liquidação e
 *                vice-versa) E uma chave: o mesmo CNPJ/CPF da contrapartida
 *                (a API do BB informa) ou o mesmo número de documento — ou
 *                (16b do dono, 02/10/2026) o nome na descrição do banco a
 *                até 3 dias
 *   sugestao     o mesmo valor na janela; `unica` quando o par é único dos
 *                dois lados (pode ser aceito em lote), com os motivos
 *   composicao   a soma de várias liquidações dá o lançamento — o crédito de
 *                cobrança do BB junta os boletos do dia; nunca automático
 *
 * As obrigações (parcela em aberto, nota sem conta — fase A) entram no mesmo
 * jogo, com a janela de 30 dias para cada lado; automático só com par único
 * e o mesmo CNPJ/CPF (até 30 dias) ou o nome na descrição (até 5 dias).
 * Nunca entram em soma.
 *
 * Janelas (o dia em que o banco lança × o dia registrado no app):
 *   boleto recebido     do dia do pagamento até 5 dias depois (o crédito vem
 *                       em D+1/D+2); com a data de crédito, ela é o alvo
 *   cartão              até 35 dias depois (repasse ou fatura)
 *   obrigação           30 dias antes a 30 depois do vencimento/emissão
 *   os outros           3 dias antes a 4 depois (quem registrou errou o dia)
 */
const c = require('../../financeiro/comum');

const LIMITE_COMPOSICAO = 18;
const LIMITE_PASSOS = 60000;
const JANELA_OBRIGACAO = 30;
/** Até quantos dias o nome na descrição basta para o automático (16b; obrigação: 5). */
const DIAS_NOME = 3;
const DIAS_NOME_OBRIGACAO = 5;
const PALAVRAS_VAZIAS = new Set([
  'LTDA', 'EIRELI', 'EPP', 'COMERCIO', 'SERVICOS', 'SERVICO', 'INDUSTRIA', 'SIMULADO', 'DA', 'DE', 'DO', 'DAS', 'DOS', 'E', 'CIA',
  'PIX', 'TED', 'DOC', 'ENVIADO', 'RECEBIDO', 'PAGAMENTO', 'BOLETO', 'TRANSFERENCIA', 'CONTA', 'PAGTO', 'COMPRA', 'DEBITO', 'CREDITO'
]);

const cent = v => Math.round(Math.abs(Number(v) || 0) * 100);
const sinal = v => (Number(v) < 0 ? -1 : 1);

function somarDias(iso, n) {
  const [a, m, d] = String(iso).split('-').map(Number);
  const t = new Date(Date.UTC(a, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

function diasEntre(de, ate) {
  const t = iso => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return Math.round((t(ate) - t(de)) / 86400000);
}

/** De que dia a que dia o lançamento do banco pode aparecer para esta liquidação, e o dia mais provável. */
function janela(liq) {
  const alvo = liq.data_credito || liq.data;
  if (liq.obrigacao) return { alvo, de: somarDias(alvo, -JANELA_OBRIGACAO), ate: somarDias(alvo, JANELA_OBRIGACAO) };
  if (liq.data_incerta) return { alvo, de: somarDias(liq.data, -3), ate: somarDias(alvo, 35) };
  if (liq.tipo === 'recebimento' && liq.forma === 'Boleto') return { alvo, de: liq.data, ate: somarDias(alvo, 5) };
  return { alvo, de: somarDias(alvo, -3), ate: somarDias(alvo, 4) };
}

const semAcento = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

/** O nome (fornecedor, cliente, beneficiário) aparece na descrição do banco? */
function nomeNaDescricao(nome, descricao) {
  const palavras = semAcento(nome).split(' ').filter(p => p.length >= 4 && !PALAVRAS_VAZIAS.has(p));
  if (!palavras.length) return false;
  const texto = ` ${semAcento(descricao)} `;
  const achadas = palavras.filter(p => texto.includes(` ${p} `));
  return achadas.length >= 2 || achadas.some(p => p.length >= 5) || (palavras.length === 1 && achadas.length === 1);
}

const digitos = t => String(t ?? '').replace(/\D/g, '');

/**
 * O quanto um lançamento combina com uma liquidação. null = não serve (outro
 * sentido ou fora da janela; `livre` ignora a janela, para a escolha à mão).
 * `restante` do lançamento e da liquidação é o que falta ligar.
 */
function pontuar(mov, liq, { livre = false } = {}) {
  if (sinal(mov.valor) !== sinal(liq.valor)) return null;
  const j = janela(liq);
  if (!livre && (mov.data < j.de || mov.data > j.ate)) return null;
  const dias = Math.abs(diasEntre(j.alvo, mov.data));
  const motivos = [];
  let pontos = 60 - Math.min(dias, 12) * 5;
  const exato = cent(mov.restante ?? mov.valor) === cent(liq.restante ?? liq.valor_abs);
  if (exato) { pontos += 30; motivos.push('mesmo valor'); }
  motivos.push(dias === 0 ? 'mesmo dia' : `${dias} ${dias === 1 ? 'dia' : 'dias'} de diferença`);
  let forte = false;
  let cnpj = false;
  const docMov = digitos(mov.contrapartida_documento);
  if (docMov && liq.documento && docMov === digitos(liq.documento)) { pontos += 50; forte = true; cnpj = true; motivos.push('mesmo CNPJ/CPF'); }
  const numMov = digitos(mov.documento).replace(/^0+/, '');
  const numLiq = digitos(liq.referencia).replace(/^0+/, '');
  if (numMov.length >= 3 && numMov === numLiq) { pontos += 30; forte = true; motivos.push('mesmo nº de documento'); }
  const nome = Boolean(liq.nome) && nomeNaDescricao(liq.nome, mov.descricao);
  if (nome) { pontos += 20; motivos.push('nome na descrição'); }
  return { pontos, motivos, exato, forte, cnpj, nome, dias, dentro: !livre || (mov.data >= j.de && mov.data <= j.ate) };
}

/**
 * O par (já exato e único dos dois lados) pode ser conciliado sem ninguém
 * confirmar? Liquidação: chave forte ou o nome a até 3 dias (16b). Obrigação
 * (vai lançar/pagar a conta): o mesmo CNPJ/CPF ou o nome a até 5 dias. Pura.
 */
function podeSerAutomatico(liq, p) {
  if (!p?.exato) return false;
  if (liq.obrigacao) return (p.cnpj && p.dias <= JANELA_OBRIGACAO) || (p.nome && p.dias <= DIAS_NOME_OBRIGACAO);
  return p.forte || (p.nome && p.dias <= DIAS_NOME);
}

/**
 * Várias liquidações cuja soma dá o lançamento (em centavos). Procura primeiro
 * entre as do mesmo dia (ou 1 dia de diferença), depois entre todas; poucas
 * candidatas e um limite de passos, para não explodir. Pura.
 */
function composicao(mov, candidatas) {
  const alvo = cent(mov.restante ?? mov.valor);
  // Obrigação nunca entra em soma: conciliar com ela lança/paga a conta, um débito por vez.
  const menores = candidatas.filter(x => !x.liq.obrigacao && cent(x.liq.restante) > 0 && cent(x.liq.restante) < alvo);
  const tentar = pool => {
    const lista = pool.slice(0, LIMITE_COMPOSICAO).sort((x, y) => cent(y.liq.restante) - cent(x.liq.restante));
    const valores = lista.map(x => cent(x.liq.restante));
    const sufixo = valores.map((_, i) => valores.slice(i).reduce((s, v) => s + v, 0));
    let passos = 0;
    const escolha = [];
    const busca = (i, soma) => {
      if (soma === alvo) return escolha.length >= 2;
      if (i >= lista.length || soma > alvo || soma + sufixo[i] < alvo || ++passos > LIMITE_PASSOS) return false;
      escolha.push(i);
      if (busca(i + 1, soma + valores[i])) return true;
      escolha.pop();
      return busca(i + 1, soma);
    };
    return busca(0, 0) ? escolha.map(i => lista[i]) : null;
  };
  const perto = menores.filter(x => x.p.dias <= 1);
  const achada = (perto.length >= 2 && tentar(perto)) || tentar(menores);
  if (!achada) return null;
  const tipos = [...new Set(achada.map(x => x.liq.tipo_rotulo.toLowerCase()))];
  return {
    tipo: 'composicao', unica: false, itens: achada.map(x => x.liq.chave),
    pontos: Math.round(achada.reduce((s, x) => s + x.p.pontos, 0) / achada.length),
    motivos: [`soma de ${achada.length} (${tipos.join(', ')})`, 'mesmo valor no total'],
    soma: c.centavos(alvo / 100)
  };
}

/**
 * A decisão para cada lançamento a conciliar: Map id -> { tipo, unica,
 * itens (chaves), pontos, motivos, soma }. Lançamento sem nada que sirva
 * não aparece. `movimentos` e `liquidacoes` já vêm com `restante`. Pura.
 */
function sugerir(movimentos, liquidacoes) {
  const livres = c.lista(liquidacoes).filter(l => !l.estornado && cent(l.restante) > 0);
  const porMov = new Map();
  const exatosDaLiq = new Map();
  for (const mov of c.lista(movimentos)) {
    const cands = livres.map(liq => ({ liq, p: pontuar(mov, liq) })).filter(x => x.p)
      .sort((x, y) => y.p.pontos - x.p.pontos || x.p.dias - y.p.dias || x.liq.chave.localeCompare(y.liq.chave));
    porMov.set(mov.id, cands);
    for (const x of cands.filter(y => y.p.exato)) {
      exatosDaLiq.set(x.liq.chave, [...(exatosDaLiq.get(x.liq.chave) || []), mov.id]);
    }
  }
  const saida = new Map();
  for (const mov of c.lista(movimentos)) {
    const cands = porMov.get(mov.id) || [];
    const exatos = cands.filter(x => x.p.exato);
    if (exatos.length) {
      const melhor = exatos[0];
      const unica = exatos.length === 1 && (exatosDaLiq.get(melhor.liq.chave) || []).length === 1;
      saida.set(mov.id, {
        tipo: unica && podeSerAutomatico(melhor.liq, melhor.p) ? 'automatico' : 'sugestao', unica, itens: [melhor.liq.chave],
        pontos: melhor.p.pontos, motivos: melhor.p.motivos, soma: melhor.liq.restante,
        alternativas: exatos.length - 1
      });
      continue;
    }
    const soma = composicao(mov, cands);
    if (soma) saida.set(mov.id, { ...soma, alternativas: 0 });
  }
  return saida;
}

/** As candidatas para a escolha à mão: mesmo sentido, a até `dias` dias. Pura. */
function candidatasDoMovimento(mov, liquidacoes, { dias = 10 } = {}) {
  return c.lista(liquidacoes)
    .filter(l => !l.estornado && cent(l.restante) > 0 && sinal(l.valor) === sinal(mov.valor))
    .filter(l => Math.abs(diasEntre(janela(l).alvo, mov.data)) <= dias || (l.data <= mov.data && mov.data <= janela(l).ate))
    .map(liq => ({ liq, p: pontuar(mov, liq, { livre: true }) }))
    .sort((x, y) => Number(y.p.exato) - Number(x.p.exato) || y.p.pontos - x.p.pontos || x.p.dias - y.p.dias);
}

/**
 * Como o débito foi pago, pela descrição do banco (a conta paga pela
 * conciliação). Sem pista: Transferência. Pura.
 */
function formaDaDescricao(descricao) {
  const t = semAcento(descricao);
  if (/\bPIX\b/.test(t)) return 'Pix';
  if (/\b(BOLETO|COBRANCA|TITULO|TIT)\b/.test(t)) return 'Boleto';
  if (/\b(DEB(ITO)? AUT(OMATICO)?|DEBITO AUTOMATICO)\b/.test(t)) return 'Débito automático';
  if (/\b(TED|DOC)\b/.test(t)) return 'TED/DOC';
  if (/\b(CARTAO|FATURA)\b/.test(t)) return 'Cartão';
  return 'Transferência';
}

module.exports = {
  somarDias, diasEntre, janela, nomeNaDescricao, pontuar, podeSerAutomatico, composicao, sugerir, candidatasDoMovimento, formaDaDescricao
};
