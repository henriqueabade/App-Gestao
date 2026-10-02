/**
 * As categorias dos avisos do sino (decisão do dono, 02/10/2026): cada aviso
 * cai numa das categorias de Configurações › Notificações, e desmarcar uma
 * delas esconde só os avisos dela — no sino e na janela do canto da tela.
 * Antes, o sino inteiro obedecia só a "Vendas e pedidos".
 *
 *   tasks    Tarefas e lembretes: lembrete, atraso, convite, tarefa passada,
 *            alterada, concluída, cancelada ou excluída, comentário em tarefa
 *   finance  Financeiro: Financeiro, Cobrança e Contabilidade
 *   sales    Vendas e pedidos: prospecções, clientes, contatos, orçamentos,
 *            pedidos, comentários e menções do histórico
 *   conta    o seu próprio cadastro (acesso, senha, perfil): SEMPRE aparece
 *
 * "Atualizações do sistema" não tem aviso no sino. O interruptor geral
 * (Ativar notificações) desligado esconde tudo.
 *
 * Desmarcar só esconde: o aviso continua gravado e volta ao remarcar.
 * Serve ao navegador (window.CategoriasAviso) e ao Node
 * (require('../src/js/utils/categorias-aviso')).
 */
(function (raiz, fabrica) {
  const modulo = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = modulo;
  else raiz.CategoriasAviso = modulo;
})(typeof self !== 'undefined' ? self : this, function () {
  const DO_SINO = ['tasks', 'sales', 'finance'];
  const TIPOS_DE_TAREFA = new Set(['convite_tarefa', 'convite_respondido', 'acao_concluida', 'participante_removido']);
  const ORIGENS_FINANCEIRAS = new Set(['financeiro', 'contabil', 'contabilidade', 'cobranca']);

  /** A categoria de um aviso ({ tipo, origem }). Pura. */
  function categoriaDoAviso(aviso = {}) {
    const tipo = String(aviso?.tipo || '');
    const origem = String(aviso?.origem || '');
    if (tipo === 'conta_alterada' || origem === 'usuario') return 'conta';
    if (origem === 'tarefa' || tipo.startsWith('tarefa_') || TIPOS_DE_TAREFA.has(tipo)) return 'tasks';
    if (ORIGENS_FINANCEIRAS.has(origem)) return 'finance';
    return 'sales';
  }

  /** As preferências como o sino guarda ({ enabled, categories }), sempre completas. Pura. */
  function normalizar(prefs = {}) {
    const categorias = {};
    for (const chave of DO_SINO) categorias[chave] = prefs?.categories?.[chave] !== false;
    return { enabled: prefs?.enabled !== false, categories: categorias };
  }

  /** As categorias escondidas (o interruptor geral desligado esconde todas). Pura. */
  function ocultas(prefs = {}) {
    const p = normalizar(prefs);
    if (!p.enabled) return [...DO_SINO, 'conta'];
    return DO_SINO.filter(chave => !p.categories[chave]);
  }

  /** O aviso aparece com estas preferências? Pura. */
  function aparece(aviso, prefs = {}) {
    return !ocultas(prefs).includes(categoriaDoAviso(aviso));
  }

  return { DO_SINO, categoriaDoAviso, normalizar, ocultas, aparece };
});
