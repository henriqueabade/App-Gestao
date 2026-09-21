// Regra Produção da peça — aberto por Novo e Editar produto.
// Quem abre deixa em `window.regraProducaoContexto`:
//   { controle (RegraProducaoPeca.criar), peca: { codigo, nome }, aoFechar }
// O que se escolhe aqui volta para o rascunho do controle ("Aplicar") e só é
// gravado quando a peça for registrada/salva. Ver src/js/utils/produto-regra-producao.js.
(function () {
  const ID = 'regraProducaoPeca';
  const overlay = document.getElementById('regraProducaoPecaOverlay');
  const ctx = window.regraProducaoContexto || null;
  const R = window.RegraProducaoPeca;

  // Esc fecha só este modal: na captura, antes do Esc do modal da peça.
  function esc(e) {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    fechar();
  }
  function fechar() {
    window.removeEventListener('keydown', esc, true);
    try { ctx?.aoFechar?.(); } catch (err) { console.error(err); }
    Modal.close(ID);
  }
  if (!overlay) return;
  // Reaberto sem quem o abriu (ex.: depois de uma queda): não há peça a configurar.
  if (!ctx || !ctx.controle || !R) { fechar(); return; }
  window.addEventListener('keydown', esc, true);

  const el = id => document.getElementById(id);
  const mensagem = el('regraProducaoMensagem');
  const corpo = el('regraProducaoCorpo');
  const controle = ctx.controle;
  const preco = controle.preco();
  const local = controle.rascunho();

  el('regraProducaoPeca').textContent = [ctx.peca?.codigo, ctx.peca?.nome].filter(Boolean).join(' — ');
  el('regraProducaoPreco').textContent = preco > 0 ? R.formatarMoeda(preco) : 'sem preço';
  el('regraProducaoPreco').title = preco > 0
    ? 'Preço cheio da tabela fixa: é sobre ele que o % é calculado.'
    : 'A peça ainda não tem preço na tabela fixa: o % só vira valor quando ela tiver.';

  function avisar(texto, tipo = 'erro') {
    mensagem.textContent = texto || '';
    mensagem.classList.toggle('hidden', !texto);
    mensagem.style.color = tipo === 'erro' ? 'var(--color-red)' : 'var(--color-green)';
  }

  const criar = (tag, classe, texto) => {
    const n = document.createElement(tag);
    if (classe) n.className = classe;
    if (texto !== undefined && texto !== null) n.textContent = texto;
    return n;
  };
  const celula = (conteudo, classe = 'px-4 py-3 text-gray-300') => {
    const td = criar('td', classe);
    if (conteudo instanceof Node) td.appendChild(conteudo); else td.textContent = conteudo ?? '';
    return td;
  };
  const opcao = (valor, texto) => { const o = document.createElement('option'); o.value = valor; o.textContent = texto; return o; };
  const CAMPO = 'w-full bg-input border border-inputBorder rounded-lg px-3 py-2 text-sm text-white placeholder-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/50 transition';

  /** A prévia da peça inteira e o que falta, para uma linha. */
  function previa(linha, escolha) {
    if (!linha.etapa) return { texto: 'processo não cadastrado', erro: true };
    if (!linha.pagando) return { texto: 'pagamento desligado', erro: false };
    const problema = R.erroDaEscolha(escolha);
    if (problema) return { texto: problema, erro: true };
    const regra = R.regraDaEscolha(escolha) || linha.etapa.padrao || null;
    if (!regra) return { texto: 'sem valor: defina aqui ou em todas as peças', erro: true };
    const valor = R.valorDaPeca(regra, preco);
    if (valor === null) return { texto: 'o % precisa do preço da tabela fixa', erro: false };
    const porInsumo = linha.insumos > 1 ? ` · ${linha.insumos} insumos: ${R.formatarMoeda(Math.round(valor / linha.insumos * 100) / 100)} cada` : '';
    return { texto: `${R.formatarMoeda(valor)}${porInsumo}`, erro: false };
  }

  const linhas = controle.linhas();
  el('regraProducaoVazio').classList.toggle('hidden', linhas.length > 0);
  el('regraProducaoTabela').classList.toggle('hidden', linhas.length === 0);

  for (const linha of linhas) {
    const chave = linha.etapa ? String(linha.etapa.id) : null;
    const guardada = chave ? local.get(chave) : null;
    const escolha = guardada ? { ...guardada } : { modo: 'padrao', valor: '' };
    const tr = criar('tr');

    const nome = criar('div', 'flex flex-wrap items-center gap-2');
    nome.appendChild(criar('span', 'text-white font-medium', linha.nome));
    if (!linha.etapa) nome.appendChild(criar('span', 'badge-danger px-2 py-0.5 rounded-full text-xs', 'não cadastrado'));
    else if (!linha.pagando) nome.appendChild(criar('span', 'badge-process px-2 py-0.5 rounded-full text-xs', 'pagamento desligado'));

    const modo = criar('select', `${CAMPO} select-arrow appearance-none`);
    modo.append(opcao('padrao', 'Usar a de todas as peças'), opcao('valor', 'R$ por peça'), opcao('percentual', '% da tabela fixa'));
    modo.value = escolha.modo;
    const valor = criar('input', CAMPO);
    valor.type = 'text';
    valor.inputMode = 'decimal';
    valor.autocomplete = 'off';
    valor.value = escolha.modo === 'padrao' ? '' : (escolha.valor || '');
    const saida = criar('span', 'whitespace-nowrap');
    const bloqueada = !linha.etapa || !linha.pagando;
    modo.disabled = bloqueada;

    const atualizar = () => {
      valor.disabled = bloqueada || escolha.modo === 'padrao';
      valor.placeholder = escolha.modo === 'percentual' ? 'Ex.: 10 ou 7,5' : (escolha.modo === 'valor' ? 'R$ 0,00' : 'vale a de todas as peças');
      const p = previa(linha, escolha);
      saida.textContent = p.texto;
      saida.style.color = p.erro ? 'var(--color-red)' : '';
      saida.classList.toggle('text-white', !p.erro);
      if (chave) local.set(chave, { ...escolha });
    };
    modo.addEventListener('change', () => {
      escolha.modo = modo.value;
      escolha.valor = modo.value === 'padrao' ? '' : valor.value;
      if (modo.value !== 'padrao') valor.focus();
      atualizar();
    });
    valor.addEventListener('input', () => { escolha.valor = valor.value; atualizar(); });
    valor.addEventListener('blur', () => {
      const n = R.lerNumero(valor.value);
      if (n === null || escolha.modo === 'padrao') return;
      valor.value = escolha.modo === 'valor' ? R.formatarMoeda(n) : String(n).replace('.', ',');
      escolha.valor = valor.value;
      atualizar();
    });

    tr.append(
      celula(nome),
      celula(String(linha.insumos)),
      celula(linha.etapa?.padrao ? R.descrever(linha.etapa.padrao) : '—'),
      celula(modo, 'px-4 py-3 min-w-[180px]'),
      celula(valor, 'px-4 py-3 min-w-[140px]'),
      celula(saida, 'px-4 py-3 text-right')
    );
    corpo.appendChild(tr);
    atualizar();
  }

  function aplicar() {
    avisar('');
    const invalidas = linhas.filter(l => l.etapa && l.pagando && R.erroDaEscolha(local.get(String(l.etapa.id))));
    if (invalidas.length) {
      avisar(`Confira o valor de: ${invalidas.map(l => l.nome).join(', ')}.`);
      return;
    }
    controle.definirRascunho(local);
    const faltam = controle.pendencias();
    window.showToast?.(faltam.length
      ? `Regra aplicada, mas ainda falta: ${faltam.map(f => f.nome).join(', ')}.`
      : 'Regra de produção aplicada. Ela é gravada quando a peça for salva.', faltam.length ? 'warning' : 'success');
    fechar();
  }

  el('regraProducaoVoltar').addEventListener('click', fechar);
  el('regraProducaoCancelar').addEventListener('click', fechar);
  el('regraProducaoAplicar').addEventListener('click', aplicar);
})();
