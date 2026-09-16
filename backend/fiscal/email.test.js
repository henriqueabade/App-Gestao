/**
 * E-mail da NF-e (backend/fiscal/email.js) sem rede: o transporte é um dublê
 * que guarda o que seria enviado. Prende destinatários, a configuração que
 * falta, TLS pela porta, remetente com nome, assunto/corpo, os anexos (DANFE
 * do app + XML da nota + XML do cancelamento) e os erros.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const email = require('./email');

const CFG = {
  razao_social: 'SANTÍSSIMO DECOR LTDA', nome_fantasia: 'Santíssimo Decor', smtp_host: 'smtp.exemplo.com', smtp_porta: 587, smtp_seguro: false,
  smtp_usuario: 'nfe@exemplo.com', smtp_remetente: 'nfe@exemplo.com', smtp_nome_remetente: 'Santíssimo Decor - NF-e', email_copia: 'financeiro@exemplo.com'
};
const NOTA = { id: 10, serie: 1, numero: 4, ambiente: 'homologacao', chave_acesso: '3'.repeat(44), status_fiscal: 'autorizada', xml_autorizado: '<nfeProc>x</nfeProc>', xml_cancelamento: null };

function transporteFalso(resposta = { messageId: '<id@exemplo>' }) {
  const enviados = [];
  const opcoes = [];
  return {
    enviados, opcoes,
    criar: o => { opcoes.push(o); return { sendMail: async m => { enviados.push(m); if (resposta instanceof Error) throw resposta; return resposta; } }; }
  };
}

test('destinatários: separa por ; , ou espaço, tira repetidos, minúsculas e aponta o inválido', () => {
  assert.deepEqual(email.listarDestinatarios('A@b.com; c@d.com, a@b.com e@f.com'), ['a@b.com', 'c@d.com', 'e@f.com']);
  assert.deepEqual(email.listarDestinatarios(['x@y.com']), ['x@y.com']);
  assert.deepEqual(email.listarDestinatarios(''), []);
  assert.throws(() => email.listarDestinatarios('a@b.com; errado'), /E-mail inválido: errado/);
});

test('pendências, transporte (TLS pela porta 465) e remetente com nome', () => {
  assert.deepEqual(email.pendenciasDeEmail(CFG, 'senha'), []);
  assert.deepEqual(email.pendenciasDeEmail({ smtp_host: 'x' }, null), ['porta', 'usuário', 'remetente', 'senha (guardada neste computador)']);
  assert.deepEqual(email.opcoesDoTransporte(CFG, 's3nha'), { host: 'smtp.exemplo.com', port: 587, secure: false, auth: { user: 'nfe@exemplo.com', pass: 's3nha' } });
  assert.equal(email.opcoesDoTransporte({ ...CFG, smtp_porta: 465 }, 'x').secure, true);
  assert.equal(email.opcoesDoTransporte({ ...CFG, smtp_seguro: 'true' }, 'x').secure, true);
  assert.equal(email.remetente(CFG), '"Santíssimo Decor - NF-e" <nfe@exemplo.com>');
  assert.equal(email.remetente({ ...CFG, smtp_nome_remetente: '' }), '"Santíssimo Decor" <nfe@exemplo.com>');
});

test('assunto e corpo: número da nota, empresa, homologação avisada, mensagem padrão ou a digitada, chave no fim', () => {
  const padrao = email.montarMensagem({ cfg: CFG, nota: NOTA });
  assert.equal(padrao.assunto, 'NF-e 1/000000004 — Santíssimo Decor (homologação, sem valor fiscal)');
  assert.match(padrao.texto, /Segue em anexo a NF-e nº 4 \(série 1\)/);
  assert.match(padrao.texto, /Chave de acesso: 3{44}$/);
  const digitada = email.montarMensagem({ cfg: { ...CFG, email_mensagem_padrao: 'Texto da configuração' }, nota: { ...NOTA, ambiente: 'producao' }, mensagem: '  Olá, segue a nota.  ' });
  assert.equal(digitada.assunto, 'NF-e 1/000000004 — Santíssimo Decor');
  assert.ok(digitada.texto.startsWith('Olá, segue a nota.'));
  assert.ok(email.montarMensagem({ cfg: { ...CFG, email_mensagem_padrao: 'Texto da configuração' }, nota: NOTA }).texto.startsWith('Texto da configuração'));
});

test('enviarNota: DANFE + XML (+ cancelamento) anexados, cópia da empresa, sem senha ou sem nota autorizada é barrado', async () => {
  const t = transporteFalso();
  const r = await email.enviarNota({ cfg: CFG, senha: 's', nota: NOTA, para: 'cliente@x.com; fiscal@x.com', pdfBase64: Buffer.from('%PDF').toString('base64'), criarTransporte: t.criar });
  assert.deepEqual(r.para, ['cliente@x.com', 'fiscal@x.com']);
  assert.deepEqual(r.cc, ['financeiro@exemplo.com']);
  assert.deepEqual(r.anexos, ['DANFE-NFe-1-000000004.pdf', `${'3'.repeat(44)}-procNFe.xml`]);
  assert.equal(r.messageId, '<id@exemplo>');
  const m = t.enviados[0];
  assert.equal(m.from, '"Santíssimo Decor - NF-e" <nfe@exemplo.com>');
  assert.equal(m.to, 'cliente@x.com, fiscal@x.com');
  assert.equal(m.cc, 'financeiro@exemplo.com');
  assert.equal(m.attachments[0].contentType, 'application/pdf');
  assert.equal(m.attachments[0].content.toString(), '%PDF');
  assert.equal(m.attachments[1].content, '<nfeProc>x</nfeProc>');
  assert.equal(t.opcoes[0].auth.pass, 's');

  const cancelada = await email.enviarNota({ cfg: { ...CFG, email_copia: '' }, senha: 's', nota: { ...NOTA, xml_cancelamento: '<procEventoNFe/>' }, para: ['c@x.com'], pdfBase64: null, criarTransporte: t.criar });
  assert.deepEqual(cancelada.anexos, [`${'3'.repeat(44)}-procNFe.xml`, `${'3'.repeat(44)}-procEventoNFe-cancelamento.xml`]);
  assert.deepEqual(cancelada.cc, []);
  assert.equal(t.enviados[1].cc, undefined);

  await assert.rejects(email.enviarNota({ cfg: CFG, senha: null, nota: NOTA, para: 'c@x.com', pdfBase64: 'x', criarTransporte: t.criar }), e => e.status === 409 && /falta senha/.test(e.message));
  await assert.rejects(email.enviarNota({ cfg: CFG, senha: 's', nota: NOTA, para: 'errado', pdfBase64: 'x', criarTransporte: t.criar }), /E-mail inválido/);
  await assert.rejects(email.enviarNota({ cfg: CFG, senha: 's', nota: NOTA, para: '', pdfBase64: 'x', criarTransporte: t.criar }), /ao menos um destinatário/);
  await assert.rejects(email.enviarNota({ cfg: CFG, senha: 's', nota: { ...NOTA, xml_autorizado: null }, para: 'c@x.com', pdfBase64: 'x', criarTransporte: t.criar }), e => e.status === 409);
  await assert.rejects(email.enviarNota({ cfg: CFG, senha: 's', nota: NOTA, para: 'c@x.com', pdfBase64: null, incluirXml: false, criarTransporte: t.criar }), /Nada para anexar/);
  const falho = transporteFalso(new Error('535 Authentication failed'));
  await assert.rejects(email.enviarNota({ cfg: CFG, senha: 's', nota: NOTA, para: 'c@x.com', pdfBase64: 'x', criarTransporte: falho.criar }), e => e.status === 502 && /recusou o envio: 535/.test(e.message));
});

test('testar: manda para o remetente (ou para quem for pedido) com a configuração atual', async () => {
  const t = transporteFalso();
  const r = await email.testar({ cfg: CFG, senha: 's', criarTransporte: t.criar });
  assert.deepEqual(r.para, ['nfe@exemplo.com']);
  assert.match(t.enviados[0].subject, /Teste do e-mail da NF-e — Santíssimo Decor/);
  const outro = await email.testar({ cfg: CFG, senha: 's', para: 'eu@x.com', criarTransporte: t.criar });
  assert.deepEqual(outro.para, ['eu@x.com']);
  await assert.rejects(email.testar({ cfg: { ...CFG, smtp_host: '' }, senha: 's', criarTransporte: t.criar }), e => e.status === 409 && /servidor SMTP/.test(e.message));
});
