/**
 * NF-e e boletos emitidos FORA do sistema (fase 3, 21/09/2026): o modal
 * "NF-e e boletos de fora" (pedido-dados-externos.js), o botão e as tags no
 * Visualizar pedido, a linha do "Aguardando NF-e" do Financeiro e o "Gerar
 * boletos", que não oferece a parcela já cobrada por fora. As contas e a
 * gravação moram no backend (backend/fiscal/externas.js, com teste próprio).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..');
const ler = (...partes) => fs.readFileSync(path.join(RAIZ, ...partes), 'utf8');
const FONTE = ler('js', 'modals', 'pedido-dados-externos.js');
const HTML = ler('html', 'modals', 'pedidos', 'dados-externos.html');
const VISUALIZAR = ler('js', 'modals', 'pedido-visualizar.js');
const VIS_HTML = ler('html', 'modals', 'pedidos', 'visualizar.html');
const FINANCEIRO = ler('js', 'modals', 'financeiro-modais.js');
const GERAR = ler('js', 'modals', 'pedido-gerar-boletos.js');
const plano = v => JSON.parse(JSON.stringify(v));
const semEspacoFixo = s => String(s).replace(/\s/g, ' ');

function puras() {
  const inicio = FONTE.indexOf('const TAMANHO_MAXIMO_DO_XML');
  const fim = FONTE.indexOf('// ------------------------------------------------- fim das funções puras');
  assert.ok(inicio !== -1 && fim > inicio, 'o bloco de funções puras não foi encontrado');
  return vm.runInContext(`${FONTE.slice(inicio, fim)}
({ chaveEmGrupos, documentoFormatado, linhasDaNota, etiquetaDaNota, estadoDaParcela, frasedaPrevia, mensagemDeErro })`, vm.createContext({}));
}

/** O texto de uma função pelo nome (o corpo começa no `{` depois de `) `: os parâmetros podem ter `{ }`). */
function textoDaFuncao(fonte, nome) {
  const inicio = fonte.indexOf(`function ${nome}(`);
  assert.ok(inicio !== -1, `sem a função ${nome}`);
  let nivel = 0;
  let i = fonte.indexOf(') {', inicio) + 2;
  for (; i < fonte.length; i += 1) {
    if (fonte[i] === '{') nivel += 1;
    if (fonte[i] === '}') { nivel -= 1; if (nivel === 0) break; }
  }
  return fonte.slice(inicio, i + 1);
}

/** Recorta uma função pelo nome e a executa isolada (com as dependências em `extras`). */
function recortar(fonte, nome, extras = '') {
  return vm.runInContext(`${extras}\n${textoDaFuncao(fonte, nome)}\n${nome}`, vm.createContext({}));
}

test('modal: a nota de fora aparece organizada (NF-e, valor, emissão, emitente, chave em grupos)', () => {
  const f = puras();
  const chave = '31260912345678000195550020000001231123456780';
  assert.strictEqual(f.chaveEmGrupos(chave), '3126 0912 3456 7800 0195 5500 2000 0001 2311 2345 6780');
  assert.strictEqual(f.documentoFormatado('12345678000195'), '12.345.678/0001-95');
  assert.strictEqual(f.documentoFormatado('12345678909'), '123.456.789-09');
  const linhas = plano(f.linhasDaNota({ serie: 2, numero: 123, valor_total: 1500, data_emissao: '2026-09-10', emitente_nome: 'Santíssimo', emitente_documento: '12345678000195', chave_acesso: chave, protocolo: '1312', origem: 'xml' }));
  assert.deepStrictEqual(linhas.map(([r]) => r), ['NF-e', 'Valor', 'Emissão', 'Emitente', 'Chave de acesso', 'Protocolo', 'Informada']);
  assert.strictEqual(linhas[0][1], 'série 2 · nº 123');
  assert.strictEqual(semEspacoFixo(linhas[1][1]), 'R$ 1.500,00');
  assert.strictEqual(linhas[2][1], '10/09/2026');
  assert.strictEqual(linhas[6][1], 'pelo XML');
  // Pela chave só se sabe o mês.
  const pelaChave = plano(f.linhasDaNota({ serie: 2, numero: 5, valor_total: 10, mes_emissao: '2026-09', chave_acesso: chave, origem: 'chave' }));
  assert.strictEqual(pelaChave.find(([r]) => r === 'Emissão')[1], '09/2026');
  assert.strictEqual(pelaChave.at(-1)[1], 'pela chave de acesso');
  assert.deepStrictEqual(plano(f.linhasDaNota(null)), []);
});

test('modal: etiqueta da nota e o estado de cada parcela (do BB, de fora ou livre)', () => {
  const f = puras();
  assert.deepStrictEqual(plano(f.etiquetaDaNota({ nota_externa: { serie: 2, numero: 9 } })), ['badge-info', 'NF-e 2/9 · de fora']);
  assert.deepStrictEqual(plano(f.etiquetaDaNota({ nota_propria: { serie: 1, numero: 4 } })), ['badge-success', 'NF-e 1/4 · emitida aqui']);
  assert.deepStrictEqual(plano(f.etiquetaDaNota({})), ['badge-neutral', 'Sem nota']);

  const deFora = plano(f.estadoDaParcela({ boleto_externo: { banco_nome: 'Itaú', vencimento: '2026-10-15', valor: 1500, linha_impressa: '34191.09008 ...' } }));
  assert.strictEqual(deFora.tipo, 'externo');
  assert.strictEqual(semEspacoFixo(deFora.texto), 'De fora · Itaú · vence 15/10/2026 · R$ 1.500,00');
  assert.deepStrictEqual(plano(f.estadoDaParcela({ tem_boleto_vivo: true, boleto: { status: 'registrado' } })), { tipo: 'bb', texto: 'Boleto do BB · registrado' });
  assert.strictEqual(f.estadoDaParcela({}).tipo, 'livre');

  const ok = plano(f.frasedaPrevia({ ok: true, boleto: { banco_nome: 'Itaú', vencimento: '2026-10-15', valor: 1500 }, avisos: [] }));
  assert.deepStrictEqual([ok.tom, semEspacoFixo(ok.texto)], ['ok', 'Itaú · vence 15/10/2026 · R$ 1.500,00']);
  assert.strictEqual(f.frasedaPrevia({ ok: true, boleto: {}, avisos: ['O boleto vence em outra data.'] }).tom, 'aviso');
  assert.deepStrictEqual(plano(f.frasedaPrevia({ ok: false, erro: 'A linha digitável não confere (campo 1).' })), { tom: 'erro', texto: 'A linha digitável não confere (campo 1).' });
  assert.match(f.mensagemDeErro(409, { sql_pendente: true }), /sql\/nfe_boletos_externos\.sql/);
});

test('modal: confere antes de gravar, XML descartado, remover pede confirmação, avisa quem está aberto', () => {
  assert.ok(FONTE.includes("fetchApi(`/api/fiscal/pedidos/${id}/nfe-externa/previa`, comoJson(entrada))"), 'confere a nota antes');
  assert.ok(FONTE.includes("fetchApi(`/api/fiscal/pedidos/${id}/nfe-externa`, comoJson(entradaNota))"), 'grava o que foi conferido');
  assert.ok(FONTE.includes("fetchApi(`/api/cobranca/pedidos/${id}/boletos-externos/previa`"), 'confere a linha digitável ao colar');
  assert.ok(FONTE.includes("fetchApi(`/api/cobranca/pedidos/${id}/boletos-externos`, comoJson({ linhas }))"));
  assert.ok(FONTE.includes("{ method: 'DELETE' }"));
  // Remover a nota, remover um boleto e remover uma carta de correção.
  assert.ok((FONTE.match(/window\.DialogPadrao\?\.confirm\?\.\(/g) || []).length === 3, 'toda remoção pede confirmação');
  assert.ok(FONTE.includes("avisarQuemEstaAberto('nfe:externa')") && FONTE.includes("avisarQuemEstaAberto('boletos:alterados')"));
  assert.ok(FONTE.includes('if (arquivo.size > TAMANHO_MAXIMO_DO_XML)'));
  assert.ok(!/innerHTML|window\.confirm\(/.test(FONTE), 'montado por createElement, sem confirm() do sistema');
  assert.ok(FONTE.includes("window.Modal?.signalReady?.(overlayId)"));
  // Anatomia do HTML.
  assert.match(HTML, /id="dadosExternosOverlay" class="hidden fixed inset-0[^"]*ctl-padrao"/);
  assert.ok(HTML.includes('id="notaExternaXml" type="file" accept=".xml'), 'escolhe o XML');
  assert.ok(HTML.includes('id="notaExternaChave"') && HTML.includes('id="notaExternaValor"'), 'ou a chave + o valor');
  assert.match(HTML, /id="gravarNotaExterna"[^>]*data-perm="financeiro\.nfe\.emit"/);
  assert.match(HTML, /id="gravarBoletosExternos"[^>]*data-perm="financeiro\.boleto\.emit"/);
});

test('Visualizar: o botão com algo a informar (ou a ver); a NOTA de fora só depois do embarque, o BOLETO não espera', () => {
  const dependencias = ['pagaComBoleto', 'pedidoJaSaiu', 'pedidoCancelado'].map(n => textoDaFuncao(VISUALIZAR, n)).join('\n');
  const precisa = recortar(VISUALIZAR, 'precisaDeDadosDeFora', dependencias);
  const enviado = { situacao: 'Enviado', forma_pagamento: 'boleto' };
  const livre = { parcelas: [{ tem_boleto_vivo: false }] };
  assert.strictEqual(precisa({ pedido: { situacao: 'Produção' }, notas: [], boletos: livre }), false, 'sem forma boleto e sem ter saído: nada a informar');
  // Cliente que paga adiantado: o boleto entra antes do embarque (23/09/2026).
  assert.strictEqual(precisa({ pedido: { situacao: 'Produção', forma_pagamento: 'boleto' }, notas: [], boletos: livre }), true, 'em produção, falta boleto');
  assert.strictEqual(precisa({ pedido: { situacao: 'Cancelado', forma_pagamento: 'boleto' }, notas: [], boletos: livre }), false, 'cancelado não recebe nada');
  assert.strictEqual(precisa({ pedido: enviado, notas: [], boletos: livre }), true, 'sem nota nenhuma');
  assert.strictEqual(precisa({ pedido: enviado, notas: [{ status_fiscal: 'autorizada' }], boletos: { parcelas: [{ tem_boleto_vivo: true }] } }), false, 'nota daqui e boletos do BB: nada a informar');
  assert.strictEqual(precisa({ pedido: enviado, notas: [{ status_fiscal: 'autorizada' }], boletos: livre }), true, 'falta boleto numa parcela');
  assert.strictEqual(precisa({ pedido: { situacao: 'Entregue', forma_pagamento: 'pix' }, notas: [{ status_fiscal: 'autorizada' }], boletos: livre }), false, 'em Pix, parcela sem boleto não é falta');
  assert.strictEqual(precisa({ pedido: enviado, notas: [{ status_fiscal: 'autorizada' }], boletos: { parcelas: [{ tem_boleto_vivo: false, boleto_externo: { id: 1 } }] } }), true, 'tem dado de fora para ver ou tirar');
  assert.strictEqual(precisa({ pedido: { ...enviado, devolucao: 'total' }, notas: [], boletos: livre }), false, 'devolvido por inteiro: não saiu mais');

  assert.match(VIS_HTML, /id="visualizarPedidoDadosExternos" type="button" class="hidden btn-neutral ctl-botao ctl-botao--pequeno/);
  assert.ok(VISUALIZAR.includes("abrirPorCima('modals/pedidos/dados-externos.html', '../js/modals/pedido-dados-externos.js', 'dadosExternos');"));
  assert.ok(VISUALIZAR.includes("'dadosExternos'") && VISUALIZAR.includes("'nfe:externa'"), 'ao informar, o Visualizar volta atualizado');
  assert.ok(VISUALIZAR.includes('const falta = estado.parcelas.some(l => !l?.tem_boleto_vivo && !l?.boleto_externo);'), 'parcela cobrada por fora não conta como faltando');

  const tags = recortar(VISUALIZAR, 'tagsDoEmbarque');
  const comFora = plano(tags({ nfe_dispensada: true }, [], 0, { parcelas: 2, registrados: 0, externos: 2 }, [], { serie: 2, numero: 700, valor_total: 1500 }));
  assert.deepStrictEqual(comFora.map(t => [t.classe, semEspacoFixo(t.texto)]), [['badge-info', 'NF-e 2/700 · de fora · R$ 1.500,00'], ['badge-info', 'Boletos de fora 2/2']], 'a de fora vence o "Sem nota fiscal"');
  const rotulo = recortar(VISUALIZAR, 'rotuloDoBoletoExterno');
  assert.deepStrictEqual(plano(rotulo({ banco_nome: 'Itaú', vencimento: '2026-10-15', linha_digitavel: '341' })), { classe: 'badge-info', texto: 'de fora · Itaú · vence 15/10/2026', linha: '341' });
});

test('Financeiro e "Gerar boletos": a linha do Aguardando NF-e abre o modal; parcela cobrada por fora não se marca', () => {
  assert.ok(FINANCEIRO.includes("criar('button', 'btn-neutral px-3 py-1 rounded-md text-xs font-medium text-white', 'NF-e de fora')"));
  assert.ok(FINANCEIRO.includes("abrirModalDePedido('modals/pedidos/dados-externos.html', '../js/modals/pedido-dados-externos.js', 'dadosExternos', { esperar: true, aoFechar: carregarLista });"), 'ao fechar, a lista relê (o pedido sai dela)');
  const linha = recortar(GERAR, 'linhaDaParcela', "const ROTULO_STATUS = {}; const MOTIVOS_BAIXA = {}; const diaCurto = iso => { const m = /^(\\d{4})-(\\d{2})-(\\d{2})/.exec(String(iso || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };");
  const l = plano(linha({ parcela: { id: 2, numero_parcela: 2, valor: 1000, data_vencimento: '2027-02-17' }, tem_boleto_vivo: false, boleto_externo: { banco_nome: 'Itaú', vencimento: '2027-02-17', linha_impressa: '34191...' } }));
  assert.deepStrictEqual([l.podeGerar, l.classe, l.rotulo], [false, 'badge-info', 'Boleto de fora · Itaú']);
  assert.match(l.detalhe, /vence 17\/02\/2027/);
});

/**
 * DANFE e carta de correção da nota de fora (24/09/2026). Os dois documentos
 * são desenhados em cima do `nfeProc`: sem o XML da nota guardado não sai
 * nenhum deles — daí o "Anexar o XML" para quem informou só a chave.
 */
test('nota de fora: anexar o XML libera DANFE e XML, e a tela avisa quando ele falta', () => {
  for (const id of ['notaExternaXmlAnexo', 'anexarXmlExterno', 'danfeNotaExterna', 'xmlNotaExterna', 'dadosExternosNotaSemXml']) {
    assert.ok(HTML.includes(`id="${id}"`), `sem #${id}`);
  }
  assert.ok(/id="anexarXmlExterno"[^>]*data-perm="financeiro\.nfe\.emit"/.test(HTML), 'anexar pede a permissão de emitir');
  assert.ok(/id="danfeNotaExterna"[^>]*data-perm="financeiro\.nfe\.view"[^>]*class="hidden/.test(HTML), 'o DANFE nasce escondido');
  assert.ok(/id="xmlNotaExterna"[^>]*data-perm="financeiro\.nfe\.view"[^>]*class="hidden/.test(HTML));

  assert.ok(FONTE.includes("fetchApi(`/api/fiscal/pedidos/${id}/nfe-externa/xml`, comoJson({ xml }))"), 'anexa pelo POST');
  assert.ok(FONTE.includes('window.NfeDocumentos?.gerarDanfeExterna?.(ctx.pedidoId)'));
  assert.ok(FONTE.includes('window.NfeDocumentos?.salvarXmlExterna?.(ctx.pedidoId)'));
  assert.ok(FONTE.includes("el('danfeNotaExterna').classList.toggle('hidden', !temXml || !podeVer)"), 'só com o XML guardado');
  assert.ok(FONTE.includes("el('anexarXmlExterno').textContent = temXml ? 'Trocar o XML' : 'Anexar o XML'"));
  assert.ok(FONTE.includes("aviso.classList.toggle('hidden', Boolean(temXml) || !nota)"), 'sem XML, a tela explica o que falta');
  assert.ok(FONTE.includes('nfe_externa_xml_cce.sql'), 'sem o SQL da fase, a tela diz o que rodar');

  // O utilitário compartilhado fala com as rotas da nota de fora.
  const UTIL = ler('js', 'utils', 'nfe-documentos.js');
  assert.ok(UTIL.includes('/api/fiscal/pedidos/${encodeURIComponent(pedidoId)}/nfe-externa'));
  assert.ok(UTIL.includes('gerarDanfeExterna, salvarXmlExterna, gerarCartaExternaPdf, salvarXmlCartaExterna'));

  // No Visualizar, sem nota daqui quem manda nos botões é a de fora.
  assert.ok(VISUALIZAR.includes('if (!notaDocs) ligarDocumentosDaNotaDeFora(notaExterna);'));
  assert.ok(VISUALIZAR.includes("if (!notaExterna?.tem_xml) return;"), 'sem XML anexado, nenhum botão aparece');
  assert.ok(VISUALIZAR.includes('window.NfeDocumentos?.gerarDanfeExterna?.(id)') && VISUALIZAR.includes('window.NfeDocumentos?.salvarXmlExterna?.(id)'));
});

/**
 * A etiqueta da nota de fora é um BOTÃO quando dá para gerar o documento
 * (pedido do dono, 24/09/2026): "como nas outras". Sem o XML anexado ela
 * continua só marcando que a nota existe — e o título diz o que falta.
 */
test('lista de pedidos: a tag "NF fora" gera o DANFE e a "CC-e" gera a carta, quando há XML', () => {
  const PEDIDOS = ler('js', 'pedidos.js');
  const tagNotaDeFora = recortar(PEDIDOS, 'tagNotaDeFora', textoDaFuncao(PEDIDOS, 'tagCartaCorrecaoDeFora'));

  const semXml = tagNotaDeFora({ pedido_id: 58, serie: 2, numero: 700, tem_xml: false });
  assert.match(semXml, />NF fora<\/span>/);
  assert.ok(!semXml.includes('tag-danfe-fora'), 'sem XML não clica');
  assert.match(semXml, /anexe o XML da nota para gerar o DANFE/);

  const comXml = tagNotaDeFora({ pedido_id: 58, serie: 2, numero: 700, tem_xml: true });
  assert.match(comXml, /badge-info tag-danfe-fora/);
  assert.match(comXml, /data-pedido-id="58"/);
  assert.match(comXml, /role="button"/);
  assert.match(comXml, /clique para gerar o DANFE/);

  const comCarta = tagNotaDeFora({ pedido_id: 58, serie: 2, numero: 700, tem_xml: true, cartas_correcao: 2, ultima_carta_seq: 2 });
  assert.match(comCarta, /badge-warning tag-cce-fora/);
  assert.match(comCarta, /data-carta-seq="2"/);
  assert.ok(comCarta.indexOf('CC-e') < comCarta.indexOf('NF fora'), 'a CC-e vem antes, como nas notas daqui');
  const cartaSemXml = tagNotaDeFora({ pedido_id: 58, serie: 2, numero: 700, tem_xml: false, cartas_correcao: 1 });
  assert.match(cartaSemXml, />CC-e<\/span>/);
  assert.ok(!cartaSemXml.includes('tag-cce-fora'), 'sem o XML da nota, a carta aparece mas não gera PDF');

  assert.ok(PEDIDOS.includes('window.NfeDocumentos?.gerarDanfeExterna(Number(e.currentTarget.dataset.pedidoId))'));
  assert.ok(PEDIDOS.includes('window.NfeDocumentos?.gerarCartaExternaPdf(Number(e.currentTarget.dataset.pedidoId), Number(e.currentTarget.dataset.cartaSeq))'));
});

test('visualizar pedido: as etiquetas de nota e de CC-e geram os documentos ao clicar', () => {
  const tags = recortar(VISUALIZAR, 'tagsDoEmbarque');
  const achar = (lista, pedaco) => lista.find(t => String(t.texto).includes(pedaco));

  const daqui = plano(tags({ situacao: 'Enviado' }, [{ id: 1, serie: 2, numero: 9, status_fiscal: 'autorizada', valor_total: 1500 }], 2, null, [], null, 2));
  assert.strictEqual(achar(daqui, 'NF-e 2/9').acao, 'danfe');
  assert.strictEqual(achar(daqui, 'CC-e').acao, 'cce');
  assert.strictEqual(achar(daqui, 'CC-e').seq, 2, 'o PDF é o da última carta');
  const processando = plano(tags({}, [{ id: 1, serie: 2, numero: 9, status_fiscal: 'processando' }]));
  assert.strictEqual(achar(processando, 'NF-e 2/9').acao, null, 'nota sem DANFE não vira botão');

  const deFora = { serie: 2, numero: 700, valor_total: 1500, tem_xml: true };
  const fora = plano(tags({ situacao: 'Enviado' }, [], 1, null, [], deFora, 1));
  assert.strictEqual(achar(fora, 'de fora').acao, 'danfe-fora');
  assert.strictEqual(achar(fora, 'CC-e').acao, 'cce-fora');

  const foraSemXml = plano(tags({ situacao: 'Enviado' }, [], 1, null, [], { ...deFora, tem_xml: false }, 1));
  assert.strictEqual(achar(foraSemXml, 'de fora').acao, null);
  assert.strictEqual(achar(foraSemXml, 'CC-e').acao, null, 'sem o XML, a CC-e não gera PDF');
  assert.match(achar(foraSemXml, 'de fora').titulo, /Anexe o XML/);

  // `pintarTags` transforma a marca em clique, sem deixar de ser etiqueta.
  assert.ok(VISUALIZAR.includes("'danfe-fora': () => window.NfeDocumentos?.gerarDanfeExterna?.(id)"));
  assert.ok(VISUALIZAR.includes("'cce-fora': t => window.NfeDocumentos?.gerarCartaExternaPdf?.(id, t.seq)"));
  assert.ok(VISUALIZAR.includes("s.setAttribute('role', 'button')") && VISUALIZAR.includes("s.classList.add('cursor-pointer')"));
  assert.ok(VISUALIZAR.includes("if (e.key !== 'Enter' && e.key !== ' ') return;"), 'teclado também');
});

test('cartas de correção de fora: pelo XML do evento ou à mão, sempre, com PDF e remoção', () => {
  for (const id of ['dadosExternosCartas', 'dadosExternosCartasLista', 'dadosExternosCartasTag', 'cartaExternaXml',
    'escolherXmlCartaExterna', 'cartaExternaSequencia', 'cartaExternaProtocolo', 'cartaExternaData', 'cartaExternaTexto', 'gravarCartaExterna']) {
    assert.ok(HTML.includes(`id="${id}"`), `sem #${id}`);
  }
  assert.ok(/id="gravarCartaExterna"[^>]*data-perm="financeiro\.nfe\.emit"/.test(HTML));
  assert.ok(/id="escolherXmlCartaExterna"[^>]*data-perm="financeiro\.nfe\.emit"/.test(HTML));
  assert.ok(HTML.includes('maxlength="1000"'), 'o limite da SEFAZ está no campo');

  assert.ok(FONTE.includes("fetchApi(`/api/fiscal/pedidos/${id}/nfe-externa/cartas`, comoJson(entrada))"), 'registra pelo POST');
  assert.ok(FONTE.includes('gravarCarta({ xml }'), 'a porta do XML do evento');
  assert.ok(FONTE.includes("sequencia: el('cartaExternaSequencia').value || 1"), 'e a porta da mão');
  assert.ok(FONTE.includes("/nfe-externa/cartas/${encodeURIComponent(carta.sequencia)}`, { method: 'DELETE' }"));
  assert.ok(FONTE.includes('window.NfeDocumentos?.gerarCartaExternaPdf?.(ctx.pedidoId, carta.sequencia)'));
  assert.ok(FONTE.includes('window.NfeDocumentos?.salvarXmlCartaExterna?.(ctx.pedidoId, carta.sequencia)'));
  // O PDF da carta depende do XML da NOTA; registrar, não.
  assert.ok(FONTE.includes("estadoNota?.nota_externa?.tem_xml && pode('financeiro.nfe.view')"), 'o PDF só com o XML da nota');
  assert.ok(FONTE.includes('As cartas estão registradas, mas o PDF só sai depois de anexar o XML da nota.'));
  assert.ok(!/innerHTML|insertAdjacentHTML/.test(FONTE), 'a lista é montada por createElement');

  // A tag CC-e no Visualizar vale para a nota daqui e para a de fora.
  assert.ok(VISUALIZAR.includes('if ((nota || notaExterna) && totalCartas > 0)'));
  assert.ok(VISUALIZAR.includes('/nfe-externa/cartas`'), 'o Visualizar conta as cartas de fora');
});
