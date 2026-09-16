/**
 * E-mail da NF-e: DANFE (PDF) e XML para o cliente.
 *
 * O servidor SMTP vem da configuração fiscal (vale para todos); a senha vem
 * do cofre local (segredoLocal, `smtp`) — nunca do banco. O PDF chega do
 * renderer já pronto (o Electron é quem imprime), em base64; o XML sai da
 * nota. `criarTransporte` é injetável: os testes não abrem conexão nenhuma.
 */
let nodemailer = null;
try {
  nodemailer = require('nodemailer');
} catch (_) {
  nodemailer = null;
}

function erro(mensagem, status = 400) {
  const e = new Error(mensagem);
  e.status = status;
  return e;
}

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** "a@b.com; c@d.com, e@f.com" -> ['a@b.com', ...]; inválido dá erro claro. */
function listarDestinatarios(entrada) {
  const brutos = Array.isArray(entrada) ? entrada : String(entrada ?? '').split(/[;,\s]+/);
  const lista = [...new Set(brutos.map(e => String(e || '').trim().toLowerCase()).filter(Boolean))];
  const invalidos = lista.filter(e => !EMAIL_RE.test(e));
  if (invalidos.length) throw erro(`E-mail inválido: ${invalidos.join(', ')}`);
  return lista;
}

/** O que falta na configuração para enviar. */
function pendenciasDeEmail(cfg, senha) {
  const faltas = [];
  if (!cfg?.smtp_host) faltas.push('servidor SMTP');
  if (!cfg?.smtp_porta) faltas.push('porta');
  if (!cfg?.smtp_usuario) faltas.push('usuário');
  if (!cfg?.smtp_remetente) faltas.push('remetente');
  if (!senha) faltas.push('senha (guardada neste computador)');
  return faltas;
}

function opcoesDoTransporte(cfg, senha) {
  const porta = Number(cfg.smtp_porta) || 587;
  const seguro = cfg.smtp_seguro === true || cfg.smtp_seguro === 'true' || porta === 465;
  return { host: String(cfg.smtp_host).trim(), port: porta, secure: seguro, auth: { user: String(cfg.smtp_usuario).trim(), pass: String(senha) } };
}

function remetente(cfg) {
  const nome = String(cfg.smtp_nome_remetente || cfg.nome_fantasia || cfg.razao_social || '').trim();
  const endereco = String(cfg.smtp_remetente).trim();
  return nome ? `"${nome.replace(/"/g, '')}" <${endereco}>` : endereco;
}

function criarTransportePadrao(opcoes) {
  if (!nodemailer) throw erro('O envio de e-mail não está disponível (nodemailer ausente).', 500);
  return nodemailer.createTransport(opcoes);
}

/** Assunto e corpo do e-mail da nota. A mensagem padrão vem da configuração. */
function montarMensagem({ cfg, nota, mensagem }) {
  const numero = `${nota.serie}/${String(nota.numero).padStart(9, '0')}`;
  const empresa = cfg.nome_fantasia || cfg.razao_social || 'Emitente';
  const texto = String(mensagem || cfg.email_mensagem_padrao || '').trim()
    || `Olá,\n\nSegue em anexo a NF-e nº ${nota.numero} (série ${nota.serie}) com o DANFE em PDF e o XML.\n\nAtenciosamente,\n${empresa}`;
  return {
    assunto: `NF-e ${numero} — ${empresa}${nota.ambiente === 'homologacao' ? ' (homologação, sem valor fiscal)' : ''}`,
    texto: `${texto}\n\nChave de acesso: ${nota.chave_acesso || ''}`
  };
}

/**
 * Envia a nota. `nota` é a linha completa (com XML); `pdfBase64` é o DANFE.
 * Devolve { para, cc, anexos, messageId }.
 */
async function enviarNota({ cfg, senha, nota, para, mensagem, pdfBase64, incluirXml = true, criarTransporte = criarTransportePadrao }) {
  const faltas = pendenciasDeEmail(cfg, senha);
  if (faltas.length) throw erro(`Configure o e-mail da NF-e antes de enviar: falta ${faltas.join(', ')}.`, 409);
  const destinatarios = listarDestinatarios(para);
  if (!destinatarios.length) throw erro('Informe ao menos um destinatário.');
  if (!nota?.xml_autorizado) throw erro('Só uma nota autorizada pode ser enviada por e-mail.', 409);

  const anexos = [];
  if (pdfBase64) anexos.push({ filename: `DANFE-NFe-${nota.serie}-${String(nota.numero).padStart(9, '0')}.pdf`, content: Buffer.from(String(pdfBase64), 'base64'), contentType: 'application/pdf' });
  if (incluirXml) {
    anexos.push({ filename: `${nota.chave_acesso}-procNFe.xml`, content: nota.xml_autorizado, contentType: 'application/xml' });
    if (nota.xml_cancelamento) anexos.push({ filename: `${nota.chave_acesso}-procEventoNFe-cancelamento.xml`, content: nota.xml_cancelamento, contentType: 'application/xml' });
  }
  if (!anexos.length) throw erro('Nada para anexar: escolha o DANFE e/ou o XML.');

  const { assunto, texto } = montarMensagem({ cfg, nota, mensagem });
  const cc = cfg.email_copia ? listarDestinatarios(cfg.email_copia) : [];
  const transporte = criarTransporte(opcoesDoTransporte(cfg, senha));
  let info;
  try {
    info = await transporte.sendMail({ from: remetente(cfg), to: destinatarios.join(', '), cc: cc.join(', ') || undefined, subject: assunto, text: texto, attachments: anexos });
  } catch (e) {
    throw erro(`O servidor de e-mail recusou o envio: ${e?.message || e}`, 502);
  }
  return { para: destinatarios, cc, anexos: anexos.map(a => a.filename), assunto, messageId: info?.messageId || null };
}

/** Manda uma mensagem simples para conferir servidor, usuário e senha. */
async function testar({ cfg, senha, para, criarTransporte = criarTransportePadrao }) {
  const faltas = pendenciasDeEmail(cfg, senha);
  if (faltas.length) throw erro(`Falta ${faltas.join(', ')}.`, 409);
  const destinatarios = listarDestinatarios(para || cfg.smtp_remetente);
  const transporte = criarTransporte(opcoesDoTransporte(cfg, senha));
  try {
    const info = await transporte.sendMail({
      from: remetente(cfg), to: destinatarios.join(', '), subject: `Teste do e-mail da NF-e — ${cfg.nome_fantasia || cfg.razao_social || ''}`.trim(),
      text: 'Este é um teste do envio de NF-e pelo sistema. Se você recebeu, o servidor, o usuário e a senha estão certos.'
    });
    return { para: destinatarios, messageId: info?.messageId || null };
  } catch (e) {
    throw erro(`O servidor de e-mail recusou o envio: ${e?.message || e}`, 502);
  }
}

module.exports = { listarDestinatarios, pendenciasDeEmail, opcoesDoTransporte, remetente, montarMensagem, enviarNota, testar };
