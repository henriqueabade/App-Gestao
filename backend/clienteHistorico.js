/**
 * Histórico do cliente (cliente_historico) — o que o módulo Clientes grava.
 *
 * O cliente não tinha histórico nenhum. A partir de sql/historico_social.sql
 * cada cadastro, alteração de campo, contato e transportadora vira um evento,
 * no mesmo formato do histórico da prospecção: é essa a linha do tempo que
 * recebe curtidas, comentários e observações (backend/historicoSocial.js).
 *
 * Falha ao gravar o histórico nunca desfaz o que o usuário salvou: vai só
 * para o log (e, sem o SQL, simplesmente não grava).
 */

const { registrarEventos } = require('./historicoSocial');

/** Os campos acompanhados, com o rótulo que a linha do tempo mostra. */
const CAMPOS_CLIENTE = {
  nome_fantasia: 'Nome fantasia',
  razao_social: 'Razão social',
  tipo_pessoa: 'Tipo de pessoa',
  cnpj: 'CNPJ',
  cpf: 'CPF',
  inscricao_estadual: 'Inscrição estadual',
  indicador_ie: 'Indicador IE',
  email_nfe: 'E-mail para NF-e',
  consumidor_final: 'Consumidor final',
  site: 'Site',
  status_cliente: 'Status',
  dono_cliente: 'Dono',
  origem_captacao: 'Origem da captação',
  anotacoes: 'Anotações'
};
const PARTES_ENDERECO = {
  logradouro: 'rua', numero: 'número', complemento: 'complemento', bairro: 'bairro',
  cidade: 'cidade', uf: 'UF', pais: 'país', cep: 'CEP', codigo_municipio: 'código IBGE'
};
for (const [prefixo, nome] of [['reg', 'Registro'], ['cob', 'Cobrança'], ['ent', 'Entrega']]) {
  for (const [campo, rotulo] of Object.entries(PARTES_ENDERECO)) {
    if (campo === 'codigo_municipio' && prefixo === 'cob') continue;
    CAMPOS_CLIENTE[`${prefixo}_${campo}`] = `${nome} · ${rotulo}`;
  }
}

/** Valor para comparar e mostrar: vazio é vazio, booleano vira Sim/Não. */
function legivel(valor) {
  if (valor === undefined || valor === null) return null;
  if (typeof valor === 'boolean') return valor ? 'Sim' : 'Não';
  const s = String(valor).trim();
  return s === '' ? null : s;
}

/**
 * Um evento por campo que mudou. Só olha o que veio em `depois` (campo
 * ausente não é "apagado"). Pura.
 */
function diferencasDoCliente(antes = {}, depois = {}) {
  const eventos = [];
  for (const [campo, rotulo] of Object.entries(CAMPOS_CLIENTE)) {
    if (!(campo in depois) || depois[campo] === undefined) continue;
    const a = legivel(campo === 'consumidor_final' && antes[campo] !== undefined ? Boolean(antes[campo]) : antes[campo]);
    const d = legivel(depois[campo]);
    if (a === d) continue;
    eventos.push({
      tipo: 'campo', acao: 'alterou', entidade: rotulo, campo,
      valor_anterior: a, valor_novo: d
    });
  }
  return eventos;
}

/** Os campos preenchidos do cadastro, rotulados (o "retrato" da criação). Pura. */
function retratoDoCliente(payload = {}) {
  return Object.entries(CAMPOS_CLIENTE)
    .map(([campo, rotulo]) => ({ rotulo, valor: legivel(payload[campo]) }))
    .filter(c => c.valor !== null);
}

const rotuloDoContato = c => [c?.nome, c?.cargo].map(v => String(v ?? '').trim()).filter(Boolean).join(' — ') || 'Contato';
const retratoDoContato = c => [
  ['Nome', c?.nome], ['Cargo', c?.cargo], ['E-mail', c?.email], ['Telefone fixo', c?.telefone_fixo], ['Celular', c?.telefone_celular]
].map(([rotulo, valor]) => ({ rotulo, valor: legivel(valor) })).filter(c => c.valor !== null);

/** Eventos do cadastro: o cliente e cada contato. `origem` é de onde veio (formulário, CSV, prospecção). */
function eventosDaCriacao(payload = {}, contatos = [], { observacao = 'Cadastro inicial', pendencias = [] } = {}) {
  return [
    {
      tipo: 'criacao', acao: 'criou', entidade: 'Cliente',
      valor_novo: legivel(payload.nome_fantasia), observacao,
      detalhe: { campos: retratoDoCliente(payload), ...(pendencias.length ? { pendencias } : {}) }
    },
    ...(Array.isArray(contatos) ? contatos : []).map(c => ({
      tipo: 'contato', acao: 'criou', entidade: rotuloDoContato(c), detalhe: { campos: retratoDoContato(c) }
    }))
  ];
}

/** Eventos dos contatos e transportadoras mexidos num PUT. Pura. */
function eventosDosFilhos({ contatosNovos = [], contatosAtualizados = [], contatosExcluidos = [], transportadorasNovas = [], transportadorasExcluidas = [] } = {}, { contatosAntes = [], transportadorasAntes = [] } = {}) {
  const porId = (listaAntes, id) => (Array.isArray(listaAntes) ? listaAntes : []).find(x => String(x?.id) === String(id));
  const eventos = [];
  for (const c of contatosNovos) eventos.push({ tipo: 'contato', acao: 'criou', entidade: rotuloDoContato(c), detalhe: { campos: retratoDoContato(c) } });
  for (const c of contatosAtualizados) {
    const antes = porId(contatosAntes, c?.id) || {};
    for (const [campo, rotulo] of [['nome', 'Nome'], ['cargo', 'Cargo'], ['email', 'E-mail'], ['telefone_fixo', 'Telefone fixo'], ['telefone_celular', 'Celular']]) {
      const a = legivel(antes[campo]);
      const d = legivel(c?.[campo]);
      if (a === d || !(campo in (c || {}))) continue;
      eventos.push({ tipo: 'contato', acao: 'alterou', entidade: rotuloDoContato(c), campo, valor_anterior: a, valor_novo: d, detalhe: { rotulo } });
    }
  }
  for (const id of contatosExcluidos) {
    const antes = porId(contatosAntes, id);
    eventos.push({ tipo: 'contato', acao: 'excluiu', entidade: rotuloDoContato(antes), valor_anterior: legivel(antes?.nome), detalhe: { campos: retratoDoContato(antes) } });
  }
  for (const t of transportadorasNovas) {
    const nome = legivel(t?.transportadora ?? t?.nome);
    if (nome) eventos.push({ tipo: 'transportadora', acao: 'criou', entidade: 'Transportadora', valor_novo: nome });
  }
  for (const id of transportadorasExcluidas) {
    const antes = porId(transportadorasAntes, id);
    eventos.push({ tipo: 'transportadora', acao: 'excluiu', entidade: 'Transportadora', valor_anterior: legivel(antes?.transportadora) });
  }
  return eventos;
}

/** Grava no histórico do cliente (sem derrubar quem chamou). */
function registrarNoCliente(api, clienteId, eventos, usuarioId) {
  if (!eventos?.length || !clienteId) return Promise.resolve([]);
  return registrarEventos(api, 'cliente', clienteId, eventos, usuarioId).catch(err => {
    console.error('[clientes] histórico não gravado:', err?.message || err);
    return [];
  });
}

/** Quem cadastrou (coluna nova): num PUT à parte, para o cadastro não depender do SQL. */
function marcarCriador(api, clienteId, usuarioId) {
  if (!clienteId || !usuarioId) return Promise.resolve(null);
  return api.put(`/api/clientes/${clienteId}`, { criado_por: Number(usuarioId) }).catch(() => null);
}

module.exports = {
  CAMPOS_CLIENTE, legivel, diferencasDoCliente, retratoDoCliente, eventosDaCriacao, eventosDosFilhos,
  registrarNoCliente, marcarCriador
};
