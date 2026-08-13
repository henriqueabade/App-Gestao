/**
 * Modal de detalhes da prospecção.
 *
 * Tudo aqui vem de GET /api/prospeccoes/:id. A versão anterior era um mockup:
 * remontava o registro raspando o `textContent` das células da grade e, para o
 * que não conseguia raspar, exibia um exemplo embutido ("Jennifer Wilson" /
 * "Acme Corporation") por cima de um registro real.
 *
 * Somente LEITURA nesta etapa, fora Editar e Excluir, que reaproveitam os
 * modais existentes. Registrar interação, adicionar nota e converter em cliente
 * são ações com permissão própria e entram junto com as demais ações de CRM.
 */
(async function () {
  const overlay = document.getElementById('detalhesProspeccaoOverlay');
  if (!overlay) return;

  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }

  const close = () => Modal.close('detalhesProspeccao');
  const get = id => document.getElementById(id);

  document.getElementById('voltarDetalhesProspeccao')?.addEventListener('click', close);
  document.addEventListener('keydown', function esc(e) {
    if (e.key !== 'Escape') return;
    close();
    document.removeEventListener('keydown', esc);
  });

  // -------------------------------------------------------------------------
  // Utilidades de desenho
  // -------------------------------------------------------------------------

  /** Escapa antes de ir para innerHTML — tudo aqui é texto digitado por gente. */
  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  const VAZIO = '<span class="text-white/40">—</span>';

  const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const formatarMoeda = v => moeda.format(Number.isFinite(Number(v)) ? Number(v) : 0);

  function formatarData(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
  }

  function formatarDataHora(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  /** "há 3 dias" — mais legível numa timeline que a data absoluta. */
  function tempoRelativo(iso) {
    if (!iso) return '';
    const alvo = new Date(iso).getTime();
    if (Number.isNaN(alvo)) return '';
    const minutos = Math.round((Date.now() - alvo) / 60000);
    if (minutos < 1) return 'agora';
    if (minutos < 60) return `há ${minutos} min`;
    const horas = Math.round(minutos / 60);
    if (horas < 24) return `há ${horas} h`;
    const dias = Math.round(horas / 24);
    if (dias < 30) return `há ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
    const meses = Math.round(dias / 30);
    if (meses < 12) return `há ${meses} ${meses === 1 ? 'mês' : 'meses'}`;
    return formatarData(iso);
  }

  function slugEtapa(etapa) {
    return String(etapa || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z]/g, '');
  }

  const campo = (rotulo, valorHtml) => `
    <div>
      <label class="block text-sm text-gray-400 mb-1">${esc(rotulo)}</label>
      <div class="text-white break-words">${valorHtml || VAZIO}</div>
    </div>`;

  const texto = v => (v === null || v === undefined || String(v).trim() === '' ? null : esc(v));

  function estadoVazio(mensagem) {
    return `<p class="py-8 text-center text-white/50 text-sm">${esc(mensagem)}</p>`;
  }

  /** Ícone por tipo de interação — a timeline fica legível de relance. */
  const ICONE_INTERACAO = {
    'Ligação': '📞', 'E-mail': '📧', 'Reunião': '🤝',
    'WhatsApp': '💬', 'Visita': '🏢', 'Nota': '📝', 'Proposta': '📄'
  };

  // -------------------------------------------------------------------------
  // Abas
  // -------------------------------------------------------------------------
  function setTab(id) {
    overlay.querySelectorAll('[data-panel]').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== id));
    overlay.querySelectorAll('[role="tab"]').forEach(t => {
      const ativo = t.dataset.tab === id;
      t.setAttribute('aria-selected', String(ativo));
      t.classList.toggle('tab-active', ativo);
      t.classList.toggle('text-gray-400', !ativo);
      t.classList.toggle('border-transparent', !ativo);
    });
  }

  overlay.querySelectorAll('[role="tab"]').forEach(t => {
    t.addEventListener('click', () => setTab(t.dataset.tab));
  });

  overlay.addEventListener('keydown', e => {
    if (e.target.getAttribute?.('role') !== 'tab') return;
    const abas = Array.from(overlay.querySelectorAll('[role="tab"]'));
    const atual = abas.indexOf(e.target);
    let alvo;
    if (e.key === 'ArrowRight') alvo = atual < abas.length - 1 ? atual + 1 : 0;
    else if (e.key === 'ArrowLeft') alvo = atual > 0 ? atual - 1 : abas.length - 1;
    else return;
    e.preventDefault();
    abas[alvo].focus();
    setTab(abas[alvo].dataset.tab);
  });

  setTab('visao');

  // -------------------------------------------------------------------------
  // Renderização de cada bloco
  // -------------------------------------------------------------------------

  function renderCabecalho(p) {
    const empresa = p.nome_fantasia || p.razao_social || '(sem nome)';
    get('detProspNome').textContent = empresa;
    get('detProspEmpresa').textContent = empresa;
    get('detProspSegmento').textContent = p.segmento || 'Segmento não informado';
    get('detProspIniciais').textContent = empresa.split(' ').filter(Boolean)
      .map(n => n[0]).join('').slice(0, 2).toUpperCase();

    const partes = [p.razao_social, p.cnpj].filter(Boolean);
    if (p.status === 'arquivada') partes.push('Arquivada');
    get('detProspSubtitulo').textContent = partes.join(' · ');
  }

  function renderMetricas(p) {
    const bloco = (rotulo, conteudo) => `
      <div class="rounded-lg border border-white/10 bg-white/5 backdrop-blur p-3 h-[76px] flex flex-col justify-center overflow-hidden">
        <span class="text-[11px] uppercase tracking-wide text-white/60">${esc(rotulo)}</span>
        <span class="block text-sm text-white truncate">${conteudo}</span>
      </div>`;

    const etapaBadge = `<span class="badge-etapa badge-etapa--${slugEtapa(p.etapa)} px-2.5 py-1 rounded-full text-xs font-medium">${esc(p.etapa)}</span>`;

    // Valor ponderado pela probabilidade: é a previsão realista deste negócio.
    const ponderado = Number(p.valor_estimado || 0) * (Number(p.probabilidade || 0) / 100);

    get('detProspMetricas').innerHTML = [
      bloco('Etapa', `<span class="mt-1 inline-flex">${etapaBadge}</span>`),
      bloco('Valor estimado', esc(formatarMoeda(p.valor_estimado))),
      bloco('Probabilidade', `${Number(p.probabilidade || 0)}% <span class="text-white/50 text-xs">(${esc(formatarMoeda(ponderado))})</span>`),
      bloco('Responsável', texto(p.responsavel) || VAZIO),
      bloco('Origem', texto(p.origem) || VAZIO),
      bloco('Atualizada', esc(formatarDataHora(p.atualizado_em)) || VAZIO)
    ].join('');
  }

  function renderOportunidade(p) {
    let proximoPasso = VAZIO;
    if (p.proximo_passo || p.proximo_passo_data) {
      const data = p.proximo_passo_data ? formatarData(p.proximo_passo_data) : '';
      // Atrasado precisa saltar aos olhos: é a informação acionável da tela.
      const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
      const bruto = String(p.proximo_passo_data || '').slice(0, 10);
      const [a, m, d] = bruto.split('-').map(Number);
      const alvo = a && m && d ? new Date(a, m - 1, d) : null;
      const atrasado = alvo && alvo < hoje;
      proximoPasso = `${texto(p.proximo_passo) || ''}${data
        ? ` <span class="${atrasado ? 'prox-passo-atrasado' : 'text-white/60'}">(${esc(data)}${atrasado ? ' · atrasado' : ''})</span>`
        : ''}`;
    }

    const linhas = [
      campo('Etapa atual', `<span class="badge-etapa badge-etapa--${slugEtapa(p.etapa)} px-3 py-1 rounded-full text-sm font-medium">${esc(p.etapa)}</span>`),
      campo('Origem', texto(p.origem)),
      campo('Valor estimado', esc(formatarMoeda(p.valor_estimado))),
      campo('Probabilidade', `${Number(p.probabilidade || 0)}%`),
      campo('Responsável', texto(p.responsavel)),
      campo('Próximo passo', proximoPasso)
    ];

    if (p.motivo_perda) linhas.push(campo('Motivo da perda', texto(p.motivo_perda)));
    if (p.cliente_id) {
      linhas.push(campo('Convertida em cliente',
        `#${esc(p.cliente_id)}${p.convertida_em ? ` <span class="text-white/60">em ${esc(formatarData(p.convertida_em))}</span>` : ''}`));
    }

    get('detProspOportunidade').innerHTML = linhas.join('');
  }

  function renderEmpresa(p) {
    const site = texto(p.site)
      ? `<a href="${esc(p.site)}" data-external target="_blank" rel="noopener noreferrer" class="text-primary hover:text-primary-light">${esc(p.site)}</a>`
      : null;

    get('detProspEmpresaDados').innerHTML = [
      campo('Razão Social', texto(p.razao_social)),
      campo('Nome Fantasia', texto(p.nome_fantasia)),
      campo('CNPJ', texto(p.cnpj)),
      campo('Inscrição Estadual', texto(p.inscricao_estadual)),
      campo('Segmento', texto(p.segmento)),
      campo('Site', site),
      campo('Cadastrada por', texto(p.criado_por_nome)),
      campo('Cadastrada em', esc(formatarDataHora(p.criado_em)))
    ].join('');
  }

  function renderEndereco(p) {
    const e = p.endereco || {};
    const linha1 = [e.rua, e.numero].filter(Boolean).join(', ');
    const linha2 = [e.complemento, e.bairro].filter(Boolean).join(' - ');
    const linha3 = [[e.cidade, e.estado].filter(Boolean).join('/'), e.cep, e.pais]
      .filter(Boolean).join(' - ');
    const partes = [linha1, linha2, linha3].filter(Boolean);

    get('detProspEndereco').innerHTML = partes.length
      ? partes.map(l => `<p>${esc(l)}</p>`).join('')
      : estadoVazio('Endereço não informado');
  }

  function renderAnotacoes(p) {
    const card = get('detProspAnotacoesCard');
    if (!texto(p.anotacoes)) {
      card.classList.add('hidden');
      return;
    }
    card.classList.remove('hidden');
    // textContent: a anotação é texto livre e não deve virar marcação.
    get('detProspAnotacoes').textContent = p.anotacoes;
  }

  function renderContatos(contatos) {
    const alvo = get('detProspContatos');
    if (!contatos.length) {
      alvo.innerHTML = estadoVazio('Nenhum contato cadastrado nesta empresa');
      return;
    }

    const linhas = contatos.map(c => {
      const papeis = [];
      if (c.principal) papeis.push('<span class="badge-info px-2 py-1 rounded text-xs">Principal</span>');
      if (c.decisor) papeis.push('<span class="badge-success px-2 py-1 rounded text-xs">Decisor</span>');
      const email = texto(c.email)
        ? `<a href="mailto:${esc(c.email)}" class="text-primary hover:text-primary-light">${esc(c.email)}</a>`
        : VAZIO;
      return `
        <tr class="border-b border-white/5">
          <td class="px-4 py-3 text-sm text-white">${esc(c.nome)}</td>
          <td class="px-4 py-3 text-sm text-white/80">${texto(c.cargo) || VAZIO}</td>
          <td class="px-4 py-3 text-sm">${email}</td>
          <td class="px-4 py-3 text-sm text-white/80">${texto(c.telefone_celular) || VAZIO}</td>
          <td class="px-4 py-3 text-sm text-white/80">${texto(c.telefone_fixo) || VAZIO}</td>
          <td class="px-4 py-3 text-sm">${papeis.join(' ') || VAZIO}</td>
        </tr>`;
    }).join('');

    alvo.innerHTML = `
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b border-white/10">
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Nome</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Cargo</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">E-mail</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Celular</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Tel. fixo</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Papel</th>
            </tr>
          </thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>`;
  }

  function renderInteracoes(interacoes) {
    const alvo = get('detProspInteracoes');
    if (!interacoes.length) {
      alvo.innerHTML = estadoVazio('Nenhuma interação registrada até agora');
      return;
    }

    alvo.innerHTML = interacoes.map(i => {
      const duracao = i.duracao_min ? ` • ${esc(i.duracao_min)} min` : '';
      const autor = texto(i.responsavel) ? ` • ${esc(i.responsavel)}` : '';
      return `
        <div class="timeline-item relative pl-12">
          <div class="timeline-marker absolute left-0 top-1 w-8 h-8 rounded-full flex items-center justify-center">
            ${ICONE_INTERACAO[i.tipo] || '📌'}
          </div>
          <div>
            <h4 class="font-semibold text-white">${esc(i.tipo)}${i.resumo ? ` — ${esc(i.resumo)}` : ''}</h4>
            <p class="text-sm text-gray-400 mb-2">${esc(formatarDataHora(i.data))} <span class="text-white/40">(${esc(tempoRelativo(i.data))})</span>${duracao}${autor}</p>
            ${texto(i.detalhe) ? `<p class="text-gray-300 whitespace-pre-wrap">${esc(i.detalhe)}</p>` : ''}
          </div>
        </div>`;
    }).join('');
  }

  function renderNotas(notas) {
    const alvo = get('detProspNotas');
    if (!notas.length) {
      alvo.innerHTML = estadoVazio('Nenhuma nota registrada');
      return;
    }
    alvo.innerHTML = notas.map(n => `
      <div class="bg-surface/40 rounded-lg p-4 border border-white/5">
        ${texto(n.titulo) ? `<h4 class="font-medium text-white mb-2">${esc(n.titulo)}</h4>` : ''}
        <p class="text-gray-300 text-sm mb-2 whitespace-pre-wrap">${esc(n.conteudo)}</p>
        <p class="text-xs text-gray-500">${texto(n.autor) ? esc(n.autor) + ' • ' : ''}${esc(tempoRelativo(n.criado_em))}</p>
      </div>`).join('');
  }

  function renderAnexos(anexos) {
    const alvo = get('detProspAnexos');
    if (!anexos.length) {
      alvo.innerHTML = estadoVazio('Nenhum anexo');
      return;
    }
    const tamanho = bytes => {
      const n = Number(bytes);
      if (!Number.isFinite(n) || n <= 0) return '';
      if (n < 1024) return `${n} B`;
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
      return `${(n / 1024 / 1024).toFixed(1)} MB`;
    };
    alvo.innerHTML = anexos.map(a => `
      <div class="flex items-center justify-between gap-4 py-3 border-b border-white/5">
        <div class="flex items-center gap-3 min-w-0">
          <i class="fas fa-paperclip text-white/40"></i>
          <span class="text-white truncate">${esc(a.nome_arquivo)}</span>
        </div>
        <span class="text-xs text-white/50 flex-shrink-0">${esc(tamanho(a.tamanho_bytes))} ${esc(formatarData(a.criado_em))}</span>
      </div>`).join('');
  }

  function renderCampanhas(campanhas) {
    const alvo = get('detProspCampanhas');
    if (!campanhas.length) {
      alvo.innerHTML = estadoVazio('Nenhuma campanha registrada');
      return;
    }
    const classeStatus = {
      'Concluída': 'badge-success', 'Em andamento': 'badge-warning',
      'Planejada': 'badge-info', 'Cancelada': 'badge-danger'
    };
    const linhas = campanhas.map(c => `
      <tr class="border-b border-white/5">
        <td class="px-4 py-3 text-sm text-white">${esc(c.nome)}</td>
        <td class="px-4 py-3 text-sm text-white/80">${texto(c.canal) || VAZIO}</td>
        <td class="px-4 py-3 text-sm"><span class="${classeStatus[c.status] || 'badge-neutral'} px-2 py-1 rounded text-xs">${esc(c.status)}</span></td>
        <td class="px-4 py-3 text-sm text-white/80">${esc(formatarData(c.data_envio)) || VAZIO}</td>
        <td class="px-4 py-3 text-sm text-white/80">${texto(c.resposta) || VAZIO}</td>
      </tr>`).join('');

    alvo.innerHTML = `
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b border-white/10">
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Campanha</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Canal</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Status</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Envio</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Resposta</th>
            </tr>
          </thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>`;
  }

  function renderOrcamentos(orcamentos) {
    const alvo = get('detProspOrcamentos');
    if (!orcamentos.length) {
      alvo.innerHTML = estadoVazio('Nenhum orçamento emitido para esta prospecção');
      return;
    }
    alvo.innerHTML = `
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b border-white/10">
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Número</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Situação</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Valor</th>
            </tr>
          </thead>
          <tbody>
            ${orcamentos.map(o => `
              <tr class="border-b border-white/5">
                <td class="px-4 py-3 text-sm text-white">${esc(o.numero)}</td>
                <td class="px-4 py-3 text-sm text-white/80">${texto(o.situacao) || VAZIO}</td>
                <td class="px-4 py-3 text-sm text-white">${esc(formatarMoeda(o.valor_final))}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function renderHistorico(historico) {
    const alvo = get('detProspHistorico');
    if (!historico.length) {
      alvo.innerHTML = estadoVazio('Nenhuma movimentação registrada');
      return;
    }
    const linhas = historico.map(h => `
      <tr class="border-b border-white/5">
        <td data-perm-col="col_hist_data" class="px-4 py-3 text-sm text-white/80 whitespace-nowrap">${esc(formatarDataHora(h.criado_em))}</td>
        <td data-perm-col="col_hist_tipo" class="px-4 py-3 text-sm">
          ${h.etapa_anterior ? `<span class="text-white/50">${esc(h.etapa_anterior)}</span> <span class="text-white/30">→</span> ` : ''}
          <span class="badge-etapa badge-etapa--${slugEtapa(h.etapa_nova)} px-2 py-1 rounded text-xs">${esc(h.etapa_nova)}</span>
        </td>
        <td data-perm-col="col_hist_resumo" class="px-4 py-3 text-sm text-white/80">${texto(h.observacao) || VAZIO}</td>
        <td data-perm-col="col_hist_resp" class="px-4 py-3 text-sm text-white/80">${texto(h.responsavel) || VAZIO}</td>
      </tr>`).join('');

    alvo.innerHTML = `
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b border-white/10">
              <th data-perm-col="col_hist_data" class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Data</th>
              <th data-perm-col="col_hist_tipo" class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Movimentação</th>
              <th data-perm-col="col_hist_resumo" class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Observação</th>
              <th data-perm-col="col_hist_resp" class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Responsável</th>
            </tr>
          </thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>`;
  }

  function atualizarContadores(dados) {
    const contagens = {
      contatos: dados.contatos.length,
      interacoes: dados.interacoes.length,
      notas: dados.notas.length,
      campanhas: dados.campanhas.length,
      historico: dados.historico.length
    };
    overlay.querySelectorAll('[data-contador]').forEach(el => {
      const n = contagens[el.dataset.contador];
      el.textContent = n ? `(${n})` : '';
    });
  }

  // -------------------------------------------------------------------------
  // Carregamento
  // -------------------------------------------------------------------------
  const resumo = window.prospeccaoDetalhes;

  // Sem devolver o contexto, o modal reabre vazio após uma queda.
  window.EstadoTrabalho?.registrarContexto?.('detalhesProspeccao',
    () => ({ prospeccaoDetalhes: resumo }));

  if (!resumo?.id) {
    showToast('Prospecção não encontrada', 'error');
    window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'detalhesProspeccao' }));
    return;
  }

  // Pinta o que já se sabe pela grade, para o modal nunca aparecer em branco
  // caso a requisição demore.
  renderCabecalho(resumo);

  try {
    const resp = await fetchApi(`/api/prospeccoes/${resumo.id}`);
    if (resp.status === 403) throw new Error('Você não tem permissão para ver os detalhes desta prospecção.');
    if (!resp.ok) {
      const corpo = await resp.json().catch(() => ({}));
      throw new Error(corpo.error || `Erro ${resp.status}`);
    }

    const dados = await resp.json();
    const p = dados.prospeccao || {};
    const listas = {
      contatos: dados.contatos || [],
      interacoes: dados.interacoes || [],
      notas: dados.notas || [],
      campanhas: dados.campanhas || [],
      historico: dados.historico || [],
      anexos: dados.anexos || [],
      orcamentos: dados.orcamentos || []
    };

    renderCabecalho(p);
    renderMetricas(p);
    renderOportunidade(p);
    renderEmpresa(p);
    renderEndereco(p);
    renderAnotacoes(p);
    renderContatos(listas.contatos);
    renderInteracoes(listas.interacoes);
    renderNotas(listas.notas);
    renderAnexos(listas.anexos);
    renderCampanhas(listas.campanhas);
    renderOrcamentos(listas.orcamentos);
    renderHistorico(listas.historico);
    atualizarContadores(listas);

    // Guarda a ficha completa para os botões de ação — a grade só tem o resumo.
    window.prospeccaoDetalhesCarregada = p;

    // Links externos abrem no navegador do sistema, não dentro do Electron.
    overlay.querySelectorAll('a[data-external]').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        window.electronAPI?.openExternal?.(a.href);
      });
    });

    // As colunas do histórico respeitam col_hist_*; foram desenhadas agora.
    window.Permissoes?.aplicarAcoesEColunas?.(overlay);
  } catch (err) {
    console.error('Erro ao carregar detalhes da prospecção', err);
    showToast(err.message || 'Erro ao carregar detalhes', 'error');
  } finally {
    window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'detalhesProspeccao' }));
  }

  // -------------------------------------------------------------------------
  // Ações
  // -------------------------------------------------------------------------
  document.getElementById('detProspEditar')?.addEventListener('click', () => {
    close();
    // Passa a ficha completa quando já carregou; o modal de edição recarrega
    // de qualquer forma, mas assim o título aparece na hora.
    if (typeof abrirEditarProspeccao === 'function') {
      abrirEditarProspeccao(window.prospeccaoDetalhesCarregada || resumo);
    }
  });

  document.getElementById('detProspExcluir')?.addEventListener('click', () => {
    close();
    if (typeof abrirExcluirProspeccao === 'function') {
      abrirExcluirProspeccao(window.prospeccaoDetalhesCarregada || resumo);
    }
  });
})();
