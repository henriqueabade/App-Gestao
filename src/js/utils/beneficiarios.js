/**
 * Quem recebe comissão: CMS (o dono do cliente) e Royalty (o desenhista da
 * peça). Cada pessoa tem uma COR estável — a mesma em todas as telas — e o
 * tipo vira uma etiqueta. Usado pelo módulo Financeiro e pelos modais dele.
 *
 * A cor sai do nome (sempre a mesma para o mesmo nome, sem tabela de cores
 * para manter), com saturação e luz fixas: assim as cores se distinguem entre
 * si e continuam legíveis no tema escuro e no claro.
 */
(() => {
  if (window.Beneficiarios) return;

  const TIPOS = { cms: 'CMS', royalty: 'Royalty' };
  const chave = nome => String(nome ?? '').normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();

  function cor(nome) {
    const texto = chave(nome);
    if (!texto) return 'hsl(220, 10%, 60%)';
    let h = 0;
    for (let i = 0; i < texto.length; i += 1) h = (h * 31 + texto.charCodeAt(i)) % 360;
    return `hsl(${h}, 62%, 62%)`;
  }

  /** O pontinho colorido da pessoa (legenda e listas). */
  function ponto(nome) {
    const s = document.createElement('span');
    s.className = 'fin-ponto';
    s.style.background = cor(nome);
    s.title = String(nome ?? '');
    return s;
  }

  /** Etiqueta "• Nome · CMS" para tabelas e cartões. */
  function etiqueta(beneficiario, tipo, { titulo = '' } = {}) {
    const alvo = document.createElement('span');
    alvo.className = 'fin-etiqueta-benef';
    alvo.style.borderColor = cor(beneficiario);
    alvo.appendChild(ponto(beneficiario));
    alvo.appendChild(document.createTextNode(String(beneficiario ?? '—')));
    if (TIPOS[tipo]) {
      const t = document.createElement('span');
      t.className = `fin-etiqueta-benef__tipo fin-etiqueta-benef__tipo--${tipo}`;
      t.textContent = TIPOS[tipo];
      alvo.appendChild(t);
    }
    if (titulo) alvo.title = titulo;
    return alvo;
  }

  /** A legenda (CMS/Royalty) e, opcionalmente, as pessoas da lista. */
  function legenda(lista = []) {
    const caixa = document.createElement('div');
    caixa.className = 'fin-legenda';
    for (const [tipo, rotulo] of Object.entries(TIPOS)) {
      const item = document.createElement('span');
      item.className = 'fin-legenda__item';
      const marca = document.createElement('span');
      marca.className = `fin-etiqueta-benef__tipo fin-etiqueta-benef__tipo--${tipo}`;
      marca.textContent = rotulo;
      item.append(marca, document.createTextNode(tipo === 'cms' ? 'dono do cliente' : 'desenhista da peça'));
      caixa.appendChild(item);
    }
    const nomes = [...new Set(lista.map(b => b.beneficiario).filter(Boolean))];
    for (const nome of nomes) {
      const item = document.createElement('span');
      item.className = 'fin-legenda__item';
      item.append(ponto(nome), document.createTextNode(nome));
      caixa.appendChild(item);
    }
    return caixa;
  }

  /** Junta CMS e Royalty da mesma pessoa, do maior para o menor. */
  function porPessoa(lista = []) {
    const mapa = new Map();
    for (const b of lista) {
      const k = chave(b.beneficiario);
      const atual = mapa.get(k) || { beneficiario: b.beneficiario, cms: 0, royalty: 0, total: 0 };
      const valor = Number(b.valor) || 0;
      atual[b.tipo === 'royalty' ? 'royalty' : 'cms'] += valor;
      atual.total += valor;
      mapa.set(k, atual);
    }
    return [...mapa.values()]
      .map(x => ({ ...x, cms: Math.round(x.cms * 100) / 100, royalty: Math.round(x.royalty * 100) / 100, total: Math.round(x.total * 100) / 100 }))
      .sort((a, b) => b.total - a.total || String(a.beneficiario).localeCompare(String(b.beneficiario), 'pt-BR'));
  }

  window.Beneficiarios = { TIPOS, chave, cor, ponto, etiqueta, legenda, porPessoa };
})();
