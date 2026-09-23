const test = require('node:test');
const assert = require('node:assert/strict');
const externas = require('./externas');
const boletoCalculo = require('../cobranca/boletoCalculo');

const CNPJ_EMPRESA = '12345678000195';
const CNPJ_CLIENTE = '98765432000110';

/** Uma chave válida: 31 (MG), 2609, CNPJ, modelo 55, série 2, número 123, dígito calculado. */
function chave({ cnpj = CNPJ_EMPRESA, modelo = '55', serie = 2, numero = 123 } = {}) {
  const sem = `31${'2609'}${cnpj}${modelo}${String(serie).padStart(3, '0')}${String(numero).padStart(9, '0')}1${'12345678'}`;
  return `${sem}${externas.dvDaChave(sem)}`;
}

/** Uma linha digitável verdadeira, montada pelo gerador do BB da casa. */
function linha({ vencimento = '2026-10-15', valor = 1500, banco = '001' } = {}) {
  const livre = boletoCalculo.campoLivre({ convenio: '3128557', sequencial: 42 });
  const barras = boletoCalculo.codigoBarras({ vencimento, valor, campoLivre: livre, banco });
  return boletoCalculo.linhaDigitavel(barras);
}

function xmlDaNota({ ch = chave(), dest = CNPJ_CLIENTE, vNF = '1500.00', protocolo = true } = {}) {
  return `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe${ch}"><ide><mod>55</mod><serie>2</serie><nNF>123</nNF><dhEmi>2026-09-10T10:00:00-03:00</dhEmi><finNFe>1</finNFe></ide>`
    + `<emit><CNPJ>${CNPJ_EMPRESA}</CNPJ><xNome>Santissimo Decor</xNome></emit><dest><CNPJ>${dest}</CNPJ></dest>`
    + `<det nItem="1"><prod><cProd>1</cProd><xProd>Vaso</xProd><NCM>44209000</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>1</qCom><vUnCom>1500</vUnCom><vProd>1500</vProd></prod></det>`
    + `<total><ICMSTot><vProd>1500.00</vProd><vNF>${vNF}</vNF></ICMSTot></total></infNFe></NFe>`
    + (protocolo ? `<protNFe><infProt><chNFe>${ch}</chNFe><nProt>131260000012345</nProt><cStat>100</cStat></infProt></protNFe>` : '')
    + '</nfeProc>';
}

test('chave de acesso: tira série, número, CNPJ e mês; recusa tamanho errado e dígito que não confere', () => {
  const ch = chave();
  const lida = externas.lerChave(ch.replace(/(\d{4})/g, '$1 '));
  assert.deepEqual(lida, { chave_acesso: ch, uf: '31', mes_emissao: '2026-09', emitente_documento: CNPJ_EMPRESA, modelo: '55', serie: 2, numero: 123 });
  assert.throws(() => externas.lerChave(ch.slice(0, 43)), /44 números/);
  const trocada = `${ch.slice(0, 43)}${(Number(ch[43]) + 1) % 10}`;
  assert.throws(() => externas.lerChave(trocada), /dígito verificador/);
});

test('valor digitado: vírgula ou ponto, com ou sem R$', () => {
  assert.equal(externas.lerValor('1.234,56'), 1234.56);
  assert.equal(externas.lerValor('R$ 1.500,00'), 1500);
  assert.equal(externas.lerValor('1500.5'), 1500.5);
  assert.equal(externas.lerValor(''), null);
  assert.equal(externas.lerValor('abc'), null);
});

test('nota pelo XML: lê tudo, descarta o arquivo; pela chave: pede o valor', () => {
  const pelaXml = externas.notaDaEntrada({ xml: xmlDaNota() });
  assert.equal(pelaXml.origem, 'xml');
  assert.equal(pelaXml.numero, 123);
  assert.equal(pelaXml.valor_total, 1500);
  assert.equal(pelaXml.data_emissao, '2026-09-10');
  assert.equal(pelaXml.protocolo, '131260000012345');
  assert.ok(!('xml' in pelaXml) && !('itens' in pelaXml), 'o XML e os itens não seguem para gravar');

  const pelaChave = externas.notaDaEntrada({ chave: chave(), valor: '1.500,00' });
  assert.deepEqual([pelaChave.origem, pelaChave.serie, pelaChave.numero, pelaChave.valor_total, pelaChave.mes_emissao], ['chave', 2, 123, 1500, '2026-09']);
  assert.throws(() => externas.notaDaEntrada({ chave: chave() }), /valor total/);
  assert.throws(() => externas.notaDaEntrada({}), /XML da nota ou informe a chave/);
});

test('conferência da nota: emitente de outra empresa ou modelo diferente bloqueiam; o resto só avisa', () => {
  const opcoes = { documentoDaEmpresa: CNPJ_EMPRESA, documentoDoCliente: CNPJ_CLIENTE, valorDoPedido: 1500 };
  const ok = externas.conferirNota(externas.notaDaEntrada({ xml: xmlDaNota() }), opcoes);
  assert.deepEqual(ok, { bloqueios: [], avisos: [] });

  const deOutro = externas.conferirNota(externas.notaDaEntrada({ chave: chave({ cnpj: '11111111000191' }), valor: 1500 }), opcoes);
  assert.match(deOutro.bloqueios[0], /não foi emitida pela empresa/);
  const nfce = externas.conferirNota(externas.notaDaEntrada({ chave: chave({ modelo: '65' }), valor: 1500 }), opcoes);
  assert.match(nfce.bloqueios.join(' '), /modelo 65/);

  const estranha = externas.conferirNota(externas.notaDaEntrada({ xml: xmlDaNota({ dest: '22222222000191', vNF: '1400.00', protocolo: false }) }), opcoes);
  assert.equal(estranha.bloqueios.length, 0);
  assert.match(estranha.avisos.join(' | '), /destinatário/);
  assert.match(estranha.avisos.join(' | '), /protocolo/);
  assert.match(estranha.avisos.join(' | '), /diferente do valor do pedido/);
  const pelaChave = externas.conferirNota(externas.notaDaEntrada({ chave: chave(), valor: 1500 }), opcoes);
  assert.match(pelaChave.avisos[0], /prefira ele/, 'pela chave não dá para conferir tudo: avisa');

  const propria = externas.conferirNota(externas.notaDaEntrada({ chave: chave(), valor: 1500 }), { ...opcoes, chavesProprias: [chave()] });
  assert.match(propria.bloqueios[0], /emitida por aqui/);
});

test('linha digitável: ida e volta com o gerador do BB; banco, valor e vencimento nos dois ciclos do fator', () => {
  const l = linha({ vencimento: '2026-10-15', valor: 1500 });
  const lido = externas.lerLinhaDigitavel(l.texto, '2026-09-21');
  assert.deepEqual([lido.banco, lido.banco_nome, lido.valor, lido.vencimento], ['001', 'Banco do Brasil', 1500, '2026-10-15']);
  assert.equal(lido.linha_digitavel, l.digitos);
  assert.equal(externas.linhaImpressa(lido.linha_digitavel), l.texto);

  // Vencimento do ciclo antigo (antes de 22/02/2025), lido perto daquela época.
  const antiga = externas.lerLinhaDigitavel(linha({ vencimento: '2024-05-10', valor: 99.9 }).digitos, '2024-05-01');
  assert.deepEqual([antiga.vencimento, antiga.valor], ['2024-05-10', 99.9]);

  assert.throws(() => externas.lerLinhaDigitavel(l.digitos.slice(0, 46)), /47 números/);
  assert.throws(() => externas.lerLinhaDigitavel(`${l.digitos}0`), /conta de consumo/);
  assert.throws(() => externas.lerLinhaDigitavel(l.digitos.slice(0, 44)), /código de barras/);
  // Um dígito trocado no primeiro campo: o dígito do campo acusa.
  const errada = `${l.digitos.slice(0, 5)}${(Number(l.digitos[5]) + 1) % 10}${l.digitos.slice(6)}`;
  assert.throws(() => externas.lerLinhaDigitavel(errada), /campo 1/);
  // Valor trocado (último bloco): quem acusa é o dígito geral.
  const valorTrocado = `${l.digitos.slice(0, 46)}${(Number(l.digitos[46]) + 1) % 10}`;
  assert.throws(() => externas.lerLinhaDigitavel(valorTrocado), /dígito geral/);
});

test('conferência do boleto com a parcela: valor e vencimento diferentes só avisam', () => {
  const b = externas.lerLinhaDigitavel(linha({ vencimento: '2026-10-15', valor: 1500 }).digitos, '2026-09-21');
  assert.deepEqual(externas.conferirBoleto(b, { valor: 1500, data_vencimento: '2026-10-15' }), []);
  const avisos = externas.conferirBoleto(b, { valor: 1400, data_vencimento: '2026-10-20T00:00:00.000Z' });
  assert.equal(avisos.length, 2);
  assert.match(avisos[0], /parcela vale/);
  assert.match(avisos[1], /15\/10\/2026/);
});

// ------------------------------------------------ fluxo com uma API falsa

function apiFalsa(tabelas) {
  let proximo = 100;
  const casa = (linha, query = {}) => Object.entries(query).every(([c, v]) => String(linha[c]) === String(v));
  return {
    tabelas,
    async get(caminho, { query } = {}) {
      const nome = caminho.replace('/api/', '');
      if (!(nome in tabelas)) { const e = new Error(`Tabela '${nome}' não encontrada`); e.status = 404; throw e; }
      return tabelas[nome].filter(l => casa(l, query));
    },
    async post(caminho, corpo) {
      const nome = caminho.replace('/api/', '');
      if (!(nome in tabelas)) { const e = new Error(`Tabela '${nome}' não encontrada`); e.status = 404; throw e; }
      const linha = { id: proximo += 1, ...corpo };
      tabelas[nome].push(linha);
      return linha;
    },
    async put(caminho, corpo) {
      const [, , nome, id] = caminho.split('/');
      const linha = tabelas[nome].find(l => String(l.id) === String(id));
      Object.assign(linha, corpo);
      return linha;
    }
  };
}

function base(extra = {}) {
  return apiFalsa({
    pedidos: [{ id: 7, numero: 'PED007', situacao: 'Enviado', cliente_id: 3, valor_final: 1500, forma_pagamento: 'boleto' }, { id: 8, numero: 'PED008', situacao: 'Produção' }],
    clientes: [{ id: 3, cnpj: CNPJ_CLIENTE }],
    configuracao_fiscal: [{ id: 1, cnpj: CNPJ_EMPRESA }],
    notas_fiscais: [],
    notas_fiscais_externas: [],
    pedido_parcelas: [{ id: 71, pedido_id: 7, numero_parcela: 1, valor: 1500, data_vencimento: '2026-10-15' }],
    boletos_externos: [],
    ...extra
  });
}

test('nota de fora: guarda o XML quando veio dele, uma por pedido, e sai com "remover" (só desliga)', async () => {
  const api = base();
  const previa = await externas.informarNota({ api, pedidoId: 7, entrada: { xml: xmlDaNota() }, apenasPrevia: true });
  assert.equal(previa.nota.numero, 123);
  assert.equal(api.tabelas.notas_fiscais_externas.length, 0, 'a prévia não grava');

  const { nota } = await externas.informarNota({ api, pedidoId: 7, entrada: { xml: xmlDaNota() }, usuarioId: 5 });
  assert.equal(nota.origem, 'xml');
  assert.equal(nota.criado_por, 5);
  // Desde 24/09/2026 o arquivo FICA: sem ele não há DANFE nem carta de correção.
  assert.ok(nota.xml.includes('<nfeProc>'), 'o XML é guardado com a nota');
  assert.equal(nota.xml_por, 5);

  const estado = await externas.estadoDaNota(api, 7);
  assert.equal(estado.nota_externa.id, nota.id);
  assert.equal(estado.pode_informar, false);
  await assert.rejects(() => externas.informarNota({ api, pedidoId: 7, entrada: { chave: chave({ numero: 124 }), valor: 1500 } }), /Remova a que está/);

  await externas.removerNota({ api, pedidoId: 7, usuarioId: 5 });
  assert.equal(api.tabelas.notas_fiscais_externas[0].ativo, false, 'fica o rastro');
  assert.equal((await externas.listarNotas(api)).length, 0);
});

test('nota de fora: pedido em produção, com NF-e emitida aqui ou de outra empresa não entra', async () => {
  await assert.rejects(() => externas.informarNota({ api: base(), pedidoId: 8, entrada: { chave: chave(), valor: 1500 } }), /enviado ou entregue/);
  const comPropria = base({ notas_fiscais: [{ id: 1, pedido_id: 7, serie: 2, numero: 99, status_fiscal: 'autorizada' }] });
  await assert.rejects(() => externas.informarNota({ api: comPropria, pedidoId: 7, entrada: { chave: chave(), valor: 1500 } }), /emitida por aqui/);
  await assert.rejects(() => externas.informarNota({ api: base(), pedidoId: 7, entrada: { chave: chave({ cnpj: '11111111000191' }), valor: 1500 } }), /não foi emitida pela empresa/);
});

test('sem o SQL rodado: 409 com sql_pendente', async () => {
  const api = base();
  delete api.tabelas.notas_fiscais_externas;
  await assert.rejects(() => externas.estadoDaNota(api, 7), e => e.status === 409 && e.extra?.sql_pendente === true);
  assert.deepEqual(await externas.listarNotas(api), [], 'quem só enfeita outra tela recebe lista vazia');
});

test('boletos de fora: cada parcela por si, troca o anterior, recusa a que tem boleto do BB', async () => {
  const api = base();
  const l = linha({ vencimento: '2026-10-15', valor: 1500 });
  const previa = await externas.informarBoletos({ api, pedidoId: 7, linhas: [{ parcela_id: 71, linha: l.texto }], apenasPrevia: true, hoje: '2026-09-21' });
  assert.equal(previa.resultados[0].ok, true);
  assert.equal(api.tabelas.boletos_externos.length, 0);

  const gravado = await externas.informarBoletos({ api, pedidoId: 7, linhas: [{ parcela_id: 71, linha: l.texto }, { parcela_id: 999, linha: l.texto }], usuarioId: 5, hoje: '2026-09-21' });
  assert.deepEqual(gravado.resultados.map(r => r.ok), [true, false]);
  assert.equal(gravado.resultados[0].boleto.banco_nome, 'Banco do Brasil');
  assert.equal(gravado.resultados[0].boleto.vencimento, '2026-10-15');

  const outra = linha({ vencimento: '2026-10-20', valor: 1500 });
  await externas.informarBoletos({ api, pedidoId: 7, linhas: [{ parcela_id: 71, linha: outra.digitos }], hoje: '2026-09-21' });
  const vivos = await externas.listarBoletos(api, 7);
  assert.equal(vivos.length, 1, 'a parcela fica com um só');
  assert.equal(vivos[0].vencimento, '2026-10-20');

  const comBB = await externas.informarBoletos({ api, pedidoId: 7, linhas: [{ parcela_id: 71, linha: l.digitos }], hoje: '2026-09-21', ocupadaPeloBB: () => true });
  assert.match(comBB.resultados[0].erro, /Banco do Brasil/);

  const errada = await externas.informarBoletos({ api, pedidoId: 7, linhas: [{ parcela_id: 71, linha: l.digitos.slice(0, 40) }], hoje: '2026-09-21' });
  assert.match(errada.resultados[0].erro, /47 números/);

  await externas.removerBoleto({ api, id: vivos[0].id, usuarioId: 5 });
  assert.equal((await externas.listarBoletos(api, 7)).length, 0);
});

test('boleto de fora não espera o embarque; pedido cancelado ou devolvido por inteiro não recebe', async () => {
  // Cliente que paga adiantado recebe o boleto antes de a mercadoria sair — a
  // NOTA de fora continua só para quem já saiu (decisão do dono, 23/09/2026).
  const emProducao = base({
    pedidos: [{ id: 8, numero: 'PED008', situacao: 'Produção', cliente_id: 3, valor_final: 1500, forma_pagamento: 'boleto' }],
    pedido_parcelas: [{ id: 81, pedido_id: 8, numero_parcela: 1, valor: 1500, data_vencimento: '2026-10-15' }]
  });
  const l = linha({ vencimento: '2026-10-15', valor: 1500 });
  const r = await externas.informarBoletos({ api: emProducao, pedidoId: 8, linhas: [{ parcela_id: 81, linha: l.texto }], usuarioId: 5, hoje: '2026-09-21' });
  assert.equal(r.resultados[0].ok, true);
  assert.equal(emProducao.tabelas.boletos_externos.length, 1);

  for (const pedido of [
    { id: 9, numero: 'PED009', situacao: 'Cancelado', cliente_id: 3, valor_final: 1500, forma_pagamento: 'boleto' },
    { id: 9, numero: 'PED009', situacao: 'Enviado', devolucao: 'total', cliente_id: 3, valor_final: 1500, forma_pagamento: 'boleto' }
  ]) {
    const api = base({ pedidos: [pedido], pedido_parcelas: [{ id: 91, pedido_id: 9, numero_parcela: 1, valor: 1500, data_vencimento: '2026-10-15' }] });
    await assert.rejects(
      () => externas.informarBoletos({ api, pedidoId: 9, linhas: [{ parcela_id: 91, linha: l.texto }], hoje: '2026-09-21' }),
      e => e.status === 409 && /não recebe boleto de fora/.test(e.message),
      JSON.stringify(pedido)
    );
  }
});

test('boleto de fora da parcela: pelo id, e pelo número nos antigos', () => {
  const lista = [{ id: 1, parcela_id: 71, ativo: true }, { id: 2, parcela_id: null, numero_parcela: 2, ativo: true }, { id: 3, parcela_id: 73, ativo: false }];
  assert.equal(externas.boletoExternoDaParcela(lista, { id: 71, numero_parcela: 1 }).id, 1);
  assert.equal(externas.boletoExternoDaParcela(lista, { id: 72, numero_parcela: 2 }).id, 2);
  assert.equal(externas.boletoExternoDaParcela(lista, { id: 73, numero_parcela: 3 }), null, 'desligado não vale');
});

// ------------------------------------------------ XML e cartas de correção
// A DANFE e a carta de correção são desenhadas em cima do `nfeProc`: sem o
// XML guardado não existe documento nenhum. Daí o caminho de anexar depois.

/** Um procEventoNFe de carta de correção, como a SEFAZ devolve. */
function xmlDaCarta({ ch = chave(), seq = 1, correcao = 'Corrigido o nome do transportador da nota', status = '135', tipo = '110110', prot = '131260000000999' } = {}) {
  return `<?xml version="1.0"?><procEventoNFe versao="1.00"><evento><infEvento Id="ID${tipo}${ch}0${seq}">`
    + `<chNFe>${ch}</chNFe><dhEvento>2026-09-20T10:00:00-03:00</dhEvento><tpEvento>${tipo}</tpEvento><nSeqEvento>${seq}</nSeqEvento>`
    + `<detEvento versao="1.00"><descEvento>Carta de Correcao</descEvento><xCorrecao>${correcao}</xCorrecao></detEvento>`
    + `</infEvento></evento><retEvento><infEvento><cStat>${status}</cStat><xMotivo>Evento registrado</xMotivo>`
    + `<nProt>${prot}</nProt><dhRegEvento>2026-09-20T10:00:05-03:00</dhRegEvento></infEvento></retEvento></procEventoNFe>`;
}

/** Como `base`, mas com a nota de fora já gravada e o SQL desta fase rodado. */
function comNota({ xml = null } = {}) {
  const api = base({ notas_fiscais_externas_eventos: [] });
  api.tabelas.notas_fiscais_externas.push({
    id: 900, pedido_id: 7, origem: xml ? 'xml' : 'chave', chave_acesso: chave(), modelo: '55', serie: 2, numero: 123,
    valor_total: 1500, emitente_documento: CNPJ_EMPRESA, emitente_nome: null, destinatario_documento: null,
    data_emissao: null, protocolo: null, ativo: true,
    // A coluna existe (SQL rodado): vem null quando ninguém anexou nada.
    xml, xml_em: null, xml_por: null
  });
  return api;
}

test('carta de correção de fora: lê o procEventoNFe e recusa o que não é dela', () => {
  const lida = externas.lerCartaCorrecaoXml(xmlDaCarta({ seq: 2 }));
  assert.equal(lida.sequencia, 2);
  assert.equal(lida.chave_acesso, chave());
  assert.equal(lida.protocolo, '131260000000999');
  assert.equal(lida.data_evento, '2026-09-20T10:00:05-03:00');
  assert.match(lida.correcao, /transportador/);

  assert.throws(() => externas.lerCartaCorrecaoXml(''), /vazio/);
  assert.throws(() => externas.lerCartaCorrecaoXml('<!DOCTYPE x><procEventoNFe/>'), /não é o XML/);
  assert.throws(() => externas.lerCartaCorrecaoXml(xmlDaCarta({ tipo: '110111' })), /tipo 110111/);
  assert.throws(() => externas.lerCartaCorrecaoXml(xmlDaCarta({ correcao: '' })), /texto da correção/);
  assert.throws(() => externas.lerCartaCorrecaoXml(xmlDaCarta({ status: '573' })), /não registrou/);
  assert.throws(() => externas.lerCartaCorrecaoXml('<nfeProc><NFe/></nfeProc>'), /não é o XML de um evento/);
});

test('anexar o XML numa nota informada pela chave: completa o que faltava e avisa a divergência', async () => {
  const api = comNota();
  await assert.rejects(() => externas.xmlDaNota(api, 7), e => {
    assert.equal(e.status, 409);
    assert.equal(e.extra.falta_xml, true);
    return true;
  });

  const { nota, avisos } = await externas.anexarXmlDaNota({ api, pedidoId: 7, xml: xmlDaNota(), usuarioId: 5 });
  assert.ok(nota.xml.includes('<nfeProc>'));
  assert.equal(nota.protocolo, '131260000012345', 'o que estava em branco é preenchido');
  assert.equal(nota.emitente_nome, 'Santissimo Decor');
  assert.equal(nota.data_emissao, '2026-09-10');
  assert.equal(nota.xml_por, 5);
  assert.deepEqual(avisos, []);

  const guardada = await externas.xmlDaNota(api, 7);
  assert.ok(guardada.xml.includes('<nfeProc>'));

  // XML de outra nota não entra por baixo do pano.
  await assert.rejects(
    () => externas.anexarXmlDaNota({ api, pedidoId: 7, xml: xmlDaNota({ ch: chave({ numero: 124 }) }) }),
    /é de outra nota/
  );
  // Valor diferente do informado vira aviso, nunca sobrescrita silenciosa.
  const outra = comNota();
  const r = await externas.anexarXmlDaNota({ api: outra, pedidoId: 7, xml: xmlDaNota({ vNF: '1400.00' }) });
  assert.match(r.avisos.join(' '), /valor do XML/);
  assert.equal(outra.tabelas.notas_fiscais_externas[0].valor_total, 1500, 'o valor informado continua valendo');
});

test('sem o SQL da fase, os documentos da nota de fora avisam em vez de quebrar', async () => {
  const api = base();
  // Nota gravada antes do SQL: a linha nem tem a coluna `xml`.
  api.tabelas.notas_fiscais_externas.push({ id: 900, pedido_id: 7, chave_acesso: chave(), serie: 2, numero: 123, ativo: true });
  await assert.rejects(() => externas.xmlDaNota(api, 7), e => {
    assert.equal(e.status, 409);
    assert.equal(e.extra.sql_pendente, true);
    assert.match(e.message, /nfe_externa_xml_cce\.sql/);
    return true;
  });
  const lista = await externas.listarCartas(api, 7);
  assert.equal(lista.sql_pendente, true);
  assert.deepEqual(lista.cartas, []);
});

test('cartas de correção de fora: pelo XML do evento ou à mão, sem repetir sequência', async () => {
  const api = comNota({ xml: xmlDaNota() });

  const pelaXml = await externas.informarCarta({ api, pedidoId: 7, entrada: { xml: xmlDaCarta({ seq: 1 }) }, usuarioId: 5 });
  assert.equal(pelaXml.carta.sequencia, 1);
  assert.equal(pelaXml.carta.origem, 'xml');
  assert.equal(pelaXml.carta.tem_xml, true);
  assert.equal(pelaXml.carta.protocolo, '131260000000999');

  // A porta do XML continua aberta com a nota já tendo carta (decisão do dono).
  const segunda = await externas.informarCarta({ api, pedidoId: 7, entrada: { xml: xmlDaCarta({ seq: 2, correcao: 'Ajustada a natureza da operacao' }) } });
  assert.equal(segunda.carta.sequencia, 2);

  // E a mão também: sequência, texto e protocolo digitados.
  const aMao = await externas.informarCarta({
    api, pedidoId: 7,
    entrada: { sequencia: 3, correcao: 'Peso bruto corrigido para 12,5 kg', protocolo: '131260000001111', data_evento: '2026-09-21T09:00:00-03:00' }
  });
  assert.equal(aMao.carta.origem, 'manual');
  assert.equal(aMao.carta.tem_xml, false);

  await assert.rejects(() => externas.informarCarta({ api, pedidoId: 7, entrada: { sequencia: 3, correcao: 'Outra correcao qualquer aqui' } }), /já está registrada/);
  await assert.rejects(() => externas.informarCarta({ api, pedidoId: 7, entrada: { sequencia: 4, correcao: 'curto' } }), /15 caracteres/);
  await assert.rejects(() => externas.informarCarta({ api, pedidoId: 7, entrada: { sequencia: 99, correcao: 'Uma correcao bem grande aqui' } }), /de 1 a 20/);
  await assert.rejects(
    () => externas.informarCarta({ api, pedidoId: 7, entrada: { xml: xmlDaCarta({ ch: chave({ numero: 124 }), seq: 5 }) } }),
    /de outra nota/
  );

  const lista = await externas.listarCartas(api, 7);
  assert.deepEqual(lista.cartas.map(c => c.sequencia), [1, 2, 3], 'em ordem de sequência');
  assert.equal(lista.nota.tem_xml, true);

  const { carta } = await externas.lerCarta(api, 7, 2);
  assert.ok(carta.xml.includes('procEventoNFe'));

  await externas.removerCarta({ api, pedidoId: 7, sequencia: 2, usuarioId: 5 });
  assert.equal(api.tabelas.notas_fiscais_externas_eventos.find(c => c.sequencia === 2).ativo, false, 'fica o rastro');
  assert.deepEqual((await externas.listarCartas(api, 7)).cartas.map(c => c.sequencia), [1, 3]);
  // Com a sequência 2 desligada, dá para informar outra no lugar.
  await externas.informarCarta({ api, pedidoId: 7, entrada: { sequencia: 2, correcao: 'Correcao refeita com o texto certo' } });
  assert.deepEqual((await externas.listarCartas(api, 7)).cartas.map(c => c.sequencia), [1, 2, 3]);
});
