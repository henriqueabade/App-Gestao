/**
 * Histórico do contato (contato_historico) — o que o módulo Contatos grava.
 *
 * O mesmo desenho de backend/clienteHistorico.js: cada cadastro, alteração
 * de campo e pessoa de contato vira um evento na linha do tempo, que recebe
 * curtidas, comentários e observações (backend/historicoSocial.js, origem
 * 'contato'). Falha ao gravar o histórico nunca desfaz o que o usuário
 * salvou: vai só para o log (e, sem o SQL, simplesmente não grava).
 */

const { registrarEventos } = require('./historicoSocial');

/** Os campos acompanhados, com o rótulo que a linha do tempo mostra. */
const CAMPOS_CONTATO = {
  nome: 'Nome',
  razao_social: 'Razão social',
  tipo: 'Tipo',
  tipo_pessoa: 'Tipo de pessoa',
  cnpj: 'CNPJ',
  cpf: 'CPF',
  inscricao_estadual: 'Inscrição estadual',
  inscricao_municipal: 'Inscrição municipal',
  email: 'E-mail',
  telefone_celular: 'Celular',
  telefone_fixo: 'Telefone',
  site: 'Site',
  status: 'Status',
  anotacoes: 'Anotações'
};
const PARTES_ENDERECO = {
  logradouro: 'rua', numero: 'número', complemento: 'complemento', bairro: 'bairro',
  cidade: 'cidade', uf: 'UF', pais: 'país', cep: 'CEP', codigo_municipio: 'código IBGE'
};
for (const [campo, rotulo] of Object.entries(PARTES_ENDERECO)) {
  CAMPOS_CONTATO[`end_${campo}`] = `Endereço · ${rotulo}`;
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
 * ausente não é "apagado"). `tipo` chega já como o NOME do tipo. Pura.
 */
function diferencasDoContato(antes = {}, depois = {}) {
  const eventos = [];
  for (const [campo, rotulo] of Object.entries(CAMPOS_CONTATO)) {
    if (!(campo in depois) || depois[campo] === undefined) continue;
    const a = legivel(antes[campo]);
    const d = legivel(depois[campo]);
    if (a === d) continue;
    eventos.push({ tipo: 'campo', acao: 'alterou', entidade: rotulo, campo, valor_anterior: a, valor_novo: d });
  }
  return eventos;
}

/** Os campos preenchidos do cadastro, rotulados (o "retrato" da criação). Pura. */
function retratoDoContato(payload = {}) {
  return Object.entries(CAMPOS_CONTATO)
    .map(([campo, rotulo]) => ({ rotulo, valor: legivel(payload[campo]) }))
    .filter(c => c.valor !== null);
}

const rotuloDaPessoa = p => [p?.nome, p?.cargo].map(v => String(v ?? '').trim()).filter(Boolean).join(' — ') || 'Pessoa de contato';
const retratoDaPessoa = p => [
  ['Nome', p?.nome], ['Cargo', p?.cargo], ['E-mail', p?.email], ['Telefone', p?.telefone_fixo], ['Celular', p?.telefone_celular]
].map(([rotulo, valor]) => ({ rotulo, valor: legivel(valor) })).filter(c => c.valor !== null);

/** Eventos do cadastro: o contato e cada pessoa. `observacao` diz de onde veio (formulário, CSV). */
function eventosDaCriacao(payload = {}, pessoas = [], { observacao = 'Cadastro inicial', pendencias = [] } = {}) {
  return [
    {
      tipo: 'criacao', acao: 'criou', entidade: 'Contato',
      valor_novo: legivel(payload.nome), observacao,
      detalhe: { campos: retratoDoContato(payload), ...(pendencias.length ? { pendencias } : {}) }
    },
    ...(Array.isArray(pessoas) ? pessoas : []).map(p => ({
      tipo: 'pessoa', acao: 'criou', entidade: rotuloDaPessoa(p), detalhe: { campos: retratoDaPessoa(p) }
    }))
  ];
}

/** Eventos das pessoas mexidas num PUT. Pura. */
function eventosDasPessoas({ pessoasNovas = [], pessoasAtualizadas = [], pessoasExcluidas = [] } = {}, { pessoasAntes = [] } = {}) {
  const porId = id => (Array.isArray(pessoasAntes) ? pessoasAntes : []).find(x => String(x?.id) === String(id));
  const eventos = [];
  for (const p of pessoasNovas) eventos.push({ tipo: 'pessoa', acao: 'criou', entidade: rotuloDaPessoa(p), detalhe: { campos: retratoDaPessoa(p) } });
  for (const p of pessoasAtualizadas) {
    const antes = porId(p?.id) || {};
    for (const [campo, rotulo] of [['nome', 'Nome'], ['cargo', 'Cargo'], ['email', 'E-mail'], ['telefone_fixo', 'Telefone'], ['telefone_celular', 'Celular']]) {
      const a = legivel(antes[campo]);
      const d = legivel(p?.[campo]);
      if (a === d || !(campo in (p || {}))) continue;
      eventos.push({ tipo: 'pessoa', acao: 'alterou', entidade: rotuloDaPessoa(p), campo, valor_anterior: a, valor_novo: d, detalhe: { rotulo } });
    }
  }
  for (const id of pessoasExcluidas) {
    const antes = porId(id);
    eventos.push({ tipo: 'pessoa', acao: 'excluiu', entidade: rotuloDaPessoa(antes), valor_anterior: legivel(antes?.nome), detalhe: { campos: retratoDaPessoa(antes) } });
  }
  return eventos;
}

/** Grava no histórico do contato (sem derrubar quem chamou). */
function registrarNoContato(api, contatoId, eventos, usuarioId) {
  if (!eventos?.length || !contatoId) return Promise.resolve([]);
  return registrarEventos(api, 'contato', contatoId, eventos, usuarioId).catch(err => {
    console.error('[contatos] histórico não gravado:', err?.message || err);
    return [];
  });
}

module.exports = {
  CAMPOS_CONTATO, legivel, diferencasDoContato, retratoDoContato, eventosDaCriacao, eventosDasPessoas, registrarNoContato
};
