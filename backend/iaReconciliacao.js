// Cada item extraído vira uma decisão: CADASTRAR, ATUALIZAR o que já existe,
// ou IGNORAR.
//
// É o passo entre "a IA leu" e "o sistema gravou", e o que evita o estrago
// mais caro do módulo: cadastrar de novo um insumo que já existe. O estoque
// passa a ter duas linhas do mesmo MDF, os produtos apontam para uma delas, e
// o saldo real fica repartido entre as duas sem ninguém perceber.
//
// ---------------------------------------------------------------------------
// A DECISÃO É SUGESTÃO, NÃO SENTENÇA
//
// Nada aqui grava coisa alguma. Cada item sai com uma ação proposta e, quando
// há dúvida, com o motivo escrito ao lado. Quem decide é quem revisa — e é por
// isso que o casamento POR APROXIMAÇÃO nunca escolhe sozinho: ele só levanta a
// mão. Juntar "MDF 15mm Branco" com "MDF 15mm Branco TX" automaticamente
// misturaria dois insumos diferentes, e o erro só apareceria no inventário.

const { obterEsquema } = require('./iaEsquemas');

// ---------------------------------------------------------------------------
// Comparação de nomes
// ---------------------------------------------------------------------------

/** Caixa, acento e espaço repetido não distinguem insumo. */
function normalizar(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Só letras e dígitos. Serve para reconhecer que "MDF 15 mm" e "MDF-15mm" são
 * a mesma coisa escrita por dois fornecedores diferentes.
 */
const compactar = valor => normalizar(valor).replace(/[^a-z0-9]/g, '');

/** Palavras com 2+ caracteres, para medir o quanto dois nomes se parecem. */
function palavras(valor) {
  return new Set(normalizar(valor).split(' ').filter(p => p.length >= 2));
}

/**
 * Semelhança entre dois nomes, de 0 a 1 (Jaccard sobre as palavras).
 *
 * Escolhido por ser explicável: "5 das 7 palavras batem" é algo que dá para
 * conferir a olho na tela. Uma distância de edição daria um número melhor e
 * uma explicação pior — e aqui o número não decide nada sozinho, só chama
 * atenção de quem revisa.
 */
function semelhanca(a, b) {
  const pa = palavras(a);
  const pb = palavras(b);
  if (!pa.size || !pb.size) return 0;
  let comuns = 0;
  for (const p of pa) if (pb.has(p)) comuns += 1;
  return comuns / (pa.size + pb.size - comuns);
}

/** A partir daqui vale avisar; abaixo disso é ruído. */
const LIMIAR_PARECIDO = 0.6;

// ---------------------------------------------------------------------------
// Reconciliação
// ---------------------------------------------------------------------------

/**
 * Decide a ação de cada item contra o que já existe na tabela de destino.
 *
 * `existentes` é a tabela inteira, trazida de uma vez e casada em memória: a
 * API remota não filtra por lista de valores (ver DEV-ONBOARDING.md, §3), e uma
 * requisição por item seria uma tempestade de chamadas para uma lista de 200
 * linhas.
 *
 * Devolve os itens com `acao`, `alvo_id`, `confianca` e `mensagem`.
 */
function reconciliar({ destino, itens, existentes }) {
  const esquema = obterEsquema(destino);
  if (!esquema) return itens.map(i => ({ ...i, acao: 'criar', alvo_id: null, confianca: null }));

  const chave = esquema.chaveDeCasamento;
  const linhas = Array.isArray(existentes) ? existentes : [];

  // Dois índices: um exato e um "sem pontuação". O segundo pega a mesma peça
  // escrita de outro jeito sem abrir mão de ser um casamento determinístico.
  const porNome = new Map();
  const porCompacto = new Map();
  for (const linha of linhas) {
    const bruto = linha?.[chave];
    if (!bruto) continue;
    const n = normalizar(bruto);
    const c = compactar(bruto);
    if (n && !porNome.has(n)) porNome.set(n, linha);
    if (c && !porCompacto.has(c)) porCompacto.set(c, linha);
  }

  /** Nomes já vistos NESTA leitura, para pegar repetição dentro do lote. */
  const vistosNoLote = new Map();

  return itens.map(item => {
    const valor = item?.dados?.[chave];
    const ressalvas = item.mensagem ? [item.mensagem] : [];

    const decidir = extra => ({
      ...item,
      ...extra,
      mensagem: [...ressalvas, ...(extra.notas || [])].filter(Boolean).join(' · ') || null,
      notas: undefined
    });

    if (!valor) {
      return decidir({
        acao: 'ignorar', alvo_id: null, alvo_tabela: null, confianca: 0,
        notas: [`Sem ${esquema.campos.find(c => c.chave === chave)?.rotulo || chave} para comparar`]
      });
    }

    const n = normalizar(valor);
    const c = compactar(valor);

    // 1) Repetido dentro da própria leitura.
    const jaVisto = vistosNoLote.get(c);
    if (jaVisto) {
      return decidir({
        acao: 'ignorar', alvo_id: null, alvo_tabela: null, confianca: 0,
        notas: [`Repetido da linha ${jaVisto} — some as quantidades à mão se forem duas entradas`]
      });
    }
    vistosNoLote.set(c, item.linha);

    // 2) Nome igual: é o mesmo insumo, sem dúvida a levantar.
    const exato = porNome.get(n);
    if (exato) {
      return decidir({
        acao: 'atualizar', alvo_id: exato.id ?? null, alvo_tabela: esquema.tabelaAlvo, confianca: 1
      });
    }

    // 3) Mesma coisa escrita de outro jeito ("MDF 15 mm" e "MDF-15mm").
    const compacto = porCompacto.get(c);
    if (compacto) {
      return decidir({
        acao: 'atualizar', alvo_id: compacto.id ?? null, alvo_tabela: esquema.tabelaAlvo, confianca: 0.9,
        notas: [`Casou com "${compacto[chave]}" ignorando espaços e pontuação — confira`]
      });
    }

    // 4) Parecido, mas não igual. NÃO decide: cadastra como novo e avisa.
    //    Juntar por semelhança misturaria insumos diferentes, e o erro só
    //    apareceria no inventário.
    let melhor = null;
    let melhorNota = 0;
    for (const linha of linhas) {
      const nota = semelhanca(valor, linha?.[chave]);
      if (nota > melhorNota) { melhorNota = nota; melhor = linha; }
    }

    if (melhor && melhorNota >= LIMIAR_PARECIDO) {
      return decidir({
        acao: 'criar', alvo_id: null, alvo_tabela: null, confianca: Number(melhorNota.toFixed(2)),
        notas: [`Parecido com "${melhor[chave]}" (#${melhor.id}) — confira se não é o mesmo antes de cadastrar`]
      });
    }

    return decidir({ acao: 'criar', alvo_id: null, alvo_tabela: null, confianca: null });
  });
}

module.exports = { normalizar, compactar, palavras, semelhanca, LIMIAR_PARECIDO, reconciliar };
