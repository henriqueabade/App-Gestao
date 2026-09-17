/**
 * Parcela mínima — a regra que vale para orçamento, pedido, boleto e
 * devolução (configuracao_cobranca.parcela_minima; sql/desenhistas_producao_parcela.sql).
 *
 *   - parcela única: livre, qualquer valor;
 *   - a 1ª parcela com prazo 0 (à vista, a entrada): livre;
 *   - todas as outras: valor ≥ mínimo.
 *
 * Orçamento e pedido BLOQUEIAM o que não cabe (a tela desabilita as
 * quantidades impossíveis e o backend recusa). Só a devolução AJUSTA sozinha:
 * quando o desconto deixa parcela em aberto abaixo do mínimo, as parcelas em
 * aberto são juntadas nas primeiras (`juntarParcelas`).
 *
 * Tudo aqui é puro, menos `recusaDaDivisao` (lê o mínimo do banco). Sem o
 * SQL (coluna ausente) o mínimo é zero e nada muda.
 */

const PADRAO = 1500;

const centavos = v => Math.round((Number(v || 0) + Number.EPSILON) * 100);
const reais = c => c / 100;
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brl = v => moeda.format(Number(v || 0));

/** O mínimo configurado, em reais (0 quando a coluna ainda não existe). */
function minimoDe(cfg) {
  if (!cfg || cfg.parcela_minima === undefined || cfg.parcela_minima === null || cfg.parcela_minima === '') return 0;
  const n = Number(cfg.parcela_minima);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Os prazos em dias, na ordem das parcelas ("0/30/60" → [0, 30, 60]). */
function prazosDoTexto(prazo, quantidade = null) {
  const partes = String(prazo ?? '').split('/').map(p => p.trim()).filter(p => p !== '').map(Number);
  const lista = partes.map(n => (Number.isFinite(n) ? n : null));
  return quantidade === null ? lista : Array.from({ length: quantidade }, (_, i) => (i < lista.length ? lista[i] : null));
}

/** A parcela `indice` (0 = a primeira) pode ficar abaixo do mínimo? */
function parcelaLivre(indice, total, prazoDaPrimeira) {
  if (total <= 1) return true;
  return indice === 0 && Number(prazoDaPrimeira) === 0 && prazoDaPrimeira !== null && prazoDaPrimeira !== undefined && prazoDaPrimeira !== '';
}

/**
 * Confere um parcelamento. `valores` em reais, na ordem; `prazos` em dias.
 * Devolve { ok, erro, indice } — `indice` é a primeira parcela que não cabe.
 */
function conferir({ valores = [], prazos = [], minimo = 0 }) {
  const min = centavos(minimo);
  const n = valores.length;
  if (!(min > 0) || n <= 1) return { ok: true, erro: null, indice: null };
  for (let i = 0; i < n; i += 1) {
    if (parcelaLivre(i, n, prazos[0])) continue;
    if (centavos(valores[i]) < min) {
      const total = valores.reduce((s, v) => s + centavos(v), 0);
      const dica = total < min ? ` O total (${brl(reais(total))}) fica abaixo do mínimo: use uma parcela só.` : '';
      return {
        ok: false, indice: i,
        erro: `A ${i + 1}ª parcela (${brl(valores[i])}) fica abaixo da parcela mínima de ${brl(minimo)}.`
          + (i === 0 ? ' Só a primeira parcela com prazo 0 (à vista) pode ser menor.' : '') + dica
      };
    }
  }
  return { ok: true, erro: null, indice: null };
}

/**
 * Até quantas parcelas o total comporta. Com parcelas iguais, todas precisam
 * do mínimo; em valores diferentes, a 1ª pode ser a entrada à vista (livre,
 * mas com algum valor).
 */
function maximoDeParcelas({ total, minimo, iguais = false, limite = Infinity }) {
  const t = centavos(total);
  const min = centavos(minimo);
  if (!(min > 0)) return limite;
  if (!(t > 0)) return 1;
  const maximo = iguais ? Math.floor(t / min) : Math.floor((t - 1) / min) + 1;
  return Math.max(1, Math.min(limite, maximo));
}

/** Uma parcela `n` é possível para este total? (a lista de quantidades usa isto) */
const quantidadePossivel = (n, total, minimo) => n <= 1 || n <= maximoDeParcelas({ total, minimo });

/**
 * O abatimento manual deixa o boleto abaixo do mínimo? Parcela única e 1ª à
 * vista ficam livres. Devolve a frase da recusa, ou null.
 */
function recusaDoAbatimento({ valorBoleto, abatimento, numeroParcela, totalParcelas, prazoDaPrimeira, minimo }) {
  const min = centavos(minimo);
  if (!(min > 0)) return null;
  if (parcelaLivre(Number(numeroParcela) - 1, Number(totalParcelas) || 1, prazoDaPrimeira)) return null;
  const fica = centavos(valorBoleto) - centavos(abatimento);
  if (fica >= min) return null;
  return `Com este abatimento o boleto passa a cobrar ${brl(reais(fica))}, abaixo da parcela mínima de ${brl(minimo)}. `
    + 'Só a parcela única ou a primeira à vista podem ficar abaixo do mínimo.';
}

/** Reparte `total` (reais) em `n` partes iguais, em centavos; o que sobra vai para a última. */
function partesIguais(total, n) {
  const t = centavos(total);
  if (!(n > 0)) return [];
  const base = Math.floor(t / n);
  const partes = Array.from({ length: n }, () => base);
  partes[n - 1] += t - base * n;
  return partes.map(reais);
}

/**
 * A devolução deixou parcelas em aberto abaixo do mínimo? Junta-as nas
 * PRIMEIRAS, na ordem (os vencimentos das primeiras ficam): k = quantas
 * cabem no total, ao menos uma, e o total é repartido igualmente entre elas.
 * Uma parcela isenta (a 1ª à vista em aberto) fica de fora da junção.
 *
 * `abertas`: [{ numero, valor (o que ficaria), isenta }] na ordem.
 * Devolve null quando não é preciso juntar; senão, os valores novos na
 * mesma ordem.
 */
function juntarParcelas(abertas, minimo) {
  const min = centavos(minimo);
  if (!(min > 0)) return null;
  const lista = (abertas || []).slice();
  const juntaveis = lista.filter(p => !p.isenta);
  if (juntaveis.length <= 1) return null;
  // Só junta quando alguma ficaria abaixo do mínimo (as zeradas já saem da conta).
  if (!juntaveis.some(p => centavos(p.valor) > 0 && centavos(p.valor) < min)) return null;
  const total = juntaveis.reduce((s, p) => s + centavos(p.valor), 0);
  const k = Math.max(1, Math.min(juntaveis.length, Math.floor(total / min)));
  const partes = partesIguais(reais(total), k);
  let j = 0;
  return lista.map(p => {
    if (p.isenta) return { ...p };
    const valor = j < k ? partes[j] : 0;
    j += 1;
    return { ...p, valor };
  });
}

/**
 * A recusa de uma divisão gravada pelo orçamento, pela conversão em pedido ou
 * pela troca do pagamento do pedido — a frase, ou null. `parcelas` são as
 * linhas ({ numero_parcela, valor }); `prazo` é o texto ("0/30/60").
 */
async function recusaDaDivisao(api, { parcelas = [], prazo = '' } = {}) {
  const lista = (Array.isArray(parcelas) ? parcelas : [])
    .filter(Boolean)
    .map((p, i) => ({ numero: Number(p.numero_parcela) || i + 1, valor: Number(p.valor) || 0, i }))
    .sort((a, b) => a.numero - b.numero || a.i - b.i);
  if (lista.length < 2) return null;
  const configuracao = require('./configuracaoCobranca');
  const minimo = minimoDe(await configuracao.carregar(api).catch(() => null));
  const r = conferir({ valores: lista.map(p => p.valor), prazos: prazosDoTexto(prazo, lista.length), minimo });
  return r.ok ? null : r.erro;
}

module.exports = {
  PADRAO, minimoDe, prazosDoTexto, parcelaLivre, conferir, maximoDeParcelas, quantidadePossivel,
  recusaDoAbatimento, partesIguais, juntarParcelas, recusaDaDivisao
};
