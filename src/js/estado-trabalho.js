// ---------------------------------------------------------------------------
// Preservação do trabalho em andamento (janela de 30 min).
//
// Ao ser DESCONECTADO — queda de internet/servidor/banco ou corte pelo
// administrador — guardamos onde o usuário estava e o que já havia preenchido.
// Ao voltar, restauramos; mas só para ELE e só dentro de 30 minutos.
//
// Quem decide "posso restaurar?" é `src/js/utils/restauracao.js`, usado também
// pela janela de login. Antes cada lado tinha a própria versão da regra e o
// trabalho voltava onde não devia: sair pelo menu gravava estado como se fosse
// queda, e um estado sem dono identificado era reposto para qualquer um que
// logasse depois na mesma máquina.
//
// Só existe UM caminho para gravar: `EstadoTrabalho.salvarPorDesconexao(motivo)`.
// Qualquer outro fim de sessão deve chamar `descartarTrabalhoGuardado()`.
// ---------------------------------------------------------------------------
(function () {
    const CHAVE_ESTADO = 'savedState';
    const CAMPOS = 'input, select, textarea';

    /** Identificador estável de um campo dentro do seu container. */
    function chaveDoCampo(el) {
        if (el.id) return `#${el.id}`;
        if (el.name) return `[name="${el.name}"]`;
        return null;
    }

    function ehCampoIgnorado(el) {
        if (!el || el.disabled) return true;
        const tipo = (el.type || '').toLowerCase();
        // nunca guardamos senha nem arquivo
        if (tipo === 'password' || tipo === 'file') return true;
        if (el.dataset?.noRestore === 'true') return true;
        return false;
    }

    function lerValor(el) {
        const tipo = (el.type || '').toLowerCase();
        if (tipo === 'checkbox' || tipo === 'radio') return el.checked;
        return el.value;
    }

    function aplicarValor(el, valor) {
        const tipo = (el.type || '').toLowerCase();
        if (tipo === 'checkbox' || tipo === 'radio') {
            el.checked = Boolean(valor);
        } else {
            el.value = valor ?? '';
        }
        // avisa listeners (máscaras, cálculos, validações)
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    /** Coleta os campos preenchidos de uma raiz. */
    function coletarCampos(raiz) {
        if (!raiz) return [];
        const out = [];
        raiz.querySelectorAll(CAMPOS).forEach(el => {
            if (ehCampoIgnorado(el)) return;
            const chave = chaveDoCampo(el);
            if (!chave) return;
            const valor = lerValor(el);
            const vazio = valor === '' || valor === null || valor === undefined || valor === false;
            if (vazio) return;                     // só guardamos o que foi preenchido
            out.push({ chave, valor });
        });
        return out;
    }

    // ------------------------------------------------------------------
    // Registro de modais abertos (PILHA) e do conteúdo dinâmico deles.
    //
    // Dois problemas motivam este registro:
    //  1. Modais empilhados: guardávamos só o primeiro overlay visível, então
    //     "Registrar itens no processo" aberto sobre "Novo Produto" perdia um
    //     dos dois.
    //  2. Itens adicionados: cada modal guarda a própria lista numa variável
    //     interna (ex.: `let itens = []` dentro do IIFE). Nenhuma varredura de
    //     DOM consegue repovoar isso — o modal precisa dizer como salvar e como
    //     repor. Por isso existe `registrarConteudo`.
    // ------------------------------------------------------------------
    const aberturas = new Map();    // overlayId -> { htmlPath, scriptPath, overlayId }
    const ordemAbertura = [];       // overlayId na ordem em que foram abertos
    const conteudos = new Map();    // overlayId -> { capturar, restaurar }

    function idDoOverlay(info) {
        if (!info) return null;
        const bruto = String(info.overlayId || '');
        return bruto.endsWith('Overlay') ? bruto : `${bruto}Overlay`;
    }

    window.__registrarModalAberto = function (info) {
        const id = idDoOverlay(info);
        if (!id) return;
        aberturas.set(id, { ...info, overlayId: info.overlayId });
        const jaTinha = ordemAbertura.indexOf(id);
        if (jaTinha >= 0) ordemAbertura.splice(jaTinha, 1);
        ordemAbertura.push(id);
    };

    /**
     * Um modal declara como salvar e repor o próprio conteúdo dinâmico.
     * Chame ao abrir o modal:
     *   window.EstadoTrabalho.registrarConteudo('proximaEtapa', {
     *     capturar: () => ({ itens }),
     *     restaurar: (dados) => { itens = dados.itens || []; render(); }
     *   });
     */
    function registrarConteudo(overlayId, manipuladores) {
        const id = idDoOverlay({ overlayId });
        if (!id || !manipuladores) return;
        conteudos.set(id, manipuladores);
    }

    /**
     * Atalho para o caso mais comum: o modal não tem estado próprio a repor,
     * mas precisa saber O QUE abrir. É a situação de todo modal de detalhes,
     * visualização e confirmação de exclusão — eles leem um global
     * (`window.produtoExcluir`, `window.materiaSelecionada`...) definido pela
     * tela que os abriu. Sem isso reabrem em branco ou com o botão sem efeito.
     *
     *   window.EstadoTrabalho?.registrarContexto?.('excluirProduto',
     *     () => ({ produtoExcluir: item }));
     *
     * Recebe uma FUNÇÃO porque o global pode mudar enquanto o modal está aberto.
     */
    function registrarContexto(overlayId, obterContexto) {
        if (typeof obterContexto !== 'function') return;
        registrarConteudo(overlayId, {
            capturar: () => ({ __contexto: obterContexto() }),
            restaurar: () => {}
        });
    }

    function esquecerConteudo(overlayId) {
        const id = idDoOverlay({ overlayId });
        if (id) conteudos.delete(id);
    }

    /** Todos os overlays visíveis, na ordem em que foram abertos. */
    function modaisAbertos() {
        const visiveis = Array.from(document.querySelectorAll('[id$="Overlay"]'))
            .filter(o => o && !o.classList.contains('hidden'));
        if (!visiveis.length) return [];

        const porOrdem = (a, b) => {
            const ia = ordemAbertura.indexOf(a.id);
            const ib = ordemAbertura.indexOf(b.id);
            return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
        };

        return visiveis.sort(porOrdem).map(overlay => {
            let conteudo = null;
            const manipuladores = conteudos.get(overlay.id);
            if (manipuladores && typeof manipuladores.capturar === 'function') {
                try {
                    conteudo = manipuladores.capturar();
                } catch (err) {
                    console.error(`[estado] falha ao capturar o conteúdo de ${overlay.id}:`, err);
                }
            }
            return {
                overlayId: overlay.id,
                abertura: aberturas.get(overlay.id) || null,
                campos: coletarCampos(overlay),
                conteudo
            };
        });
    }

    /**
     * Formato esperado pelo loginRenderer: { sectionId, storage, ... }
     *
     * `motivo` e `usuarioId` são o que permite decidir, na volta, SE e PARA QUEM
     * restaurar. Sem esse carimbo o estado é descartado — inclusive os gravados
     * por versões antigas, que salvavam também em saída voluntária.
     */
    window.collectState = function collectState(motivo) {
        const usuarioBruto = localStorage.getItem('user') || null;
        try {
            const content = document.getElementById('content');
            const sectionId = content?.dataset?.activePage || 'dashboard';
            const modais = modaisAbertos();
            return {
                sectionId,
                motivo: motivo || null,
                usuarioId: window.RestauracaoTrabalho?.idDoUsuario(usuarioBruto) ?? null,
                salvoEm: Date.now(),
                storage: { user: usuarioBruto },
                campos: coletarCampos(content),
                modais,
                // compatibilidade com estados salvos antes da pilha existir
                modal: modais[0] || null
            };
        } catch (err) {
            console.error('[estado] falha ao coletar o estado atual:', err);
            return {
                sectionId: 'dashboard',
                motivo: motivo || null,
                usuarioId: window.RestauracaoTrabalho?.idDoUsuario(usuarioBruto) ?? null,
                salvoEm: Date.now(),
                storage: { user: usuarioBruto }
            };
        }
    };

    /** Vira `true` assim que uma queda guarda o trabalho nesta sessão. */
    let jaGravouNestaSessao = false;

    /**
     * ÚNICO caminho para gravar o trabalho em andamento. Só grava quando o fim
     * da sessão foi uma desconexão de verdade; qualquer outro motivo (saída pelo
     * menu, inatividade, fechar o app) apaga o que houver, para não ressuscitar
     * um trabalho antigo no próximo login.
     */
    async function salvarPorDesconexao(motivo) {
        const restauravel = window.RestauracaoTrabalho?.MOTIVOS_RESTAURAVEIS?.has(String(motivo || ''));
        if (!restauravel) {
            // O monitor pode disparar mais de uma vez com motivos diferentes
            // (ex.: 'offline' e, logo depois, 'user-removed'). Se já guardamos o
            // trabalho nesta sessão, um motivo posterior não pode apagá-lo.
            if (jaGravouNestaSessao) {
                console.info(`[estado] "${motivo}" ignorado: o trabalho já foi guardado por uma queda.`);
                return false;
            }
            console.info(`[estado] "${motivo}" não é desconexão: nada é guardado.`);
            await descartarTrabalhoGuardado();
            return false;
        }

        let estado = null;
        try {
            estado = window.collectState(motivo);
        } catch (err) {
            console.error('[estado] falha ao coletar o trabalho em andamento:', err);
            return false;
        }

        if (!estado || !window.electronAPI?.saveState) return false;

        try {
            // Aguardado de propósito: logo depois a janela é fechada, e um
            // invoke solto podia morrer junto sem gravar o arquivo.
            await window.electronAPI.saveState(estado);
            jaGravouNestaSessao = true;
            console.info(`[estado] trabalho guardado (motivo: ${motivo}, módulo: ${estado.sectionId}).`);
            return true;
        } catch (err) {
            console.error('[estado] falha ao salvar o trabalho em andamento:', err);
            return false;
        }
    }

    /**
     * Apaga o trabalho guardado (disco + repasse entre janelas), mas SÓ o que
     * pertence a quem está saindo. Se o arquivo é de outra pessoa que caiu, ele
     * fica onde está: ela ainda pode logar dentro dos 30 minutos. Sem essa
     * ressalva, bastava alguém entrar e sair na mesma máquina para destruir o
     * trabalho de quem tinha sido desconectado.
     */
    async function descartarTrabalhoGuardado() {
        // Lê o dono AGORA, de forma síncrona: quem chama costuma limpar o
        // localStorage logo em seguida e, depois do primeiro `await`, já não dá
        // para saber quem estava logado.
        const atualBruto = usuarioAtualBruto();
        try { localStorage.removeItem(CHAVE_ESTADO); } catch (_) { /* ignora */ }

        let guardado = null;
        try {
            guardado = await window.electronAPI?.loadState?.();
        } catch (err) {
            console.error('[estado] falha ao ler o trabalho guardado:', err);
        }
        if (!guardado) return;

        const regra = window.RestauracaoTrabalho;
        const dono = regra ? regra.donoDoEstado(guardado) : null;
        const eu = regra ? regra.idDoUsuario(atualBruto) : null;
        if (dono !== null && eu !== null && dono !== eu) {
            console.info('[estado] trabalho guardado é de outro usuário; preservado.');
            return;
        }

        try { await window.electronAPI?.clearState?.(); } catch (_) { /* ignora */ }
    }

    /**
     * Repõe o valor de um `<select>` que é preenchido por `fetch`.
     *
     * Atribuir `select.value` antes de as `<option>` chegarem não faz nada — o
     * navegador descarta silenciosamente um valor que não existe na lista. Como
     * quase todo modal popula os selects de forma assíncrona, restaurar "na
     * hora" perdia cliente, contato, transportadora e afins sem nenhum aviso.
     * Aqui esperamos a opção aparecer antes de aplicar.
     *
     * @returns {Promise<boolean>} se o valor foi realmente aplicado.
     */
    async function reporSelect(select, valor, limiteMs = 10000) {
        if (!select) return false;
        const alvo = valor === null || valor === undefined ? '' : String(valor);
        if (alvo === '') return false;

        const inicio = Date.now();
        const temOpcao = () => Array.from(select.options || []).some(o => o.value === alvo);

        while (!temOpcao() && Date.now() - inicio < limiteMs) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (!temOpcao()) {
            console.warn(`[estado] opção "${alvo}" não apareceu em ${select.id || 'select'}.`);
            return false;
        }

        select.value = alvo;
        select.setAttribute('data-filled', alvo !== '' ? 'true' : 'false');
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }

    /** Reaplica os campos guardados em uma raiz. */
    function restaurarCampos(raiz, campos) {
        if (!raiz || !Array.isArray(campos)) return 0;
        let aplicados = 0;
        campos.forEach(({ chave, valor }) => {
            let el = null;
            try { el = raiz.querySelector(chave); } catch (_) { el = null; }
            if (!el || ehCampoIgnorado(el)) return;
            aplicarValor(el, valor);
            aplicados++;
        });
        return aplicados;
    }

    /** Usuário logado agora nesta janela (bruto, como veio do localStorage). */
    function usuarioAtualBruto() {
        try {
            return localStorage.getItem('user');
        } catch (_) {
            return null;
        }
    }

    /**
     * Quanto tempo esperamos o login terminar de gravar o usuário. Só custa
     * alguma coisa quando existe trabalho guardado E o usuário não aparece —
     * no caminho normal a primeira leitura já resolve.
     */
    const ESPERA_USUARIO_MS = 5000;

    /**
     * Espera o usuário logado aparecer.
     *
     * A janela do dashboard é criada pela de login e chega no `load` — onde a
     * restauração dispara — podendo ser ANTES de o `localStorage.user` estar
     * gravado. Nesse instante não dá para saber de quem é o trabalho guardado.
     * Desistir aí matava a restauração inteira, em silêncio; e a versão antiga
     * "resolvia" isso restaurando para qualquer um, que era justamente o defeito
     * de trabalho aparecendo para o usuário errado. Esperar é o único caminho
     * que atende às duas coisas.
     */
    async function aguardarUsuarioAtual(limiteMs = ESPERA_USUARIO_MS) {
        const regra = window.RestauracaoTrabalho;
        const inicio = Date.now();
        let bruto = usuarioAtualBruto();

        while (!regra?.idDoUsuario(bruto) && Date.now() - inicio < limiteMs) {
            await new Promise(resolve => setTimeout(resolve, 100));
            bruto = usuarioAtualBruto();
        }

        if (!regra?.idDoUsuario(bruto)) {
            console.warn(`[estado] usuário logado não apareceu em ${limiteMs}ms.`);
        }
        return bruto;
    }

    /**
     * Lê o trabalho guardado e decide se ele pode voltar.
     *
     * A leitura tem duas fontes: o repasse `disco -> localStorage` feito pela
     * janela de login e, como plano B, o disco direto — o salto entre janelas
     * tinha várias condições para dar certo e, quando alguma falhava, o estado
     * sumia em silêncio.
     *
     * O ponto delicado é QUANDO apagar. O arquivo só é consumido quando de fato
     * é reposto (ou quando expirou / não era restaurável). Se ele pertence a
     * OUTRO usuário, fica onde está: quem caiu ainda pode logar dentro dos 30
     * minutos e encontrar o trabalho dele. Antes o arquivo era apagado antes
     * mesmo de conferir o dono, então bastava outra pessoa logar na máquina para
     * destruir o trabalho de quem tinha caído.
     */
    async function lerEstadoSalvo() {
        let estado = null;

        try {
            const bruto = localStorage.getItem(CHAVE_ESTADO);
            if (bruto) estado = JSON.parse(bruto);
        } catch (err) {
            console.error('[estado] savedState ilegível:', err);
        }
        // O repasse entre janelas é sempre de uso único: já foi lido aqui.
        try { localStorage.removeItem(CHAVE_ESTADO); } catch (_) { /* ignora */ }

        if (!estado && window.electronAPI?.loadState) {
            try {
                estado = await window.electronAPI.loadState();
            } catch (err) {
                console.error('[estado] falha ao ler o estado do disco:', err);
            }
        }

        if (!estado) {
            console.info('[estado] nenhum trabalho guardado para restaurar.');
            return null;
        }

        console.info('[estado] trabalho encontrado:', {
            motivo: estado.motivo,
            modulo: estado.sectionId,
            dono: estado.usuarioId,
            modais: (estado.modais || []).map(m => m.overlayId)
        });

        const regra = window.RestauracaoTrabalho;
        if (!regra) {
            console.error('[estado] regra de restauração indisponível; nada é reposto.');
            return null;
        }

        // Só esperamos pelo usuário quando existe algo para restaurar.
        const veredito = regra.podeRestaurar(estado, await aguardarUsuarioAtual());
        if (!veredito.ok) {
            const mensagens = {
                'saida-normal': 'a sessão anterior não terminou por desconexão',
                'expirado': 'o trabalho guardado passou dos 30 minutos',
                'sem-dono': 'não dá para saber de quem é o trabalho guardado',
                'sem-usuario-atual': 'não dá para identificar quem está logando agora',
                'outro-usuario': 'o trabalho guardado é de outro usuário'
            };
            console.info(`[estado] nada restaurado: ${mensagens[veredito.causa] || veredito.causa}.`);

            // O arquivo só é destruído quando virou lixo de verdade. Nos dois
            // casos abaixo ele ainda pode servir a alguém e FICA:
            //  - 'outro-usuario': o dono pode logar dentro dos 30 min;
            //  - 'sem-usuario-atual': não sabemos de quem é a vez — apagar aqui
            //    perderia o trabalho por uma questão de tempo.
            const preservar = veredito.causa === 'outro-usuario'
                || veredito.causa === 'sem-usuario-atual';
            if (!preservar) {
                try { await window.electronAPI?.clearState?.(); } catch (_) { /* ignora */ }
            }
            return null;
        }

        // Vai ser reposto agora: consome o arquivo.
        try { await window.electronAPI?.clearState?.(); } catch (_) { /* ignora */ }
        return estado;
    }

    /**
     * Restaura o trabalho interrompido: volta para o módulo, repõe os campos e
     * reabre os modais que estavam abertos — na mesma ordem, com os itens.
     */
    window.restaurarTrabalhoInterrompido = async function restaurarTrabalhoInterrompido(irParaPagina) {
        const estado = await lerEstadoSalvo();
        if (!estado) return false;

        try {
            if (estado.sectionId && typeof irParaPagina === 'function') {
                await irParaPagina(estado.sectionId);
            }

            const content = document.getElementById('content');
            const aplicados = restaurarCampos(content, estado.campos);

            // aceita tanto o formato novo (pilha) quanto o antigo (um modal só)
            const modais = Array.isArray(estado.modais) && estado.modais.length
                ? estado.modais
                : (estado.modal ? [estado.modal] : []);

            for (let i = 0; i < modais.length; i += 1) {
                // do segundo em diante preservamos o que já está aberto,
                // senão a reabertura do modal de cima fecharia o de baixo
                await reabrirERestaurar(modais[i], i > 0);
            }

            if (aplicados > 0 || modais.length) {
                if (typeof window.showToast === 'function') {
                    window.showToast('Restauramos o que você estava preenchendo antes da desconexão.', 'info');
                }
            }
            return true;
        } catch (err) {
            console.error('[estado] falha ao restaurar o trabalho:', err);
            return false;
        }
    };

    /**
     * Reabre um modal e repõe campos + conteúdo dinâmico.
     * Aguarda de verdade antes de passar para o próximo: modais empilhados
     * precisam ser reabertos em sequência, senão o de cima abriria antes do de
     * baixo existir e a pilha sairia trocada.
     */
    async function reabrirERestaurar(modal, manterAbertos = false) {
        if (!modal || !modal.overlayId) return;

        // Modais de EDIÇÃO leem um global para saber o que abrir
        // (`window.selectedQuoteId`, `window.pedidoSelecionado`...). Quem define
        // esse global é a tela que abriu o modal, e na restauração ela não passa
        // por ali — o modal reabria vazio ou com erro. Por isso o modal pode
        // gravar um `__contexto` serializável no que captura, e nós o
        // devolvemos ao `window` ANTES de o script do modal rodar.
        const contexto = modal.conteudo?.__contexto;
        if (contexto && typeof contexto === 'object') {
            for (const [chave, valor] of Object.entries(contexto)) {
                try {
                    window[chave] = valor;
                } catch (err) {
                    console.error(`[estado] não foi possível repor o contexto "${chave}":`, err);
                }
            }
        }

        const ab = modal.abertura;

        // Mesmo listener que o `openModalWithSpinner` instala: os modais que
        // avisam quando terminaram de carregar aparecem na hora, sem depender
        // do desbloqueio por tempo do `aguardarModal`.
        const revelarAoCarregar = evento => {
            if (evento?.detail !== ab?.overlayId) return;
            document.getElementById(modal.overlayId)?.classList.remove('hidden');
            document.getElementById('modalLoading')?.remove();
        };
        window.addEventListener('modalSpinnerLoaded', revelarAoCarregar);
        window.addEventListener('orcamentoModalLoaded', revelarAoCarregar);

        if (ab && ab.htmlPath && window.Modal?.open) {
            try {
                await window.Modal.open(ab.htmlPath, ab.scriptPath, ab.overlayId, manterAbertos);
            } catch (err) {
                console.error('[estado] falha ao reabrir o modal:', err);
            }
        } else if (ab && typeof window.openModalWithSpinner === 'function') {
            try {
                window.openModalWithSpinner(ab.htmlPath, ab.scriptPath, ab.overlayId);
            } catch (err) {
                console.error('[estado] falha ao reabrir o modal:', err);
            }
        }

        const overlay = await aguardarModal(modal.overlayId);
        window.removeEventListener('modalSpinnerLoaded', revelarAoCarregar);
        window.removeEventListener('orcamentoModalLoaded', revelarAoCarregar);
        if (!overlay) {
            console.warn('[estado] o modal ' + modal.overlayId + ' nao reapareceu; conteudo nao restaurado.');
            return;
        }

        // pequeno respiro: o script do modal ainda pode estar populando selects
        await new Promise(r => setTimeout(r, 250));
        restaurarCampos(overlay, modal.campos);

        // itens/linhas que o modal guarda em estado interno
        if (modal.conteudo) {
            // O modal só declara `restaurar` depois de montar a própria tela, e
            // vários fazem `await` (buscar pedidos, produtos...) antes disso.
            // Sem esperar, caíamos no aviso de "não registrou restaurar" e o
            // conteúdo não voltava — justamente nos modais mais pesados.
            const manipuladores = await aguardarRegistro(modal.overlayId);
            if (manipuladores && typeof manipuladores.restaurar === 'function') {
                try {
                    await manipuladores.restaurar(modal.conteudo);
                } catch (err) {
                    console.error('[estado] falha ao repor o conteudo de ' + modal.overlayId + ':', err);
                }
            } else {
                console.warn('[estado] ' + modal.overlayId + ' nao registrou "restaurar": os itens nao voltaram.');
            }
        }
    }

    /**
     * Espera o modal declarar `registrarConteudo`. Resolve com os manipuladores
     * ou `undefined` se ele não registrar nada dentro do limite.
     */
    async function aguardarRegistro(overlayId, limiteMs = 15000) {
        const inicio = Date.now();
        while (!conteudos.has(overlayId) && Date.now() - inicio < limiteMs) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return conteudos.get(overlayId);
    }

    /**
     * Espera o modal reaparecer (até 20s). Resolve com o overlay ou null.
     *
     * Vários overlays nascem com a classe `hidden` no HTML e só são revelados
     * pelo `openModalWithSpinner`, que escuta `modalSpinnerLoaded`. Na
     * restauração quem reabre é o `Modal.open` direto, sem esse listener — o
     * modal existia mas ficava invisível para sempre e a restauração desistia.
     * Era exatamente por isso que "Novo Produto" voltava e "Editar Produto"
     * não: o primeiro já nasce visível, o segundo não.
     *
     * Aqui revelamos por conta própria assim que o overlay tem conteúdo.
     */
    function aguardarModal(overlayId, revelarAposMs = 800) {
        return new Promise(resolve => {
            const limite = Date.now() + 20000;
            let vistoEm = null;
            const timer = setInterval(() => {
                const overlay = document.getElementById(overlayId);
                if (overlay) {
                    if (vistoEm === null) vistoEm = Date.now();
                    const temCampos = Boolean(overlay.querySelector(CAMPOS));
                    if (
                        overlay.classList.contains('hidden')
                        && temCampos
                        && Date.now() - vistoEm >= revelarAposMs
                    ) {
                        overlay.classList.remove('hidden');
                        overlay.removeAttribute('aria-hidden');
                        document.getElementById('modalLoading')?.remove();
                    }
                    if (!overlay.classList.contains('hidden') && temCampos) {
                        clearInterval(timer);
                        resolve(overlay);
                        return;
                    }
                }
                if (Date.now() > limite) {
                    clearInterval(timer);
                    resolve(null);
                }
            }, 100);
        });
    }

    window.EstadoTrabalho = {
        registrarConteudo,
        registrarContexto,
        esquecerConteudo,
        registrarModalAberto: window.__registrarModalAberto,
        salvarPorDesconexao,
        descartarTrabalhoGuardado,
        reporSelect
    };
})();
