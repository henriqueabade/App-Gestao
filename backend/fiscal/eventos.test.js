/**
 * Cancelamento da NF-e (backend/fiscal/eventos.js) com API e SEFAZ de mentira:
 * evento assinado, registrado (135) vira "cancelada" com o procEventoNFe;
 * recusa (por exemplo 573) e falha de rede devolvem a nota a "autorizada";
 * o que a SEFAZ nem recebe (nota não autorizada, justificativa curta) é
 * barrado antes.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { gerarPfx } = require('./certificadoDeTeste');
const { abrirPfx } = require('./certificado');
const configuracao = require('./configuracaoFiscal');
const eventos = require('./eventos');

const SENHA = 'segredo';
const CERT = abrirPfx(gerarPfx({ cn: 'SANTISSIMO DECOR LTDA:44039257000122', senha: SENHA }), SENHA);
const CHAVE = '31260944039257000122550010000003621140003053';
const NFE_ASSINADA = `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${CHAVE}" versao="4.00"><ide><cUF>31</cUF></ide></infNFe><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo></SignedInfo></Signature></NFe>`;
const CONFIG = { id: 1, cnpj: '44039257000122', uf: 'MG', ambiente: 'homologacao', serie_homologacao: 1, proximo_numero_homologacao: 3 };

function tabelasBase() {
  return {
    configuracao_fiscal: [{ ...CONFIG }],
    pedidos: [{ id: 55, numero: '2548' }],
    notas_fiscais: [{
      id: 10, pedido_id: 55, ambiente: 'homologacao', serie: 1, numero: 2, status_fiscal: 'autorizada', chave_acesso: CHAVE, protocolo: '131260000123456',
      xml_envio: NFE_ASSINADA, xml_autorizado: `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${NFE_ASSINADA}<protNFe versao="4.00"><infProt><cStat>100</cStat></infProt></protNFe></nfeProc>`
    }],
    notas_fiscais_eventos: []
  };
}

function apiFalsa(tabelas = tabelasBase()) {
  const dados = JSON.parse(JSON.stringify(tabelas));
  let proximoId = 1000;
  const partes = path => path.replace(/^\/api\//, '').split('/');
  const falha = (msg, status) => { const e = new Error(msg); e.status = status; return e; };
  return {
    dados,
    async get(path, { query = {} } = {}) {
      const [t, id] = partes(path);
      if (!dados[t]) throw falha(`Tabela ${t} não existe`, 404);
      if (id) return dados[t].find(l => String(l.id) === id) || null;
      return dados[t].filter(l => Object.entries(query).every(([c, v]) => String(l[c]) === String(v)));
    },
    async post(path, body) { const [t] = partes(path); const linha = { id: proximoId++, ...body }; dados[t].push(linha); return linha; },
    async put(path, body) { const [t, id] = partes(path); const linha = dados[t].find(l => String(l.id) === id); if (!linha) throw falha('não há', 404); Object.assign(linha, body); return linha; },
    async delete() { return {}; }
  };
}

const envelope = corpo => `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">${corpo}</nfeResultMsg></soap:Body></soap:Envelope>`;
const retEvento = (cStat, xMotivo, nProt = '131260000222222') => `<retEvento versao="1.00"><infEvento><tpAmb>2</tpAmb><verAplic>MG</verAplic><cOrgao>31</cOrgao><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo><chNFe>${CHAVE}</chNFe><tpEvento>110111</tpEvento><xEvento>Cancelamento</xEvento><nSeqEvento>1</nSeqEvento><dhRegEvento>2026-09-15T16:00:00-03:00</dhRegEvento>${nProt ? `<nProt>${nProt}</nProt>` : ''}</infEvento></retEvento>`;
const retEnvEvento = (cStat, xMotivo, dentro = '') => `<retEnvEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>10</idLote><tpAmb>2</tpAmb><verAplic>MG</verAplic><cOrgao>31</cOrgao><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo>${dentro}</retEnvEvento>`;

function montar({ tabelas, resposta } = {}) {
  configuracao.limparCache();
  const api = apiFalsa(tabelas);
  const chamadas = [];
  const transporte = async (url, corpo) => {
    chamadas.push({ url, corpo });
    const r = typeof resposta === 'function' ? resposta(corpo) : resposta;
    if (r instanceof Error) throw r;
    return { status: 200, corpo: envelope(r) };
  };
  const cancelar = (justificativa, notaId = 10) => eventos.cancelar({ api, notaId, justificativa, certificado: CERT, transporte, usuarioId: 9, agora: () => new Date('2026-09-15T15:30:00-03:00') });
  return { api, chamadas, cancelar };
}

test('cancelamento registrado (135): nota cancelada com o procEventoNFe, justificativa e eventos; o evento vai assinado', async () => {
  const t = montar({ resposta: retEnvEvento('128', 'Lote de Evento Processado', retEvento('135', 'Evento registrado e vinculado a NF-e')) });
  const r = await t.cancelar('Pedido cancelado pelo cliente antes do embarque');
  assert.equal(r.cancelada, true);
  assert.equal(r.sefaz.cStat, '135');
  assert.equal(r.sefaz.protocolo, '131260000222222');
  assert.equal(r.nota.status_fiscal, 'cancelada');
  const nota = t.api.dados.notas_fiscais[0];
  assert.equal(nota.status_fiscal, 'cancelada');
  assert.equal(nota.justificativa_cancelamento, 'Pedido cancelado pelo cliente antes do embarque');
  assert.equal(nota.cancelada_em, '2026-09-15T16:00:00-03:00');
  assert.ok(nota.xml_cancelamento.startsWith('<?xml version="1.0" encoding="UTF-8"?><procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><evento'));
  assert.ok(nota.xml_cancelamento.includes('<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">') && nota.xml_cancelamento.endsWith('</retEvento></procEventoNFe>'));
  assert.deepEqual(t.api.dados.notas_fiscais_eventos.map(e => `${e.tipo}:${e.status_novo}`), ['cancelamento:cancelamento_pendente', 'cancelada:cancelada']);
  assert.match(t.chamadas[0].url, /NFeRecepcaoEvento4$/);
  assert.match(t.chamadas[0].corpo, new RegExp(`<envEvento [^>]*><idLote>10</idLote><evento [^>]*><infEvento Id="ID110111${CHAVE}01"><cOrgao>31</cOrgao><tpAmb>2</tpAmb><CNPJ>44039257000122</CNPJ><chNFe>${CHAVE}</chNFe><dhEvento>2026-09-15T15:30:00-03:00</dhEvento><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>Cancelamento</descEvento><nProt>131260000123456</nProt><xJust>Pedido cancelado pelo cliente antes do embarque</xJust></detEvento></infEvento><Signature`));
});

test('recusa da SEFAZ (573) e falha de rede deixam a nota autorizada como estava, com o motivo registrado', async () => {
  const t = montar({ resposta: retEnvEvento('128', 'Lote de Evento Processado', retEvento('573', 'Rejeicao: Duplicidade de Evento', '')) });
  await assert.rejects(t.cancelar('Duplicidade proposital para o teste'), e => e.status === 422 && e.message === 'SEFAZ 573: Rejeicao: Duplicidade de Evento' && e.extra.sefaz.cStat === '573');
  assert.equal(t.api.dados.notas_fiscais[0].status_fiscal, 'autorizada');
  assert.equal(t.api.dados.notas_fiscais[0].xml_cancelamento, undefined);
  assert.deepEqual(t.api.dados.notas_fiscais_eventos.map(e => e.tipo), ['cancelamento', 'rejeitada']);

  const rede = montar({ resposta: Object.assign(new Error('A SEFAZ não aceitou a conexão agora.'), { status: 502 }) });
  await assert.rejects(rede.cancelar('Justificativa suficiente para o teste'), e => e.status === 502);
  assert.equal(rede.api.dados.notas_fiscais[0].status_fiscal, 'autorizada');
  assert.deepEqual(rede.api.dados.notas_fiscais_eventos.map(e => e.tipo), ['cancelamento', 'erro']);
});

test('o que é barrado antes de ir à SEFAZ: nota não autorizada, sem protocolo, justificativa curta ou longa', async () => {
  const t = montar({ resposta: retEnvEvento('128', 'x', retEvento('135', 'ok')) });
  await assert.rejects(t.cancelar('curta demais'), /entre 15 e 255/);
  await assert.rejects(t.cancelar('x'.repeat(256)), /entre 15 e 255/);
  const tabelas = tabelasBase();
  tabelas.notas_fiscais[0].status_fiscal = 'rejeitada';
  const t2 = montar({ tabelas, resposta: retEnvEvento('128', 'x', retEvento('135', 'ok')) });
  await assert.rejects(t2.cancelar('Justificativa suficiente para o teste'), e => e.status === 409 && /Só uma nota autorizada/.test(e.message));
  const tabelas3 = tabelasBase();
  tabelas3.notas_fiscais[0].protocolo = null;
  const t3 = montar({ tabelas: tabelas3, resposta: retEnvEvento('128', 'x', retEvento('135', 'ok')) });
  await assert.rejects(t3.cancelar('Justificativa suficiente para o teste'), /protocolo/);
  await assert.rejects(t.cancelar('Justificativa suficiente para o teste', 999), e => e.status === 404);
  assert.equal(t.chamadas.length, 0);
});
