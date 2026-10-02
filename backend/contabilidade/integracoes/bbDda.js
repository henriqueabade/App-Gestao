/**
 * Boletos contra a empresa pela API DDA do Banco do Brasil (fase H; Swagger
 * 1.0.1 que o BB mandou em 02/10/2026):
 *
 *   endereços . https://dda.mtls.api.hm.bb.com.br/v1 (homologação) e
 *               https://dda.mtls.api.bb.com.br/v1 (produção), com o
 *               certificado da empresa na conexão (o gateway externo
 *               api.externo[.hm].bb.com.br/dda/v1 também existe);
 *   token ..... OAuth2 client_credentials, escopo "dda-info" (o mesmo pedido
 *               de token do extrato — bbExtrato.pedirToken);
 *   consulta .. GET {api}/boletos?gw-dev-app-key=&numeroProximoRegistro=
 *               (começa em 1)&dataVencimentoInicial=&dataVencimentoFinal=
 *               (dd/mm/aaaa, até 1 ano)&codigoEstadoObrigacao= (1 a pagar,
 *               2 agendado, 3 liquidado — UMA consulta por estado);
 *   resposta .. até 150 boletos em listaTitulo[].objetoObrigacao, o
 *               CPF/CNPJ do pagador e, para a página seguinte,
 *               indicadorContinuidade S/N + numeroProximoRegistro;
 *   dá ........ beneficiário e beneficiário final (nome, CPF/CNPJ, tipo),
 *               "seu número" (até 15, pode vir vazio), código de barras de 44
 *               (NÃO é a linha digitável), registro, vencimento e valor;
 *   não dá .... id do boleto, nosso número, linha digitável, emissão, valor
 *               atualizado, juros/multa/desconto, PDF ou 2ª via.
 *
 * A linha digitável sai do código de barras (cobranca/boletoCalculo) e é
 * sempre apresentada como CALCULADA. Cada boleto ganha uma chave INTERNA do
 * app (SHA-256 de pagador + beneficiário + código de barras + vencimento +
 * valor + seu número) — nunca apresentada como identificador do BB.
 *
 * Puro, com o transporte injetado (rede.js); nada aqui guarda segredo.
 */
const crypto = require('crypto');
const boletoCalculo = require('../../cobranca/boletoCalculo');
const bbExtrato = require('./bbExtrato');

const POR_PAGINA = 150;
const MAX_PAGINAS = 60;
/** O BB aceita até 1 ano entre o vencimento inicial e o final; 360 dias por consulta é a folga. */
const MAX_DIAS_POR_CONSULTA = 360;
const APP_KEY = 'gw-dev-app-key';
const CABECALHO_TESTE = 'x-br-com-bb-ipa-mciteste';
const ESTADOS = { 1: 'a_pagar', 2: 'agendado', 3: 'liquidado' };
const ROTULOS_ESTADO = { 1: 'A pagar', 2: 'Agendado', 3: 'Liquidado' };

function erro(mensagem, status = 502) {
  const e = new Error(mensagem);
  e.status = status;
  return e;
}

const digitos = v => String(v ?? '').replace(/\D/g, '');
const texto = (v, max) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).replace(/\s+/g, ' ').trim().slice(0, max));

/** 'YYYY-MM-DD' → 'dd/mm/aaaa'. Pura. */
function dataBB(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) throw erro('Data inválida para o DDA do BB.', 400);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** 'dd/mm/aaaa' (ou já ISO) → 'YYYY-MM-DD', ou null. Pura. */
function lerData(v) {
  const t = String(v ?? '').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  if (!br || Number(br[1]) < 1 || Number(br[1]) > 31 || Number(br[2]) < 1 || Number(br[2]) > 12) return null;
  return `${br[3]}-${br[2]}-${br[1]}`;
}

/** CPF (11) ou CNPJ (14, também o alfanumérico) com os zeros; null quando não dá. Pura. */
function documentoDe(v, tipo) {
  const s = String(v ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    if (Number(s) === 0) return null;
    return s.padStart(tipo === 'F' ? 11 : 14, '0').slice(-14);
  }
  return s.length === 14 ? s : null;
}

/** O valor no padrão americano (número ou texto "250185.90"). Pura. */
function valorDe(v) {
  const n = Number(String(v ?? '').trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

/** A linha digitável (47 dígitos) calculada do código de barras; null quando não dá (arrecadação, código inválido). Pura. */
function linhaDe(barras) {
  const d = digitos(barras);
  if (d.length !== 44 || d[0] === '8') return null;
  try {
    return boletoCalculo.linhaDigitavel(d).digitos;
  } catch (_) {
    return null;
  }
}

const tipoPessoa = v => (['F', 'J'].includes(String(v ?? '').trim().toUpperCase()) ? String(v).trim().toUpperCase() : null);

/**
 * Um item da lista (`{ objetoObrigacao }` ou o próprio objeto) → o boleto do
 * app; null quando falta o essencial (código de 44, vencimento, valor).
 * `estado` é o da consulta (o BB não põe o estado em cada boleto). Pura.
 */
function boletoDe(item, { estado, pagador = null } = {}) {
  const o = item?.objetoObrigacao && typeof item.objetoObrigacao === 'object' ? item.objetoObrigacao : item;
  if (!o || typeof o !== 'object') return null;
  const barras = digitos(o.textoCodigoBarrasObrigacao);
  const vencimento = lerData(o.dataVencimentoObrigacao);
  const valor = valorDe(o.valorVencimentoObrigacao);
  if (barras.length !== 44 || !vencimento || !valor) return null;
  const tipo = tipoPessoa(o.codigoTipoPessoaBeneficiario);
  const beneficiario = documentoDe(o.numeroIdentificadorBeneficiario, tipo);
  const nome = texto(o.nomeBeneficiarioObrigacao, 200);
  // Sem intermediário, o beneficiário final é o próprio beneficiário (o BB repete os dados).
  const tipoFinal = tipoPessoa(o.codigoTipoPessoaBeneficiarioFim) || tipo;
  const final = documentoDe(o.numeroIdentificadorBeneficiarioFim, tipoFinal) || beneficiario;
  return {
    pagador_documento: pagador,
    beneficiario_documento: beneficiario, beneficiario_tipo: tipo, beneficiario_nome: nome,
    beneficiario_final_documento: final, beneficiario_final_tipo: tipoFinal, beneficiario_final_nome: texto(o.nomeBeneficiarioFimObrigacao, 200) || nome,
    seu_numero: texto(o.codigoIdentificadorDocumentoCobranca, 15),
    codigo_barras: barras, linha_digitavel: linhaDe(barras),
    data_registro: lerData(o.dataRegistroObrigacao), vencimento, valor,
    estado: Number(estado) || null,
    bruto: o
  };
}

/**
 * A chave INTERNA do boleto (o BB não dá identificador): SHA-256 de pagador,
 * beneficiário, código de barras, vencimento, valor e seu número. Pura.
 */
function chaveInterna(b) {
  const partes = [b.pagador_documento || '', b.beneficiario_documento || '', b.codigo_barras || '', b.vencimento || '', Number(b.valor || 0).toFixed(2), b.seu_numero || ''];
  return crypto.createHash('sha256').update(partes.join('|'), 'utf8').digest('hex');
}

/** Uma página da resposta: os boletos, os que não deu para ler e a continuação. Pura. */
function lerPagina(corpo, estado) {
  const pagador = documentoDe(corpo?.numeroIdentificadorPagador, tipoPessoa(corpo?.codigoTipoPessoaPagador));
  const lista = Array.isArray(corpo?.listaTitulo) ? corpo.listaTitulo : [];
  const boletos = [];
  let invalidos = 0;
  for (const item of lista) {
    const b = boletoDe(item, { estado: Number(corpo?.codigoEstadoObrigacao) || estado, pagador });
    if (b) boletos.push({ ...b, chave_interna: chaveInterna(b) });
    else invalidos++;
  }
  const continua = String(corpo?.indicadorContinuidade ?? '').trim().toUpperCase() === 'S';
  const proximo = Number(corpo?.numeroProximoRegistro) || 0;
  return { boletos, invalidos, continua, proximo, pagador };
}

/** O período em pedaços de até 360 dias (cada um vira uma consulta por estado). Pura. */
const janelas = (inicio, fim) => bbExtrato.janelas(inicio, fim, MAX_DIAS_POR_CONSULTA);

/**
 * Todos os boletos com vencimento no período, em cada estado pedido (páginas
 * até acabar). O mesmo boleto em dois estados (mudou entre as consultas)
 * fica com o mais adiantado. Devolve `{ boletos, paginas (a resposta crua,
 * a evidência), consultas, escopos, invalidos, pagador }`. `mciTeste` vai só
 * fora da produção, e só se o BB tiver indicado.
 */
async function buscar({ transporte, urlOauth, urlApi, credenciais, escopo, ambiente, mciTeste = null, inicio, fim, estados = [1, 2, 3] }) {
  if (!inicio || !fim || inicio > fim) throw erro('Período inválido para o DDA.', 400);
  const pedidos = [...new Set((estados || []).map(Number).filter(e => ESTADOS[e]))];
  if (!pedidos.length) throw erro('Escolha ao menos um estado do boleto para buscar.', 400);
  const producao = ambiente === 'producao';
  const token = await bbExtrato.pedirToken({ transporte, urlOauth, clientId: credenciais.clientId, clientSecret: credenciais.secret, escopo });
  const url = `${String(urlApi).replace(/\/+$/, '')}/boletos`;
  const cabecalhos = { 'Content-Type': 'application/json', ...(!producao && mciTeste ? { [CABECALHO_TESTE]: String(mciTeste) } : {}) };
  const porChave = new Map();
  const paginas = [];
  let consultas = 0;
  let invalidos = 0;
  let pagador = null;
  for (const janela of janelas(inicio, fim)) {
    for (const estado of pedidos) {
      let proximo = 1;
      for (let i = 0; i < MAX_PAGINAS; i++) {
        consultas++;
        const r = await bbExtrato.chamarApi({
          transporte, url, token, appKey: credenciais.appKey, ambiente, nomeAppKey: APP_KEY, cabecalhos, nomeApi: 'DDA', dicaTeste: '',
          query: { numeroProximoRegistro: proximo, dataVencimentoInicial: dataBB(janela.inicio), dataVencimentoFinal: dataBB(janela.fim), codigoEstadoObrigacao: estado }
        });
        if (r.vazio) break;
        paginas.push({ estado, inicio: janela.inicio, fim: janela.fim, numeroProximoRegistro: proximo, corpo: r.corpo });
        const lida = lerPagina(r.corpo, estado);
        pagador = pagador || lida.pagador;
        invalidos += lida.invalidos;
        for (const b of lida.boletos) {
          const ja = porChave.get(b.chave_interna);
          if (!ja || b.estado > ja.estado) porChave.set(b.chave_interna, b);
        }
        if (!lida.continua || !(lida.proximo > proximo)) break;
        proximo = lida.proximo;
      }
    }
  }
  const boletos = [...porChave.values()].sort((x, y) => x.vencimento.localeCompare(y.vencimento) || x.chave_interna.localeCompare(y.chave_interna));
  return { boletos, paginas, consultas, escopos: token.escopos, invalidos, pagador, estados: pedidos };
}

module.exports = {
  POR_PAGINA, MAX_PAGINAS, MAX_DIAS_POR_CONSULTA, APP_KEY, CABECALHO_TESTE, ESTADOS, ROTULOS_ESTADO,
  dataBB, lerData, documentoDe, valorDe, linhaDe, boletoDe, chaveInterna, lerPagina, janelas, buscar
};
