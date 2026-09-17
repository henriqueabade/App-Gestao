/**
 * Calendário dos pagamentos internos (fase G).
 *
 *   - Comissão da competência: até o dia `comissao_dia_pagamento` (15) do mês seguinte.
 *   - Produção da competência: até o `producao_dia_util`-ésimo (5º) dia útil do mês seguinte.
 *
 * Dia útil = não é domingo, não é sábado (a menos que `sabado_dia_util`),
 * não é feriado nacional (calculado aqui, inclusive a Sexta-feira Santa) e
 * não está na tabela `financeiro_feriados` (os estaduais, municipais e
 * pontos facultativos que a empresa observa — cadastrados no módulo).
 *
 * Datas são texto 'YYYY-MM-DD' contadas por Date.UTC: o relógio local
 * voltaria um dia em São Paulo. Tudo aqui é puro.
 */
const PADRAO = { comissao_dia_pagamento: 15, producao_dia_util: 5, sabado_dia_util: false };

const iso = d => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher). */
function pascoa(ano) {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const diaDoMes = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, diaDoMes));
}

/** Feriados nacionais do ano: [{ data, descricao }]. */
function feriadosNacionais(ano) {
  const sexta = pascoa(ano);
  sexta.setUTCDate(sexta.getUTCDate() - 2);
  const fixo = (mm, dd, descricao) => ({ data: `${ano}-${mm}-${dd}`, descricao });
  return [
    fixo('01', '01', 'Confraternização Universal'),
    { data: iso(sexta), descricao: 'Sexta-feira Santa' },
    fixo('04', '21', 'Tiradentes'),
    fixo('05', '01', 'Dia do Trabalho'),
    fixo('09', '07', 'Independência do Brasil'),
    fixo('10', '12', 'Nossa Senhora Aparecida'),
    fixo('11', '02', 'Finados'),
    fixo('11', '15', 'Proclamação da República'),
    fixo('11', '20', 'Dia Nacional de Zumbi e da Consciência Negra'),
    fixo('12', '25', 'Natal')
  ].sort((x, y) => x.data.localeCompare(y.data));
}

/** Mapa data -> descrição dos feriados que valem (nacionais dos anos pedidos + os da tabela). */
function mapaDeFeriados(anos, extras = []) {
  const mapa = new Map();
  for (const ano of anos) for (const f of feriadosNacionais(ano)) mapa.set(f.data, f.descricao);
  for (const f of extras || []) {
    const data = String(f?.data || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(data)) mapa.set(data, f.descricao || 'Feriado');
  }
  return mapa;
}

function ehDiaUtil(data, { feriados = new Map(), sabado = false } = {}) {
  const d = new Date(`${data}T00:00:00Z`);
  const semana = d.getUTCDay();
  if (semana === 0) return false;
  if (semana === 6 && !sabado) return false;
  return !feriados.has(data);
}

/** 'YYYY-MM' -> o n-ésimo dia útil daquele mês. */
function enesimoDiaUtil(competencia, n, { extras = [], sabado = false } = {}) {
  const [a, m] = String(competencia).split('-').map(Number);
  const feriados = mapaDeFeriados([a], extras);
  let contados = 0;
  for (let d = 1; d <= 31; d++) {
    const data = new Date(Date.UTC(a, m - 1, d));
    if (data.getUTCMonth() !== m - 1) break;
    const texto = iso(data);
    if (ehDiaUtil(texto, { feriados, sabado })) {
      contados += 1;
      if (contados === Number(n)) return texto;
    }
  }
  return null;
}

const mesSeguinte = competencia => {
  const [a, m] = String(competencia).split('-').map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
};

/** Até quando se paga a comissão da competência ('YYYY-MM-DD'). */
function pagarComissaoAte(competencia, cfg = PADRAO) {
  const seguinte = mesSeguinte(competencia);
  const [a, m] = seguinte.split('-').map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const diaDoMes = Math.min(Math.max(1, Number(cfg?.comissao_dia_pagamento) || PADRAO.comissao_dia_pagamento), ultimo);
  return `${seguinte}-${String(diaDoMes).padStart(2, '0')}`;
}

/** Até quando se paga a produção da competência ('YYYY-MM-DD'). */
function pagarProducaoAte(competencia, cfg = PADRAO, extras = []) {
  const n = Math.min(Math.max(1, Number(cfg?.producao_dia_util) || PADRAO.producao_dia_util), 20);
  return enesimoDiaUtil(mesSeguinte(competencia), n, { extras, sabado: Boolean(cfg?.sabado_dia_util) });
}

module.exports = { PADRAO, pascoa, feriadosNacionais, mapaDeFeriados, ehDiaUtil, enesimoDiaUtil, mesSeguinte, pagarComissaoAte, pagarProducaoAte };
