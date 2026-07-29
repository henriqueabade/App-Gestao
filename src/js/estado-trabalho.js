// ---------------------------------------------------------------------------
// Preservação do trabalho em andamento (janela de 30 min).
//
// Ao perder a conexão / ser desconectado, guardamos onde o usuário estava e o
// que já havia preenchido. Ao voltar (login dentro de 30 min), restauramos.
//
// Antes, `window.collectState` era CHAMADO em três lugares mas nunca definido:
// as chamadas ficavam protegidas por `if (window.collectState && ...)` e, na
// prática, nada era salvo — a mensagem prometia algo que não acontecia.
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
     */
    window.collectState = function collectState() {
        try {
            const content = document.getElementById('content');
            const sectionId = content?.dataset?.activePage || 'dashboard';
            const modais = modaisAbertos();
            return {
                sectionId,
                salvoEm: Date.now(),
                storage: { user: localStorage.getItem('user') || null },
                campos: coletarCampos(content),
                modais,
                // compatibilidade com estados salvos antes da pilha existir
                modal: modais[0] || null
            };
        } catch (err) {
            console.error('[estado] falha ao coletar o estado atual:', err);
            return { sectionId: 'dashboard', storage: {} };
        }
    };

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

    const JANELA_MS = 30 * 60 * 1000;

    /** Id do usuário logado agora nesta janela. */
    function usuarioAtualId() {
        try {
            const bruto = localStorage.getItem('user');
            return bruto ? (JSON.parse(bruto)?.id ?? null) : null;
        } catch (_) {
            return null;
        }
    }

    /** Id do dono do trabalho guardado. */
    function donoDoEstado(estado) {
        try {
            const bruto = estado?.storage?.user;
            return bruto ? (JSON.parse(bruto)?.id ?? null) : null;
        } catch (_) {
            return null;
        }
    }

    /**
     * Lê o trabalho guardado.
     *
     * Antes dependia SÓ do repasse `disco -> localStorage` feito pela janela de
     * login. Esse salto entre janelas tinha várias condições para dar certo
     * (usuário ainda em localStorage, `savedState` ausente, ordem de execução)
     * e, quando qualquer uma falhava, o estado era descartado em silêncio e
     * nada voltava. Agora, se o repasse não trouxe nada, lemos direto do disco.
     */
    async function lerEstadoSalvo() {
        let estado = null;

        try {
            const bruto = localStorage.getItem(CHAVE_ESTADO);
            if (bruto) estado = JSON.parse(bruto);
        } catch (err) {
            console.error('[estado] savedState ilegível:', err);
        }
        localStorage.removeItem(CHAVE_ESTADO);   // uso único, sempre

        if (!estado && window.electronAPI?.loadState) {
            try {
                estado = await window.electronAPI.loadState();
            } catch (err) {
                console.error('[estado] falha ao ler o estado do disco:', err);
            }
        }

        // o arquivo é de uso único, tenha sido aproveitado ou não
        try { await window.electronAPI?.clearState?.(); } catch (_) { /* ignora */ }

        if (!estado) return null;

        if (estado.salvoEm && Date.now() - estado.salvoEm > JANELA_MS) {
            console.info('[estado] trabalho guardado expirou (mais de 30 min).');
            return null;
        }

        // Só restauramos o trabalho de QUEM está logado agora.
        const dono = donoDoEstado(estado);
        const atual = usuarioAtualId();
        if (dono !== null && atual !== null && String(dono) !== String(atual)) {
            console.info('[estado] trabalho guardado pertence a outro usuário; descartado.');
            return null;
        }

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

        const ab = modal.abertura;
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
        if (!overlay) {
            console.warn('[estado] o modal ' + modal.overlayId + ' nao reapareceu; conteudo nao restaurado.');
            return;
        }

        // pequeno respiro: o script do modal ainda pode estar populando selects
        await new Promise(r => setTimeout(r, 250));
        restaurarCampos(overlay, modal.campos);

        // itens/linhas que o modal guarda em estado interno
        if (modal.conteudo) {
            const manipuladores = conteudos.get(modal.overlayId);
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

    /** Espera o modal reaparecer (até 20s). Resolve com o overlay ou null. */
    function aguardarModal(overlayId) {
        return new Promise(resolve => {
            const limite = Date.now() + 20000;
            const timer = setInterval(() => {
                const overlay = document.getElementById(overlayId);
                const pronto = overlay && !overlay.classList.contains('hidden')
                    && overlay.querySelector(CAMPOS);
                if (pronto) {
                    clearInterval(timer);
                    resolve(overlay);
                } else if (Date.now() > limite) {
                    clearInterval(timer);
                    resolve(null);
                }
            }, 200);
        });
    }

    window.EstadoTrabalho = {
        registrarConteudo,
        esquecerConteudo,
        registrarModalAberto: window.__registrarModalAberto
    };
})();
