/**
 * Tarefas automáticas — o que cada regra é, quem pode recebê-la e o aviso
 * (pedido do dono em 24/09/2026). Só regra, sem rede: quem lê o banco é o
 * tarefasServico (criação) e o tarefasController (telas).
 *
 *   - Cada regra está ligada a uma PERMISSÃO do módulo de onde ela vem. Só
 *     quem tem a permissão (e vê Tarefas) enxerga a regra — em Tarefas ›
 *     Automáticas e em Configurações › Tarefas automáticas — e RECEBE a
 *     tarefa: senão chegaria uma tarefa que a pessoa não consegue desligar em
 *     lugar nenhum.
 *   - Cada pessoa desliga a regra só para si (`tarefa_automacao_usuarios`).
 *     Sem linha, vale ligada: o padrão é todos receberem.
 *   - A regra em si (título, prazo, tipo, prioridade e o liga/desliga para
 *     todos) continua em `tarefa_automacoes`, ajustada por quem tem
 *     "Configurar tarefas automáticas".
 *   - Toda tarefa automática avisa quem a recebeu (sino e Windows): o que
 *     aconteceu, a tarefa e o prazo — e a DICA de onde desligar.
 *
 * Regra nova = uma linha em REGRAS e o INSERT dela no SQL.
 */

const R = require('./tarefasRegras');

/** A permissão que todo mundo precisa: sem ver Tarefas, não há o que receber. */
const PERMISSAO_TAREFAS = 'tarefas.view';

/** O texto pequeno do aviso (a tela do sino o mostra menor, abaixo da mensagem). */
const DICA_DO_AVISO = 'Pode ser desativada em Tarefas ou em Configurações.';

const texto = v => (v === undefined || v === null ? '' : String(v).trim());

/**
 * chave: a de `tarefa_automacoes`. permissao: a chave do catálogo de
 * permissões que libera a regra. prazo: 'depois' conta `dias` a partir de
 * hoje; 'antes_do_pagamento' é o dia marcado para pagar ("pagar até" do
 * fechamento), com `dias` de antecedência. gatilho: a frase do aviso.
 */
const REGRAS = [
  {
    chave: 'orcamento_enviado', modulo: 'Orçamentos', icone: 'fa-file-invoice-dollar',
    permissao: 'orc.send', permissaoRotulo: 'Enviar orçamento', prazo: 'depois',
    gatilho: v => `Orçamento ${texto(v.orcamento) || 'novo'} enviado`
  },
  {
    chave: 'prospeccao_convertida', modulo: 'Prospecções', icone: 'fa-user-plus',
    permissao: 'pros.view', permissaoRotulo: 'Ver prospecções', prazo: 'depois',
    gatilho: v => `Prospecção ${texto(v.prospeccao) || texto(v.cliente)} convertida em cliente`.replace(/\s{2,}/g, ' ')
  },
  {
    chave: 'pedido_entregue', modulo: 'Pedidos', icone: 'fa-cart-shopping',
    permissao: 'ped.view', permissaoRotulo: 'Ver pedidos', prazo: 'depois',
    gatilho: v => `Pedido ${texto(v.pedido)} entregue`.replace(/\s{2,}/g, ' ')
  },
  {
    chave: 'comissoes_fechadas', modulo: 'Financeiro', icone: 'fa-hand-holding-dollar',
    permissao: 'financeiro.pagamento.confirmar', permissaoRotulo: 'Confirmar pagamento', prazo: 'antes_do_pagamento',
    gatilho: v => `Comissões de ${texto(v.competencia)} fechadas`
  },
  {
    chave: 'producao_fechada', modulo: 'Financeiro', icone: 'fa-industry',
    permissao: 'financeiro.pagamento.confirmar', permissaoRotulo: 'Confirmar pagamento', prazo: 'antes_do_pagamento',
    gatilho: v => `Produção de ${texto(v.competencia)} fechada`
  }
];

const PORCHAVE = new Map(REGRAS.map(r => [r.chave, r]));

/**
 * A regra do catálogo. Regra que existe no banco e não aqui (criada à mão)
 * não tem permissão própria: vale só a de ver Tarefas.
 */
function regraDoCatalogo(chave) {
  return PORCHAVE.get(String(chave || '')) || {
    chave: String(chave || ''), modulo: 'Tarefas', icone: 'fa-robot', permissao: null, permissaoRotulo: null, prazo: 'depois',
    gatilho: () => ''
  };
}

/** Quem tem estas permissões pode ver e receber a regra. `pode(chave)` decide. */
function podeReceber(chave, pode) {
  if (typeof pode !== 'function' || !pode(PERMISSAO_TAREFAS)) return false;
  const { permissao } = regraDoCatalogo(chave);
  return !permissao || Boolean(pode(permissao));
}

/**
 * O dia da tarefa. 'depois': hoje + dias. 'antes_do_pagamento': o dia
 * marcado para pagar, `dias` antes — nunca antes de hoje; se o dia marcado já
 * passou (fechou atrasado), fica nele: a tarefa nasce atrasada, e é verdade.
 */
function dataDaTarefa({ prazo = 'depois', dias = 0, hoje, base = null }) {
  const n = Number.isInteger(Number(dias)) ? Math.max(0, Number(dias)) : 0;
  const marcado = R.diaISO(base);
  if (prazo !== 'antes_do_pagamento' || !marcado) return R.somarDias(hoje, n);
  if (marcado < hoje) return marcado;
  const antecipado = R.somarDias(marcado, -n);
  return antecipado < hoje ? hoje : antecipado;
}

/** "Orçamento ORC-30 enviado: “Follow-up…”, para 27/09/2026." */
function mensagemDoAviso({ gatilho, titulo, prazo }) {
  const inicio = texto(gatilho);
  return `${inicio ? `${inicio}: ` : ''}“${texto(titulo)}”, para ${texto(prazo) || 'sem data'}.`;
}

/**
 * As preferências gravadas (linhas de `tarefa_automacao_usuarios`) → Map
 * chave → ligada. Só as da pessoa; a mais nova vence se houver repetida.
 */
function mapaDePreferencias(linhas, usuarioId) {
  const mapa = new Map();
  const doUsuario = (Array.isArray(linhas) ? linhas : [])
    .filter(l => l && String(l.usuario_id) === String(usuarioId) && l.chave)
    .sort((a, b) => Number(a.id) - Number(b.id));
  for (const l of doUsuario) mapa.set(String(l.chave), !(l.ativa === false || l.ativa === 'false' || l.ativa === 'f'));
  return mapa;
}

/**
 * As regras como as telas mostram: só as que a pessoa pode receber, cada uma
 * com o módulo, a permissão, o tipo de prazo e se está ligada PARA ELA.
 */
function paraTela(linhas, { pode, preferencias = new Map(), podeConfigurar = false } = {}) {
  return (Array.isArray(linhas) ? linhas : [])
    .filter(r => r && r.chave && podeReceber(r.chave, pode))
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map(r => {
      const cat = regraDoCatalogo(r.chave);
      return {
        ...r,
        ativa: Boolean(r.ativa),
        modulo: cat.modulo,
        icone: cat.icone,
        permissao: cat.permissao,
        permissao_rotulo: cat.permissaoRotulo,
        prazo_tipo: cat.prazo,
        minha: preferencias.has(r.chave) ? preferencias.get(r.chave) : true,
        pode_configurar: Boolean(podeConfigurar)
      };
    });
}

module.exports = {
  REGRAS, PERMISSAO_TAREFAS, DICA_DO_AVISO,
  regraDoCatalogo, podeReceber, dataDaTarefa, mensagemDoAviso, mapaDePreferencias, paraTela
};
