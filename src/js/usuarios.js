// Script principal do módulo de Usuários
// Controla carregamento da lista, edições e filtros

// Endereço base da API. Como o frontend é servido via protocolo `file://`,
// precisamos apontar explicitamente para o servidor HTTP.
const API_URL = 'http://localhost:3000';

function coletarFiltros() {
    const status = [];
    document.querySelectorAll('.checkbox-custom:checked').forEach(cb => status.push(cb.value));
    return {
        busca: document.getElementById('filtroBusca')?.value || '',
        perfil: document.getElementById('filtroPerfil')?.value || '',
        status
    };
}

function initUsuarios() {
    // animação de entrada
    document.querySelectorAll('.animate-fade-in-up').forEach((el, index) => {
        setTimeout(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, index * 100);
    });

    carregarUsuarios();

    document.getElementById('btnNovoUsuario')?.addEventListener('click', () => {
        console.log('Criar novo usuário');
    });

    document.getElementById('aplicarFiltro')?.addEventListener('click', () => {
        console.log('Aplicar filtros', coletarFiltros());
    });

    document.getElementById('limparFiltro')?.addEventListener('click', () => {
        document.getElementById('filtroBusca').value = '';
        document.getElementById('filtroPerfil').value = '';
        document.querySelectorAll('.checkbox-custom').forEach(cb => cb.checked = false);
        console.log('Filtros limpos');
    });

    document.querySelectorAll('[data-acao="editar"]').forEach(btn => {
        btn.addEventListener('click', () => {
            console.log('Editar usuário');
        });
    });

    document.querySelectorAll('[data-acao="remover"]').forEach(btn => {
        btn.addEventListener('click', () => {
            console.log('Remover usuário');
        });
    });

    // Controle do popover de resumo
    const infoIcon = document.querySelector('.info-icon');
    const resumoPopover = document.getElementById('resumoPopover');

    if (infoIcon && resumoPopover) {
        const mostrarPopover = () => {
            const rect = infoIcon.getBoundingClientRect();
            resumoPopover.style.left = '1vw';
            resumoPopover.style.top = '2.5vw';
            resumoPopover.classList.add('show');
        };

        const ocultarPopover = () => {
            resumoPopover.classList.remove('show');
        };

        infoIcon.addEventListener('mouseenter', mostrarPopover);
        infoIcon.addEventListener('mouseleave', () => {
            setTimeout(() => {
                if (!resumoPopover.matches(':hover')) ocultarPopover();
            }, 100);
        });
        resumoPopover.addEventListener('mouseleave', ocultarPopover);
    }
}

async function carregarUsuarios() {
    try {
        const resp = await fetch(`${API_URL}/api/usuarios/lista`);
        const usuarios = await resp.json();
        const tbody = document.getElementById('listaUsuarios');
        if (!tbody) return;
        tbody.innerHTML = '';
        usuarios.forEach(u => {
            const tr = document.createElement('tr');
            tr.classList.add('table-row');
            const iniciais = u.nome
                .split(' ')
                .map(p => p[0])
                .join('')
                .substring(0, 2)
                .toUpperCase();
            tr.innerHTML = `
                <td class="px-6 py-4">
                    <div class="w-9 h-9 rounded-full flex items-center justify-center text-white font-medium text-sm" style="background: var(--color-primary)">${iniciais}</div>
                </td>
                <td class="px-6 py-4">
                    <div class="text-sm font-medium text-white">${u.nome}</div>
                </td>
                <td class="px-6 py-4 text-sm text-white">${u.email}</td>
                <td class="px-6 py-4"></td>
                <td class="px-6 py-4">
                    <span class="${u.status === 'Ativo' ? 'badge-success' : 'badge-danger'} px-2 py-1 rounded-full text-xs font-medium">${u.status}</span>
                </td>
                <td class="px-6 py-4">
                    <div class="flex items-center gap-2">
                        <i class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" data-acao="editar" style="color: var(--color-primary)" title="Editar"></i>
                        <i class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" data-acao="remover" style="color: var(--color-red)" title="Excluir"></i>
                    </div>
                </td>`;
            tbody.appendChild(tr);
        });

        document.querySelectorAll('[data-acao="editar"]').forEach(btn => {
            btn.addEventListener('click', () => {
                console.log('Editar usuário');
            });
        });

        document.querySelectorAll('[data-acao="remover"]').forEach(btn => {
            btn.addEventListener('click', () => {
                console.log('Remover usuário');
            });
        });
    } catch (err) {
        console.error('Erro ao carregar usuários:', err);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUsuarios);
} else {
    initUsuarios();
}
