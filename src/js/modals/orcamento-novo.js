(() => {
  const overlayId = 'novoOrcamento';
  const overlay = document.getElementById('novoOrcamentoOverlay');
  // Scroll do Novo Orçamento restrito ao corpo (entre header e footer), igual Editar Orçamento.
  if (!overlay) return;
  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }
  const escapeAttr = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#39;');
  const close = () => Modal.close(overlayId);
  document.addEventListener('keydown', function esc(e){ if(e.key === 'Escape'){ close(); document.removeEventListener('keydown', esc); } });

  const form = document.getElementById('novoOrcamentoForm');

  const clients = {};
  const products = {};

  const parseCurrencyToCents = window.parseCurrencyToCents || (v => {
    if (!v) return 0;
    const normalized = v.toString()
      .replace(/\s/g,'')
      .replace(/[A-Za-z\$]/g,'')
      .replace(/\./g,'')
      .replace(',', '.');
    const value = Number(normalized);
    return isNaN(value) ? 0 : Math.round(value * 100);
  });

  const clienteSelect = document.getElementById('novoCliente');
  const contatoSelect = document.getElementById('novoContato');
  const produtoSelect = document.getElementById('itemProduto');
  const itensTbody = document.querySelector('#novoItensTabela tbody');
  const condicaoSelect = document.getElementById('novoCondicao');
  const transportadoraSelect = document.getElementById('novoTransportadora');
  const formaPagamentoSelect = document.getElementById('novoFormaPagamento');
  const donoSelect = document.getElementById('novoDono');
  const pagamentoBox = document.getElementById('novoPagamento');
  const condicaoWrapper = condicaoSelect.parentElement;
  let parcelamentoLoaded = false;
  let condicaoDefinida = false;
  let prevCondicao = condicaoSelect.value;
  function loadParcelamento(){
    return new Promise(res=>{
      if(parcelamentoLoaded){res();return;}
      const s=document.createElement('script');
      s.src='../js/utils/parcelamento.js';
      s.onload=()=>{parcelamentoLoaded=true;res();};
      document.head.appendChild(s);
    });
  }
  function resetCondicao(){
    condicaoSelect.value = '';
    condicaoSelect.setAttribute('data-filled','false');
    pagamentoBox.classList.add('hidden');
    pagamentoBox.innerHTML='';
    condicaoDefinida = false;
  }
  function showResetDialog(cb){
    const overlay=document.createElement('div');
    overlay.className='app-message-overlay fixed inset-0 bg-black/50 flex items-center justify-center p-4';
    overlay.style.zIndex = 'var(--z-dialog)';
    overlay.innerHTML=`<div class="max-w-md w-full glass-surface backdrop-blur-xl rounded-2xl border border-white/10 ring-1 ring-white/5 shadow-2xl/40 animate-modalFade"><div class="p-6 text-center"><h3 class="text-lg font-semibold mb-4 text-yellow-300">Atenção</h3><p class="text-sm text-gray-300 mb-6">Esta ação irá reiniciar a condição de pagamento. Deseja continuar?</p><div class="flex justify-center gap-4"><button id="resetYes" class="btn-warning px-4 py-2 rounded-lg text-white font-medium">Sim</button><button id="resetNo" class="btn-neutral px-4 py-2 rounded-lg text-white font-medium">Não</button></div></div></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#resetYes').addEventListener('click',()=>{overlay.remove();cb(true);});
    overlay.querySelector('#resetNo').addEventListener('click',()=>{overlay.remove();cb(false);});
  }
  function showBlockedDialog(){
    const overlay=document.createElement('div');
    overlay.className='app-message-overlay fixed inset-0 bg-black/50 flex items-center justify-center p-4';
    overlay.style.zIndex = 'var(--z-dialog)';
    overlay.innerHTML=`<div class="max-w-sm w-full glass-surface backdrop-blur-xl rounded-2xl border border-yellow-500/20 ring-1 ring-yellow-500/30 shadow-2xl/40 animate-modalFade"><div class="p-6 text-center"><h3 class="text-lg font-semibold mb-4 text-yellow-400">Condição de Pagamento Bloqueada</h3><p class="text-sm text-gray-300 mb-6">Para definir condição de pagamento é necessario adicionar itens ao orçamento primeiro!</p><div class="flex justify-center"><button id="blockedOk" class="btn-warning px-6 py-2 rounded-lg text-white font-medium active:scale-95">OK</button></div></div></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#blockedOk').addEventListener('click',()=>overlay.remove());
  }

  function showMissingDialog(fields){
    const overlay=document.createElement('div');
    overlay.className='app-message-overlay fixed inset-0 bg-black/50 flex items-center justify-center p-4';
    overlay.style.zIndex = 'var(--z-dialog)';
    overlay.innerHTML=`<div class="max-w-sm w-full glass-surface backdrop-blur-xl rounded-2xl border border-yellow-500/20 ring-1 ring-yellow-500/30 shadow-2xl/40 animate-modalFade"><div class="p-6 text-center"><h3 class="text-lg font-semibold mb-4 text-yellow-400">Dados Incompletos</h3><p class="text-sm text-gray-300 mb-6">Preencha os campos: ${fields.join(', ')}</p><div class="flex justify-center"><button id="missingOk" class="btn-warning px-6 py-2 rounded-lg text-white font-medium active:scale-95">OK</button></div></div></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#missingOk').addEventListener('click',()=>overlay.remove());
  }
  function confirmResetIfNeeded(action){
    if(!condicaoDefinida){action();return;}
    showResetDialog(ok=>{
      if(!ok) return;
      resetCondicao();
      applyDefaultDiscounts();
      action();
    });
  }
  function updateCondicao(){
    if(condicaoSelect.value==='vista'){
      pagamentoBox.innerHTML=`
        <div class="relative w-40">
          <input id="novoPrazoVista" name="prazo" type="number" min="0" data-numeric-decimals="0" placeholder=" " required class="peer w-full bg-input border border-inputBorder rounded-lg px-4 py-3 text-white placeholder-transparent focus:border-primary focus:ring-2 focus:ring-primary/50 transition" data-filled="false" />
          <label for="novoPrazoVista" class="absolute left-4 top-1/2 -translate-y-1/2 text-base text-gray-300 pointer-events-none transition-all duration-150 peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:text-base peer-focus:top-0 peer-focus:-translate-y-full peer-focus:text-xs peer-focus:text-primary peer-valid:top-0 peer-valid:-translate-y-full peer-valid:text-xs peer-data-[filled=true]:top-0 peer-data-[filled=true]:-translate-y-full peer-data-[filled=true]:text-xs">Prazo (dias)</label>
        </div>`;
      pagamentoBox.classList.remove('hidden');
      const prazoInput=document.getElementById('novoPrazoVista');
      const syncPrazo=()=>prazoInput.setAttribute('data-filled',prazoInput.value? 'true':'false');
      prazoInput.addEventListener('input',syncPrazo);
      syncPrazo();
    } else if(condicaoSelect.value==='prazo'){
      pagamentoBox.classList.remove('hidden');
      pagamentoBox.innerHTML='<div id="novoParcelamento"></div>';
      loadParcelamento().then(()=>Parcelamento.init('novoParcelamento',{getTotal:()=>parseCurrencyToCents(document.getElementById('novoTotal').textContent)}));
    } else {
      pagamentoBox.classList.add('hidden');
      pagamentoBox.innerHTML='';
    }
  }
  condicaoSelect.addEventListener('change', ()=>{condicaoDefinida=true;condicaoSelect.setAttribute('data-filled','true');updateCondicao();applyDefaultDiscounts();recalcTotals();});
  condicaoWrapper.addEventListener('click',e=>{if(condicaoSelect.disabled){e.preventDefault();showBlockedDialog();}});
  condicaoSelect.disabled = true;
  condicaoSelect.style.pointerEvents='none';
  updateCondicao();

  async function carregarClientes(){
    try {
      const resp = await fetchApi('/api/clientes/lista');
      const data = await resp.json();
      clienteSelect.innerHTML = '<option value="" disabled selected hidden></option>' +
        data.map(c => `<option value="${c.id}">${c.nome_fantasia}</option>`).join('');
      data.forEach(c => { clients[c.id] = c; });
      clienteSelect.setAttribute('data-filled', 'false');
    } catch(err){ console.error('Erro ao carregar clientes', err); }
  }

  async function carregarUsuarios(){
    try {
      const resp = await fetchApi('/api/usuarios/lista');
      const data = await resp.json();
      donoSelect.innerHTML = '<option value="" disabled selected hidden></option>' +
        data.map(u => `<option value="${u.nome}">${u.nome}</option>`).join('');
      donoSelect.setAttribute('data-filled','false');
    } catch(err){ console.error('Erro ao carregar usuários', err); }
  }

  async function carregarContatos(clienteId){
    contatoSelect.innerHTML = '<option value="" disabled selected hidden></option>';
    contatoSelect.setAttribute('data-filled', 'false');
    if(!clienteId) return;
    try {
      const resp = await fetchApi(`/api/clientes/${clienteId}`);
      const data = await resp.json();
      (data.contatos || []).forEach(ct => {
        const opt = document.createElement('option');
        opt.value = ct.id;
        opt.textContent = ct.nome;
        contatoSelect.appendChild(opt);
      });
    } catch(err){ console.error('Erro ao carregar contatos', err); }
  }

  // -------------------------------------------------------------------------
  // Cadastrar e excluir a transportadora DESTE cliente, sem sair do orçamento.
  //
  // Mesmo par de botões das coleções em Produtos, e o mesmo sub-modal que o
  // cadastro de cliente usa para pedir o nome — reaproveitar os dois é o que
  // faz esta caixa se comportar como as outras do programa.
  // -------------------------------------------------------------------------
  function ligarBotoesDeTransportadora() {
    const add = document.getElementById('novoTransportadoraAdd');
    const del = document.getElementById('novoTransportadoraDel');
    if (!add && !del) return;

    const clienteAtual = () => clienteSelect?.value || '';

    const executar = (botao, acao) => {
      if (!botao) return;
      // `BotaoAcao` dá o carregando e trava o segundo clique. Sem ele, dois
      // cliques cadastram a mesma transportadora duas vezes — e a segunda só é
      // recusada depois de ir ao servidor.
      if (window.BotaoAcao?.bind) window.BotaoAcao.bind(botao, acao);
      else botao.addEventListener('click', acao);
    };

    executar(add, async () => {
      if (!clienteAtual()) {
        showToast('Escolha o cliente antes de cadastrar uma transportadora', 'error');
        return;
      }

      // O sub-modal só COLETA o nome; quem grava é este modal, que sabe de
      // qual cliente se trata. Um sub-modal que gravasse sozinho precisaria
      // saber disso também, e as duas telas passariam a ter a mesma regra.
      const nome = await pedirNomeDaTransportadora();
      if (!nome) return;

      try {
        const r = await window.Transportadoras.cadastrar({
          select: transportadoraSelect,
          clienteId: clienteAtual(),
          nome
        });
        showToast(`${r.nome} cadastrada para este cliente`, 'success');
      } catch (err) {
        showToast(err?.message || 'Não foi possível cadastrar a transportadora', 'error');
      }
    });

    executar(del, async () => {
      const id = window.Transportadoras.idEscolhido(transportadoraSelect);
      if (!id) {
        // "Não Definida" não tem cadastro para excluir, e nem deveria: ela é a
        // resposta de quem ainda não sabe, não uma empresa.
        showToast('Escolha uma transportadora cadastrada para excluir', 'info');
        return;
      }

      const nome = transportadoraSelect.value;
      if (window.DialogPadrao?.confirm) {
        const seguir = await window.DialogPadrao.confirm({
          title: 'Excluir transportadora',
          message: `${nome} sai do cadastro deste cliente. `
            + 'Os orçamentos e pedidos que já a citam continuam como estão.',
          confirmText: 'Excluir',
          cancelText: 'Voltar'
        });
        if (!seguir) return;
      }

      try {
        await window.Transportadoras.excluir({
          select: transportadoraSelect,
          clienteId: clienteAtual(),
          id
        });
        showToast(`${nome} excluída`, 'success');
      } catch (err) {
        showToast(err?.message || 'Não foi possível excluir a transportadora', 'error');
      }
    });
  }

  /**
   * Abre o sub-modal que pede o nome e resolve com o que foi digitado.
   *
   * É o MESMO sub-modal do cadastro de cliente: mesma aparência, mesmo
   * tratamento de Esc, mesma proteção contra o segundo envio. Uma segunda tela
   * para pedir um nome só divergiria dela.
   */
  function pedirNomeDaTransportadora() {
    return new Promise(resolve => {
      let respondido = false;

      const aoSalvar = e => {
        respondido = true;
        limpar();
        resolve(String(e?.detail?.transportadora || '').trim());
      };

      // Fechar sem salvar também resolve — senão a promessa fica pendurada e o
      // botão nunca sai do estado de carregando.
      const aoFechar = e => {
        if (e?.detail !== 'transportadoraCliente' || respondido) return;
        limpar();
        resolve('');
      };

      function limpar() {
        window.removeEventListener('clienteTransportadoraSalva', aoSalvar);
        window.removeEventListener('modalFechado', aoFechar);
      }

      window.addEventListener('clienteTransportadoraSalva', aoSalvar);
      window.addEventListener('modalFechado', aoFechar);

      Modal.open('modals/clientes/transportadora.html',
        '../js/modals/cliente-transportadora.js', 'transportadoraCliente', true);
    });
  }

  ligarBotoesDeTransportadora();

  // A lista, o "Não Definida" e as duas ações vivem em
  // `src/js/utils/transportadoras.js`: este modal e o de edição precisam
  // exatamente das mesmas, e escritas duas vezes divergiriam na primeira
  // mudança — como uma transportadora que existe numa tela e não na outra.
  async function carregarTransportadoras(clienteId){
    await window.Transportadoras?.carregar(transportadoraSelect, clienteId);
  }

  async function carregarProdutos(){
    try {
      const lista = await (window.electronAPI?.listarProdutos?.() ?? []);
      produtoSelect.innerHTML = '<option value="" disabled selected hidden></option>' +
        lista.map(p => `<option value="${p.id}">${p.nome}</option>`).join('');
      lista.forEach(p => {
        // Orçamento vende pelo preço PRATICADO (tabela fixa), não pelo custo
        // apurado — ver src/utils/precoTabela.js.
        const praticado = window.PrecoTabela?.precoDeVenda(p) ?? null;
        products[p.id] = {
          nome: p.nome,
          valor: praticado ?? 0,
          semPreco: praticado === null,
          codigo: p.codigo,
          ncm: p.ncm
        };
      });
      produtoSelect.setAttribute('data-filled', 'false');
    } catch(err){ console.error('Erro ao carregar produtos', err); }
  }

  // sincroniza labels flutuantes
  ['novoCliente','novoContato','novoCondicao','novoTransportadora','novoFormaPagamento','itemProduto','novoDono'].forEach(id => {
    const el = document.getElementById(id);
    if(!el) return;
    const sync = () => el.setAttribute('data-filled', el.value !== '' ? 'true' : 'false');
    sync();
    el.addEventListener('change', sync);
    el.addEventListener('blur', sync);
  });

  clienteSelect.addEventListener('change', () => {
    // Em modo prospecção este select carrega o id de uma PROSPECÇÃO. Deixar o
    // handler de cliente rodar aqui buscaria /api/clientes/{idDaProspeccao} e
    // /api/transportadoras/{idDaProspeccao} — dados de outra empresa — e ainda
    // apagava o aviso "Definir na conversão em pedido" da transportadora.
    if (window.__orcamentoModoProspeccao) return;
    carregarContatos(clienteSelect.value);
    carregarTransportadoras(clienteSelect.value);
    if(!donoSelect.value){
      const donoCli = clients[clienteSelect.value]?.dono_cliente;
      if(donoCli){
        donoSelect.value = donoCli;
        donoSelect.setAttribute('data-filled','true');
      }
    }
  });

  // -------------------------------------------------------------------------
  // Modo prospecção (OCRP)
  //
  // A tela é a MESMA — itens, descontos, parcelamento e totais valem igual.
  // Muda só de quem é a proposta: em vez de escolher entre os clientes, o
  // destinatário já vem definido pela prospecção que abriu o modal.
  //
  // Duplicar este arquivo para a variante seria condenar as duas cópias a
  // divergirem na primeira mudança de regra de desconto.
  // -------------------------------------------------------------------------
  const prospeccao = window.orcamentoProspeccao || null;
  // Lido pelo handler de `change` do select de cliente, registrado mais acima.
  window.__orcamentoModoProspeccao = Boolean(prospeccao);
  // Consome o sinal na hora. Deixá-lo pendurado fazia o PRÓXIMO "Novo
  // Orçamento" — o do módulo de Orçamentos, para um cliente — abrir preso à
  // última prospecção visitada. A restauração de trabalho o repõe sozinha
  // (`registrarContexto` logo abaixo), então apagar aqui não perde nada.
  delete window.orcamentoProspeccao;

  /** Carrega os contatos da prospecção escolhida no seletor de contato. */
  async function carregarContatosProspeccao(prospeccaoId){
    contatoSelect.innerHTML = '<option value="" disabled selected hidden></option>';
    contatoSelect.setAttribute('data-filled','false');
    if (!prospeccaoId) return;
    try {
      const resp = await fetchApi(`/api/prospeccoes/${prospeccaoId}`);
      const ficha = await resp.json();
      const contatos = ficha.contatos || [];
      contatoSelect.innerHTML = '<option value="" disabled selected hidden></option>' +
        contatos.map(ct => `<option value="${escapeAttr(ct.id)}">${escapeAttr(ct.nome)}</option>`).join('');
      // Contato principal já vem escolhido: é para ele que a proposta vai na
      // esmagadora maioria das vezes.
      const principal = contatos.find(ct => ct.principal) || contatos[0];
      if (principal) {
        contatoSelect.value = String(principal.id);
        contatoSelect.setAttribute('data-filled','true');
      }
    } catch(err){ console.error('Erro ao carregar contatos da prospecção', err); }
  }

  async function prepararProspeccao(){
    const rotulo = document.querySelector('label[for="novoCliente"]');
    if (rotulo) rotulo.textContent = 'Prospecção';

    if (prospeccao.escolher) {
      // Aberto pelo módulo de Orçamentos: o destinatário ainda será escolhido.
      // Só prospecções ATIVAS entram — emitir proposta para negócio já ganho ou
      // perdido não faz sentido.
      try {
        const resp = await fetchApi('/api/prospeccoes/lista');
        const dados = await resp.json();
        const itens = (Array.isArray(dados?.itens) ? dados.itens : [])
          .filter(x => x.status !== 'arquivada');
        clienteSelect.innerHTML = '<option value="" disabled selected hidden></option>' +
          itens.map(x => `<option value="${escapeAttr(x.id)}">${escapeAttr(x.nome_fantasia || x.razao_social || 'Sem nome')}</option>`).join('');
        clienteSelect.setAttribute('data-filled','false');
        if (!itens.length) showToast('Nenhuma prospecção ativa para orçar', 'info');
      } catch(err){
        console.error('Erro ao carregar prospecções', err);
        showToast('Não foi possível carregar as prospecções', 'error');
      }

      clienteSelect.addEventListener('change', () => {
        prospeccao.id = clienteSelect.value ? Number(clienteSelect.value) : null;
        carregarContatosProspeccao(prospeccao.id);
      });
    } else {
      const nome = prospeccao.nome_fantasia || prospeccao.razao_social || 'Prospecção';
      clienteSelect.innerHTML = `<option value="${escapeAttr(prospeccao.id)}">${escapeAttr(nome)}</option>`;
      clienteSelect.value = String(prospeccao.id);
      clienteSelect.setAttribute('data-filled','true');
      // Fica visível e legível, mas não escolhível: o orçamento pertence a esta
      // prospecção e trocar o destinatário no meio seria outro documento.
      clienteSelect.disabled = true;
      clienteSelect.classList.add('opacity-70','cursor-not-allowed');
      await carregarContatosProspeccao(prospeccao.id);
    }

    // Transportadora é cadastro POR CLIENTE — não existe para uma prospecção.
    // Deixar o campo obrigatório aqui travaria o orçamento num dado que só
    // pode existir depois da conversão.
    transportadoraSelect.innerHTML = '<option value="">Definir na conversão em pedido</option>';
    transportadoraSelect.required = false;
    transportadoraSelect.disabled = true;
    transportadoraSelect.classList.add('opacity-70','cursor-not-allowed');
    // O campo EXIBE texto, então o rótulo tem de subir. Com data-filled=false
    // ele ficava no meio do campo, por cima da própria opção.
    transportadoraSelect.setAttribute('data-filled','true');
  }

  if (prospeccao?.id || prospeccao?.escolher) {
    // Sem devolver o contexto, uma queda reabriria o modal em modo cliente e o
    // vínculo com a prospecção se perderia sem aviso.
    window.EstadoTrabalho?.registrarContexto?.(overlayId,
      () => ({ orcamentoProspeccao: prospeccao }));
    prepararProspeccao();
  } else {
    carregarClientes();
  }
  carregarUsuarios();
  carregarProdutos();

  function formatCurrency(v) {
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function updateLineTotal(tr){
    const qty = parseFloat(tr.children[1].textContent) || 0;
    const val = parseFloat(tr.children[2].textContent) || 0;
    const desc = parseFloat(tr.children[4].textContent) || 0;
    const valDesc = val * (1 - desc / 100);
    tr.children[3].textContent = valDesc.toFixed(2);
    tr.querySelector('.total-cell').textContent = formatCurrency(qty * valDesc);
  }

  function applyDefaultDiscounts(){
    const newCond = condicaoSelect.value;
    itensTbody.querySelectorAll('tr').forEach(tr => {
      const qty = parseFloat(tr.children[1].textContent) || 0;
      const currentDesc = parseFloat(tr.children[4].textContent) || 0;
      const oldDefault = (qty > 1 ? 5 : 0) + (prevCondicao === 'vista' ? 5 : 0);
      const special = Math.max(currentDesc - oldDefault, 0);
      const newDefault = (qty > 1 ? 5 : 0) + (newCond === 'vista' ? 5 : 0);
      const newDesc = special + newDefault;
      tr.children[4].textContent = newDesc.toFixed(2);
      updateLineTotal(tr);
    });
    prevCondicao = newCond;
  }

  function recalcTotals() {
    let subtotal = 0;
    let descPagTot = 0;
    let descEspTot = 0;
    itensTbody.querySelectorAll('tr').forEach(tr => {
      const qty = parseFloat(tr.children[1].textContent) || 0;
      const val = parseFloat(tr.children[2].textContent) || 0;
      const descTotal = parseFloat(tr.children[4].textContent) || 0;
      const defaultDesc = (qty > 1 ? 5 : 0) + (condicaoSelect.value === 'vista' ? 5 : 0);
      const descPagPrc = Math.min(defaultDesc, descTotal);
      const descEspPrc = Math.max(descTotal - descPagPrc, 0);
      const line = qty * val;
      subtotal += line;
      descPagTot += (val * (descPagPrc / 100)) * qty;
      descEspTot += (val * (descEspPrc / 100)) * qty;
    });
    const desconto = descPagTot + descEspTot;
    document.getElementById('novoSubtotal').textContent = formatCurrency(subtotal);
    document.getElementById('novoDescPag').textContent = formatCurrency(descPagTot);
    document.getElementById('novoDescEsp').textContent = formatCurrency(descEspTot);
    document.getElementById('novoDesconto').textContent = formatCurrency(desconto);
    const total = subtotal - desconto;
    document.getElementById('novoTotal').textContent = formatCurrency(total);
    const footerTotal = document.getElementById('novoTotalFooter');
    if (footerTotal) footerTotal.textContent = formatCurrency(total);
    itensTbody.querySelectorAll('tr').forEach(updateLineTotal);
    condicaoSelect.disabled = total === 0;
    condicaoSelect.style.pointerEvents = condicaoSelect.disabled ? 'none' : 'auto';
    if(total === 0){ resetCondicao(); prevCondicao=''; }
    if(condicaoSelect.value==='prazo' && window.Parcelamento){
      Parcelamento.updateTotal('novoParcelamento', parseCurrencyToCents(document.getElementById('novoTotal').textContent));
    }
  }

  function attachRowEvents(tr){
    const editBtn = tr.querySelector('.fa-edit');
    const delBtn = tr.querySelector('.fa-trash');
    delBtn.addEventListener('click', () => {
      showActionDialog('Deseja remover este item?', ok => {
        if(!ok) return;
        confirmResetIfNeeded(() => { tr.remove(); recalcTotals(); });
      });
    });
    editBtn.addEventListener('click', () => startEdit(tr));
  }

  function startEdit(tr){
    const qtyCell = tr.children[1];
    const valCell = tr.children[2];
    const descCell = tr.children[4];
    const actionsCell = tr.children[6];

    const qtyVal = qtyCell.textContent.trim();
    const valVal = valCell.textContent.trim();
    const descVal = descCell.textContent.trim();

    qtyCell.innerHTML = `<input type="number" class="w-16 bg-input border border-inputBorder rounded px-2 py-1 text-white text-xs text-left focus:border-primary focus:ring-1 focus:ring-primary/50 transition" value="${qtyVal}" min="1">`;
    descCell.innerHTML = `<input type="number" class="w-16 bg-input border border-inputBorder rounded px-2 py-1 text-white text-xs text-left focus:border-primary focus:ring-1 focus:ring-primary/50 transition" value="${descVal}" min="0" step="0.0001">`;

    actionsCell.innerHTML = `
      <i class="fas fa-check w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 text-green-400"></i>
      <i class="fas fa-times w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 text-red-400"></i>
    `;
    const confirmBtn = actionsCell.querySelector('.fa-check');
    const cancelBtn = actionsCell.querySelector('.fa-times');
    const qtyInput = qtyCell.querySelector('input');
    const descInput = descCell.querySelector('input');

    qtyInput.addEventListener('input', () => {
      const q = parseFloat(qtyInput.value) || 0;
      const oldQty = parseFloat(qtyVal) || 0;
      // Use prevCondicao como referência do default antigo (condição vigente quando o desconto atual foi aplicado)
      const oldDefault = (oldQty > 1 ? 5 : 0) + (prevCondicao === 'vista' ? 5 : 0);
      const oldTotal = parseFloat(descVal) || 0;
      const special = Math.max(oldTotal - oldDefault, 0);
      const newDefault = (q > 1 ? 5 : 0) + (condicaoSelect.value === 'vista' ? 5 : 0);
      descInput.value = (special + newDefault).toFixed(2);
    });

    confirmBtn.addEventListener('click', () => {
      showActionDialog('Deseja salvar as alterações deste item?', ok => {
        if(!ok) return;
        confirmResetIfNeeded(() => {
          qtyCell.textContent = qtyInput.value;
          valCell.textContent = valVal;
          descCell.textContent = parseFloat(descInput.value).toFixed(2);
          actionsCell.innerHTML = `
            <i class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)"></i>
            <i data-perm="orc.item.remove" class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 text-red-400"></i>
          `;
          updateLineTotal(tr);
          attachRowEvents(tr);
          recalcTotals();
        });
      });
    });

    cancelBtn.addEventListener('click', () => {
      qtyCell.textContent = qtyVal;
      valCell.textContent = valVal;
      descCell.textContent = descVal;
      actionsCell.innerHTML = `
        <i class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)"></i>
        <i class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 text-red-400"></i>
      `;
      attachRowEvents(tr);
      recalcTotals();
    });
  }

  function showDuplicateDialog(callback) {
    const overlay = document.createElement('div');
    overlay.className = 'app-message-overlay fixed inset-0 bg-black/50 flex items-center justify-center p-4';
    overlay.style.zIndex = 'var(--z-dialog)';
    overlay.innerHTML = `
      <div class="max-w-lg w-full glass-surface backdrop-blur-xl rounded-2xl border border-white/10 ring-1 ring-white/5 shadow-2xl/40 animate-modalFade">
        <div class="p-6 text-center">
          <h3 class="text-lg font-semibold mb-4 text-white">Item já adicionado</h3>
          <p class="text-sm text-gray-300 mb-6">O item selecionado já está na lista. O que deseja fazer?</p>
          <div class="flex justify-center gap-4">
            <button id="dupSomar" class="btn-warning px-4 py-2 rounded-lg text-white font-medium">Somar</button>
            <button id="dupSubstituir" class="btn-danger px-4 py-2 rounded-lg text-white font-medium">Substituir</button>
            <button id="dupManter" class="btn-neutral px-4 py-2 rounded-lg text-white font-medium">Manter</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#dupSomar').addEventListener('click', () => { overlay.remove(); callback('somar'); });
    overlay.querySelector('#dupSubstituir').addEventListener('click', () => { overlay.remove(); callback('substituir'); });
    overlay.querySelector('#dupManter').addEventListener('click', () => { overlay.remove(); callback('manter'); });
  }

  function showActionDialog(message, cb){
    const overlay=document.createElement('div');
    overlay.className='app-message-overlay fixed inset-0 bg-black/50 flex items-center justify-center p-4';
    overlay.style.zIndex = 'var(--z-dialog)';
    overlay.innerHTML=`<div class="max-w-md w-full glass-surface backdrop-blur-xl rounded-2xl border border-white/10 ring-1 ring-white/5 shadow-2xl/40 animate-modalFade"><div class="p-6 text-center"><h3 class="text-lg font-semibold mb-4 text-yellow-300">Atenção</h3><p class="text-sm text-gray-300 mb-6">${message}</p><div class="flex justify-center gap-4"><button id="actYes" class="btn-warning px-4 py-2 rounded-lg text-white font-medium">Sim</button><button id="actNo" class="btn-neutral px-4 py-2 rounded-lg text-white font-medium">Não</button></div></div></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#actYes').addEventListener('click',()=>{overlay.remove();cb(true);});
    overlay.querySelector('#actNo').addEventListener('click',()=>{overlay.remove();cb(false);});
  }

  function addItem(prodId, qtd){
    const product = products[prodId];
    if (!product) return;
    // Sem preço na tabela fixa a peça não tem valor de venda aprovado. Entrar
    // com zero produziria uma proposta com item de graça — barramos e dizemos
    // onde resolver.
    if (product.semPreco) {
      showToast(window.PrecoTabela.motivoSemPreco({ nome: product.nome, codigo: product.codigo }), 'error');
      return;
    }
    const existing = Array.from(itensTbody.children).find(tr => tr.dataset.id === prodId);
    if (existing) {
      showDuplicateDialog(choice => {
        if (choice === 'somar') {
          const qtyCell = existing.children[1];
          const newQty = (parseFloat(qtyCell.textContent) || 0) + qtd;
          qtyCell.textContent = newQty;
          const defaultDesc = (newQty > 1 ? 5 : 0) + (condicaoSelect.value === 'vista' ? 5 : 0);
          existing.children[4].textContent = defaultDesc.toFixed(2);
        } else if (choice === 'substituir') {
          existing.children[1].textContent = qtd;
          existing.children[2].textContent = product.valor.toFixed(2);
          const defaultDesc = (qtd > 1 ? 5 : 0) + (condicaoSelect.value === 'vista' ? 5 : 0);
          existing.children[4].textContent = defaultDesc.toFixed(2);
        }
        updateLineTotal(existing);
        recalcTotals();
      });
      return;
    }

    const defaultDesc = (qtd > 1 ? 5 : 0) + (condicaoSelect.value === 'vista' ? 5 : 0);
    const tr = document.createElement('tr');
    tr.dataset.id = prodId;
    tr.className = 'border-b border-white/10';
    tr.innerHTML = `
        <td data-perm-col="col_orc_it_nome" class="text-left text-white" title="${escapeAttr(product.nome)}">${product.nome}</td>
        <td data-perm-col="col_orc_it_qtd" class="text-left text-white">${qtd}</td>
        <td data-perm-col="col_orc_it_preco" class="text-left text-white">${product.valor.toFixed(2)}</td>
        <td data-perm-col="col_orc_it_preco_desc" class="text-left text-white">0.00</td>
        <td data-perm-col="col_orc_it_desc" class="text-left text-white">${defaultDesc.toFixed(2)}</td>
        <td data-perm-col="col_orc_it_subtotal" class="text-left text-white total-cell"></td>
        <td class="text-left actions-cell">
          <i class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)"></i>
          <i class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 text-red-400"></i>
        </td>`;
    itensTbody.appendChild(tr);
    updateLineTotal(tr);
    attachRowEvents(tr);
    recalcTotals();
  }

  document.getElementById('adicionarItemNovo').addEventListener('click', () => {
    const prodId = produtoSelect.value;
    const qtd = parseFloat(document.getElementById('itemQtd').value) || 1;
    if (!prodId || qtd <= 0) return;
    confirmResetIfNeeded(() => {
      addItem(prodId, qtd);
      produtoSelect.value = '';
      produtoSelect.setAttribute('data-filled', 'false');
      document.getElementById('itemQtd').value = 1;
    });
  });

  // ------------------------------------------------------------------
  // Preservação do trabalho (ver docs/restauracao-de-trabalho.md)
  //
  // Nada aqui volta pela varredura genérica de campos:
  //  - os itens são LINHAS de tabela montadas no DOM, não inputs;
  //  - a condição de pagamento monta o bloco de prazo/parcelamento por JS, e
  //    esse bloco nem existe no instante em que os campos são repostos;
  //  - o parcelamento guarda o próprio estado dentro de `window.Parcelamento`;
  //  - os selects de cliente/contato/transportadora/dono são preenchidos por
  //    `fetch`, e atribuir `value` antes das opções chegarem não faz nada.
  // ------------------------------------------------------------------
  function lerLinhaItem(tr) {
    return {
      id: tr.dataset.id,
      nome: tr.children[0].textContent,
      qtd: tr.children[1].textContent.trim(),
      valor: tr.children[2].textContent.trim(),
      valorDesc: tr.children[3].textContent.trim(),
      desc: tr.children[4].textContent.trim()
    };
  }

  function montarLinhaItem(dados) {
    const tr = document.createElement('tr');
    tr.dataset.id = dados.id;
    tr.className = 'border-b border-white/10';
    tr.innerHTML = `
        <td data-perm-col="col_orc_it_nome" class="text-left text-white" title="${escapeAttr(dados.nome)}">${escapeAttr(dados.nome)}</td>
        <td data-perm-col="col_orc_it_qtd" class="text-left text-white">${escapeAttr(dados.qtd)}</td>
        <td data-perm-col="col_orc_it_preco" class="text-left text-white">${escapeAttr(dados.valor)}</td>
        <td data-perm-col="col_orc_it_preco_desc" class="text-left text-white">${escapeAttr(dados.valorDesc)}</td>
        <td data-perm-col="col_orc_it_desc" class="text-left text-white">${escapeAttr(dados.desc)}</td>
        <td data-perm-col="col_orc_it_subtotal" class="text-left text-white total-cell"></td>
        <td class="text-left actions-cell">
          <i class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)"></i>
          <i class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 text-red-400"></i>
        </td>`;
    itensTbody.appendChild(tr);
    updateLineTotal(tr);
    attachRowEvents(tr);
  }

  window.EstadoTrabalho?.registrarConteudo?.(overlayId, {
    capturar: () => ({
      itens: Array.from(itensTbody.children).map(lerLinhaItem),
      condicao: condicaoSelect.value,
      condicaoDefinida,
      prevCondicao,
      prazoVista: document.getElementById('novoPrazoVista')?.value ?? '',
      parcelamento: window.Parcelamento?.getData?.('novoParcelamento') || null,
      selects: {
        novoCliente: clienteSelect.value,
        novoContato: contatoSelect.value,
        novoTransportadora: transportadoraSelect.value,
        novoFormaPagamento: formaPagamentoSelect.value,
        novoDono: donoSelect.value
      }
    }),
    restaurar: async (dados) => {
      if (!dados) return;

      // 1) Itens primeiro: é o total deles que libera a condição de pagamento.
      itensTbody.innerHTML = '';
      (Array.isArray(dados.itens) ? dados.itens : []).forEach(montarLinhaItem);

      // `prevCondicao` precisa valer o que valia quando os descontos foram
      // calculados, senão `applyDefaultDiscounts` recalcularia tudo errado.
      prevCondicao = dados.prevCondicao ?? prevCondicao;

      // Quem chega SEM desconto nenhum pede a regra do módulo — 5% acima de
      // uma peça, mais 5% à vista. É o caso do preenchimento pela IA: as
      // linhas vêm do documento e nenhum desconto passou por ninguém.
      //
      // A restauração depois de uma queda NÃO pede: ali os descontos já foram
      // calculados, e alguns foram negociados à mão. Recalcular desfaria o que
      // a pessoa combinou com o cliente.
      if (dados.aplicarDescontoPadrao) applyDefaultDiscounts();

      recalcTotals();

      // 2) Selects assíncronos. Cliente antes de contato/transportadora: o
      // `change` do cliente é quem dispara o carregamento dos outros dois.
      const repor = window.EstadoTrabalho?.reporSelect;
      const selects = dados.selects || {};
      if (repor) {
        await repor(clienteSelect, selects.novoCliente);
        await Promise.all([
          repor(contatoSelect, selects.novoContato),
          repor(transportadoraSelect, selects.novoTransportadora),
          repor(donoSelect, selects.novoDono),
          repor(formaPagamentoSelect, selects.novoFormaPagamento)
        ]);
      }

      // 3) Condição de pagamento: reconstrói o bloco antes de repor o conteúdo.
      if (dados.condicao) {
        condicaoSelect.disabled = false;
        condicaoSelect.style.pointerEvents = 'auto';
        condicaoSelect.value = dados.condicao;
        condicaoSelect.setAttribute('data-filled', 'true');
        condicaoDefinida = Boolean(dados.condicaoDefinida);

        if (dados.condicao === 'vista') {
          updateCondicao();   // síncrona: só monta o campo de prazo
          const prazoInput = document.getElementById('novoPrazoVista');
          if (prazoInput && dados.prazoVista) {
            prazoInput.value = dados.prazoVista;
            prazoInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
        } else if (dados.condicao === 'prazo') {
          // De propósito NÃO chamamos `updateCondicao()` aqui: ela dispara
          // `Parcelamento.init` SEM prefill de forma assíncrona (o script é
          // carregado sob demanda) e apagaria as parcelas logo depois de
          // reposta. Montamos o mesmo container e inicializamos uma vez só,
          // já com os dados guardados.
          pagamentoBox.classList.remove('hidden');
          pagamentoBox.innerHTML = '<div id="novoParcelamento"></div>';
          await loadParcelamento();
          const p = dados.parcelamento;
          window.Parcelamento?.init('novoParcelamento', {
            getTotal: () => parseCurrencyToCents(document.getElementById('novoTotal').textContent),
            prefill: p ? { count: p.count, mode: p.mode, items: p.items } : undefined
          });
        }
        recalcTotals();
      }
    }
  });

    function saveQuote(status) {
      if (itensTbody.children.length === 0) {
        showMissingDialog(['Itens']);
        return;
      }
      // Modo prospecção aberto pelo módulo de Orçamentos: o destinatário é
      // escolhido aqui dentro e pode não ter sido escolhido ainda.
      if (prospeccao && !prospeccao.id) {
        showMissingDialog(['Prospecção']);
        return;
      }

      const clienteVal = clienteSelect.value;
      const contatoVal = contatoSelect.value;
      const validadeVal = document.getElementById('novoValidade').value;
      const condicaoVal = condicaoSelect.value;
      const transportadoraVal = transportadoraSelect.value;
      const formaPagamentoVal = formaPagamentoSelect.value;
      const donoVal = donoSelect.value;

      const dataEmissao = new Date();
      let parcelas = 1;
      let prazo = '';
      let tipoParcela = 'a vista';
      let parcelasDetalhes = [];
      if (condicaoVal === 'vista') {
        const prazoVista = document.getElementById('novoPrazoVista')?.value;
        prazo = prazoVista;
        const totalCents = parseCurrencyToCents(document.getElementById('novoTotal').textContent);
        parcelasDetalhes.push({
          valor: totalCents / 100,
          data_vencimento: new Date(dataEmissao.getTime() + parseInt(prazoVista, 10) * 86400000).toISOString().split('T')[0]
        });
      } else if (condicaoVal === 'prazo') {
        const pdata = Parcelamento.getData('novoParcelamento');
        if (!pdata || !pdata.canRegister) {
          showMissingDialog(['Parcelamento']);
          return;
        }
        parcelas = pdata.count;
        prazo = pdata.items.map(it => it.dueInDays).join('/');
        parcelasDetalhes = pdata.items.map(it => ({
          valor: it.amount / 100,
          data_vencimento: new Date(dataEmissao.getTime() + (it.dueInDays || 0) * 86400000).toISOString().split('T')[0]
        }));
        tipoParcela = pdata.mode === 'equal' ? 'igual' : 'diferente';
      }

      const confirmMsg = status === 'Rascunho' ? 'Deseja salvar este orçamento?' : 'Deseja salvar e enviar este orçamento?';
    // Devolve promessa: quem chamou precisa saber QUANDO terminou.
    //
    // O diálogo confirma e some, e só ENTÃO começa a ida ao servidor. Era essa
    // janela — diálogo já fechado, gravação em curso, botão de novo clicável —
    // que aceitava o segundo clique e criava dois orçamentos iguais.
    return new Promise(resolve => {
    showActionDialog(confirmMsg, async ok => {
      if (!ok) return resolve();
      try {
        const subtotal = parseCurrencyToCents(document.getElementById('novoSubtotal').textContent) / 100;
        let descPagTot = 0;
        let descEspTot = 0;
        const itens = Array.from(itensTbody.children).map(tr => {
          const prodId = tr.dataset.id;
          const qty = parseFloat(tr.children[1].textContent) || 0;
          const val = parseFloat(tr.children[2].textContent) || 0;
          const descTotal = parseFloat(tr.children[4].textContent) || 0;
          const defaultDesc = (qty > 1 ? 5 : 0) + (condicaoVal === 'vista' ? 5 : 0);
          const descPagPrc = Math.min(defaultDesc, descTotal);
          const descEspPrc = Math.max(descTotal - descPagPrc, 0);
          const descPagVal = val * (descPagPrc / 100);
          const descEspVal = val * (descEspPrc / 100);
          const valorDesc = descPagVal + descEspVal;
          const valDesc = val - valorDesc;
          descPagTot += descPagVal * qty;
          descEspTot += descEspVal * qty;
          return {
            produto_id: prodId,
            codigo: products[prodId]?.codigo || '',
            nome: tr.children[0].textContent.trim(),
            ncm: products[prodId]?.ncm || '',
            quantidade: qty,
            valor_unitario: val,
            valor_unitario_desc: valDesc,
            desconto_pagamento: descPagVal,
            desconto_pagamento_prc: descPagPrc,
            desconto_especial: descEspVal,
            desconto_especial_prc: descEspPrc,
            valor_desc: valorDesc,
            desconto_total: valorDesc * qty,
            valor_total: valDesc * qty
          };
        });
        const descontoTotal = descPagTot + descEspTot;
        const total = subtotal - descontoTotal;
        // Num OCRP o select de "cliente" carrega o id da PROSPECÇÃO. Mandá-lo
        // como cliente_id apontaria para o cliente de mesmo número — outra
        // empresa, escolhida por acidente.
        const body = {
          // O que decide é estar EM modo prospecção, não ter um id: no modo de
          // escolha o select carrega o id da prospecção, e mandá-lo como
          // cliente_id apontaria para o cliente de mesmo número.
          cliente_id: prospeccao ? null : clienteVal,
          contato_id: prospeccao ? null : contatoVal,
          prospeccao_id: prospeccao?.id || null,
          prospeccao_contato_id: prospeccao ? (contatoVal || null) : null,
          situacao: status,
          parcelas,
          tipo_parcela: tipoParcela,
          forma_pagamento: formaPagamentoVal,
          // O valor da opção JÁ é o nome — é o nome que o orçamento grava, e
          // o id não sobrevive à gravação. Ler o `textContent` era o mesmo
          // resultado por um caminho mais frágil: bastava um espaço a mais na
          // marcação para gravar um nome com espaço.
          transportadora: prospeccao ? '' : (transportadoraSelect.value || ''),
          desconto_pagamento: descPagTot,
          desconto_especial: descEspTot,
          desconto_total: descontoTotal,
          valor_final: total,
          observacoes: document.getElementById('novoObservacoes').value || '',
          validade: validadeVal,
          prazo,
          dono: donoVal,
          tipo_parcela: tipoParcela,
          itens,
          parcelas_detalhes: parcelasDetalhes
        };
        const resp = await fetchApi('/api/orcamentos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (!resp.ok) throw new Error('Erro ao salvar');
        const result = await resp.json();
        if (window.reloadOrcamentos) await window.reloadOrcamentos();
        // A ficha da prospecção fica ABERTA por baixo: sem repintar, o
        // orçamento recém-criado só apareceria depois de fechar e reabrir.
        if (prospeccao?.id) await window.recarregarDetalhesProspeccao?.();
        delete window.__orcamentoModoProspeccao;
        Modal.close(overlayId);
        const message =
          status === 'Rascunho'
            ? `ORÇAMENTO ${result.numero} SALVO COM SUCESSO!`
            : `ORÇAMENTO ${result.numero} SALVO E ENVIADO COM SUCESSO!`;
        showToast(message, 'success');
        // Avisa quem abriu este formulário que o orçamento entrou. Quem abre
        // daqui (a leitura de IA) não tem como saber sozinho: ela não gravou
        // nada e não fica olhando o banco. Quem não escuta, ignora.
        window.dispatchEvent(new CustomEvent('moduloSalvou', { detail: { overlay: overlayId } }));
      } catch (err) {
        console.error(err);
        showToast('Erro ao salvar orçamento', 'error');
      } finally {
        // Solta também quando deu erro: senão o botão fica em carregando para
        // sempre e a pessoa não consegue nem tentar de novo.
        resolve();
      }
    });   // fim do showActionDialog
    });   // fim da promessa devolvida por saveQuote
  }

  // "Salvar" e "Salvar e Enviar" mandam o MESMO formulário, com status
  // diferente. Os dois ficam fora dele (ligados por `form="novoOrcamentoForm"`),
  // e por isso a trava vive no FORMULÁRIO e não no botão: ela precisa valer
  // para os dois ao mesmo tempo, senão bastava clicar num e depois no outro
  // para mandar o mesmo orçamento duas vezes.
  const submeterNovo = e => saveQuote(e.submitter?.dataset.status || 'Rascunho');
  if (window.BotaoAcao?.bindSubmit) {
    window.BotaoAcao.bindSubmit(form, submeterNovo);
  } else {
    form.addEventListener('submit', e => { e.preventDefault(); submeterNovo(e); });
  }
  /** Solta a marca de modo prospecção: sem isto o próximo "Novo Orçamento"
   *  de cliente abriria com o select de cliente mudo. */
  const fecharLimpando = () => {
    delete window.__orcamentoModoProspeccao;
    close();
  };
  document.getElementById('cancelarNovoOrcamento').addEventListener('click', fecharLimpando);
  document.getElementById('voltarNovoOrcamento').addEventListener('click', fecharLimpando);

  // Anuncia o carregamento, como `orcamento-editar.js` e `orcamento-visualizar.js`
  // já faziam. Este era o único dos três que não avisava — e quem abre o modal
  // esperando o aviso ficava preso na máscara de espera até o tempo limite.
  window.dispatchEvent(new CustomEvent('orcamentoModalLoaded', { detail: overlayId }));

  const limparBtn = document.getElementById('limparNovoOrcamento');
  if (limparBtn) {
    limparBtn.addEventListener('click', () => {
      confirmResetIfNeeded(() => {
        form.reset();
        overlay.querySelectorAll('select').forEach(s => s.setAttribute('data-filled', 'false'));
        itensTbody.innerHTML = '';
        recalcTotals();
      });
    });
  }
})();

