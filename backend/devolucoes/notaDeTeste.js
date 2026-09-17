/**
 * NF-e de devolução de mentira para os testes (xmlDevolucao.test.js e
 * devolucoesController.test.js): o XML que um cliente emitiria, enxuto.
 */
const CHAVE_DA_DEVOLUCAO = '31260911222333000144550010000004561000004567';
const CHAVE_DA_VENDA = '31260999888777000166550020000001231000001239';

function notaDeDevolucao({ finalidade = 4, destinatario = '99888777000166', referencia = CHAVE_DA_VENDA, itens, protocolo = true } = {}) {
  const det = (itens || [
    { codigo: 'CLI-9', nome: 'CAIXA INFINITO - P (15 X 30 X 8H) - JEQUITIBA', ncm: '44201000', qtd: '1.0000', un: '592.8400', total: '592.84' },
    { codigo: 'XYZ', nome: 'Bandeja Oval &amp; Cia', ncm: '44201000', qtd: '2.0000', un: '300.0000', total: '600.00' }
  ]).map((i, n) => `<det nItem="${n + 1}"><prod><cProd>${i.codigo}</cProd><cEAN>SEM GTIN</cEAN><xProd>${i.nome}</xProd><NCM>${i.ncm}</NCM><CFOP>5202</CFOP><uCom>UN</uCom><qCom>${i.qtd}</qCom><vUnCom>${i.un}</vUnCom><vProd>${i.total}</vProd></prod><imposto></imposto></det>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${CHAVE_DA_DEVOLUCAO}" versao="4.00">`
    + `<ide><cUF>31</cUF><natOp>Devolucao de compra</natOp><mod>55</mod><serie>1</serie><nNF>456</nNF><dhEmi>2026-09-15T10:30:00-03:00</dhEmi><tpNF>1</tpNF><finNFe>${finalidade}</finNFe>`
    + (referencia ? `<NFref><refNFe>${referencia}</refNFe></NFref>` : '') + '</ide>'
    + '<emit><CNPJ>11222333000144</CNPJ><xNome>Basica Home Ltda</xNome></emit>'
    + `<dest><CNPJ>${destinatario}</CNPJ><xNome>Santissimo Decor</xNome></dest>${det}`
    + '<total><ICMSTot><vProd>1192.84</vProd><vDesc>0.00</vDesc><vNF>1192.84</vNF></ICMSTot></total></infNFe></NFe>'
    + (protocolo ? `<protNFe><infProt><chNFe>${CHAVE_DA_DEVOLUCAO}</chNFe><nProt>131260000012345</nProt><cStat>100</cStat></infProt></protNFe>` : '')
    + '</nfeProc>';
}

module.exports = { notaDeDevolucao, CHAVE_DA_DEVOLUCAO, CHAVE_DA_VENDA };
