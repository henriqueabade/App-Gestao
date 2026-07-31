# Restauração do trabalho interrompido

Quando um usuário é **desconectado** no meio de um preenchimento, o app guarda
onde ele estava e o que já havia digitado. Ao voltar, repõe tudo. A regra tem
três condições e todas precisam valer.

## As três condições

| # | Condição | Onde é verificada |
| --- | --- | --- |
| 1 | A sessão terminou por **desconexão**, não por escolha do usuário | `motivo` carimbado no estado |
| 2 | Quem está entrando é o **mesmo usuário** que estava trabalhando | `usuarioId` carimbado no estado |
| 3 | Estamos dentro de **30 minutos** | `salvoEm` + o `savedAt` do arquivo |

A decisão é tomada em um único lugar: **`src/js/utils/restauracao.js`**, carregado
tanto pela janela de login quanto pela do dashboard. Antes cada uma tinha a
própria versão da regra, elas divergiam, e o trabalho voltava onde não devia.

### O que conta como desconexão

```js
MOTIVOS_RESTAURAVEIS = ['offline', 'offline-db', 'pin', 'admin-disabled', 'admin-pending']
```

- `offline` — queda de internet ou do servidor
- `offline-db` — banco de dados indisponível
- `pin` — PIN alterado/invalidado (corte administrativo)
- `admin-disabled` / `admin-pending` — acesso cortado ou ainda não liberado pelo administrador

**Fora da lista de propósito:** sair pelo menu (`logout`), encerramento por
inatividade (`idle-timeout`), fechar o app e `user-removed` — neste último não há
para quem restaurar.

## Como gravar

Existe **um único caminho**. Nenhum módulo deve chamar `electronAPI.saveState`
diretamente:

```js
// Fim de sessão por desconexão (src/js/checking.js)
await window.EstadoTrabalho.salvarPorDesconexao(reason);

// Qualquer outro fim de sessão (saída pelo menu, inatividade)
await window.EstadoTrabalho.descartarTrabalhoGuardado();
```

`salvarPorDesconexao` é o porteiro: se `reason` não for uma desconexão, ele não
grava **e** apaga o que houver guardado, para não ressuscitar no próximo login um
trabalho que a pessoa abandonou de propósito.

## A corrida com o login (cuidado importante)

A janela do dashboard é criada pela de login e dispara a restauração no `load` —
o que pode acontecer **antes** de `localStorage.user` estar gravado. Nesse
instante não dá para saber de quem é o trabalho.

- A versão antiga "resolvia" restaurando para qualquer um: era exatamente o
  defeito de trabalho aparecendo para o usuário errado.
- Exigir o usuário e desistir na hora derruba a restauração inteira, em silêncio.

A saída é **esperar**: `aguardarUsuarioAtual()` dá até 5 s para o usuário
aparecer, e só custa esse tempo quando existe trabalho guardado e o usuário não
chega. E, se mesmo assim não aparecer, o arquivo **não** é apagado — perder o
trabalho por uma questão de milissegundos seria o pior desfecho.

## Quando o arquivo é apagado

Só existe um arquivo de estado por máquina (`session-state.json`), então quem
apaga importa:

| Situação | O arquivo |
| --- | --- |
| Restaurado com sucesso | **apaga** (uso único) |
| Expirado, sem motivo válido ou sem dono | **apaga** (é lixo) |
| Pertence a outro usuário | **fica** — quem caiu ainda pode voltar |
| Não deu para identificar quem está logando | **fica** — pode ser do próprio |
| Saída voluntária do próprio dono | **apaga** |
| Saída voluntária de outra pessoa | **fica** |

Essa última linha é o detalhe que evita o pior caso: X cai, Y entra e sai na
mesma máquina, e o trabalho de X sobrevive para quando X voltar.

## Onde mora o usuário logado (a pegadinha que quebrou tudo)

`estado-trabalho.js` responde "quem está logado agora?" em `usuarioAtualBruto()`,
e a resposta **precisa** olhar as duas fontes, nesta ordem:

```js
sessionStorage.getItem('currentUser')   // primeiro
localStorage.getItem('user')            // depois
```

O motivo é `src/utils/userActions.js`, que ao montar o dashboard faz:

```js
sessionStorage.setItem('currentUser', stored);
if (localStorage.getItem('rememberUser') !== '1') {
  localStorage.removeItem('user');      // ← some do localStorage
}
```

Isso acontece durante a execução dos scripts, ou seja **antes** do `load` em que
a restauração dispara. Enquanto aqui se lia apenas o `localStorage`, toda sessão
sem "lembrar-me" caía no veredito `sem-usuario-atual`: nenhum módulo, nenhum
modal, nada — em qualquer módulo, o tempo inteiro.

O sintoma era enganoso porque a regra estava certa e o estado era gravado
perfeitamente. O que denunciava era o **arquivo intocado no disco**: como
`sem-usuario-atual` preserva o arquivo, ele sobrevivia à tentativa de
restauração — prova de que a restauração nem tinha chegado a tentar.

O mesmo valia para o `collectState`, que carimbava `usuarioId: null` e condenava
o estado a ser descartado como "sem dono" na volta. As duas pontas usam
`usuarioAtualBruto()` hoje, e há teste para cada uma
(`restauracaoModais.test.js`). Ao mexer em qualquer uma delas, lembre: o
`sessionStorage` é por janela, que é exatamente a semântica de "quem está logado
NESTA janela".

## O arquivo só é consumido depois de restaurar

`lerEstadoSalvo()` **não** apaga o arquivo. Quem apaga é
`consumirTrabalhoGuardado()`, chamado só quando a reposição termina sem estourar.
Se um módulo não carregar ou um modal não abrir, o trabalho continua guardado e a
próxima tentativa dentro dos 30 minutos ainda o encontra. Apagar antes de repor
significava perder o trabalho sem nunca tê-lo mostrado.

## Fazendo um modal voltar por inteiro

A varredura genérica repõe `input`, `select` e `textarea` que estão no overlay.
**Não** repõe: linhas de tabela, listas guardadas em variáveis do próprio modal,
blocos montados por JS e selects preenchidos por `fetch`. Para isso o modal
declara como salvar e como repor:

```js
window.EstadoTrabalho?.registrarConteudo?.(overlayId, {
  capturar: () => ({ ... }),
  restaurar: async (dados) => { ... }
});
```

Cinco armadilhas, com solução pronta:

**1. Modal não sabe O QUE abrir.** Modais de edição, detalhes, visualização e
confirmação de exclusão leem um global (`window.selectedQuoteId`,
`window.produtoExcluir`, `window.materiaSelecionada`...) definido pela tela que
os abriu — e na restauração ninguém passa por lá. O modal reabre em branco, ou
pior: abre normalmente e o botão de confirmar não faz nada. Devolva o global pelo
`__contexto`, que é reaplicado ao `window` **antes** de o script do modal rodar:

```js
capturar: () => ({ __contexto: { selectedQuoteId: id }, ... })
```

Quando o contexto é a ÚNICA coisa a repor — o caso de todo modal de exclusão e
de todo modal só de leitura — use o atalho:

```js
window.EstadoTrabalho?.registrarContexto?.('excluirProduto',
  () => ({ produtoExcluir: window.produtoExcluir }));
```

Guarde só o identificador quando o modal souber recarregar sozinho; guarde o
objeto inteiro quando não houver como buscá-lo de novo (é o caso do
`cancelarPedidoContext`).

**Nunca** coloque no `__contexto` um objeto vivo, com funções — como
`window.produtoNovoAPI`. Ele não sobrevive ao JSON e é recriado pelo modal pai,
que a pilha reabre antes de qualquer forma.

**2. Select preenchido por `fetch`.** Atribuir `select.value` antes das
`<option>` chegarem não faz nada — o navegador descarta em silêncio. Use:

```js
await window.EstadoTrabalho.reporSelect(clienteSelect, valorGuardado);
```

Reponha primeiro o select "pai" (cliente) e só depois os que dependem dele
(contato, transportadora), porque é o `change` do pai que dispara a carga deles.

**3. O modal registra tarde.** Quase todo modal faz `await` (buscar produtos,
pedidos) antes de registrar. A restauração espera o registro por até 15 s, então
`registrarConteudo` pode ficar depois da carga inicial — o que inclusive é
melhor, para que o conteúdo restaurado sobrescreva o que veio da API.

**4. Caixa DESMARCADA não é "campo preenchido".** A varredura genérica só guarda
valores preenchidos e descarta `false`, então uma caixa que o usuário desmarcou
volta marcada. Numa tela de permissões isso é metade do trabalho perdido. Quando
o que importa é o estado dos dois lados, capture explicitamente:

```js
capturar: () => ({ marcacoes: { 'mp.view': false, 'mp.create': true, ... } })
```

Vale também para controles que **não são** campos de formulário — em "Editar
Usuário" as permissões são botões `aria-pressed`, invisíveis para a varredura.
Nesse caso guarde o array de estado e case por chave; confira que a chave usada
é a mesma que o normalizador produz, senão a reposição vira um no-op silencioso
(coberto por `src/js/__tests__/usuarioPermissoesRestauracao.test.js`).

**5. Overlay que nasce escondido** (nada a fazer — já resolvido). Muitos
overlays têm `class="hidden"` no HTML e só são revelados pelo
`openModalWithSpinner`, que escuta `modalSpinnerLoaded`. A restauração reabre
pelo `Modal.open` direto, sem esse listener: o modal existia mas ficava
invisível e a restauração desistia. Era por isso que **"Novo Produto" voltava e
"Editar Produto" não** — o primeiro nasce visível, o segundo não. Hoje a
restauração escuta o aviso de carregado e, se ele não vier, revela o overlay por
conta própria assim que ele tem conteúdo.

## Cobertura por módulo

| Módulo | Situação |
| --- | --- |
| Produtos | **completo** (12 modais) |
| Matéria-prima | **completo** (12 modais) |
| Clientes | **completo** (5 modais) |
| Orçamentos | **completo** (5 modais) |
| Pedidos | **completo** (3 modais) |
| Usuários | **completo** (3 modais) |
| Laminação — clientes | **completo** (cliente novo/editar) |
| Laminação — serviços | **pendente** — serviço novo (peças e amarrados) |

Os modais de cliente da laminação usam os mesmos ids de overlay da gestão
(`novoCliente`, `editarCliente`), mas isso não confunde a restauração: o que é
guardado é o `htmlPath`/`scriptPath` da abertura, e os dois módulos nunca estão
abertos ao mesmo tempo. O `clienteEditarPreferencias` de propósito **não** volta —
ele carrega o `abrirNovoContato`, que abriria o modal de contato sozinho por cima
do que a restauração já está reabrindo.

Modais somente leitura (`*-visualizar`, `*-detalhes`) não têm o que repor, mas
ainda precisam do `__contexto` para saber o que exibir — senão reabrem em branco.

Modais que só têm campos de formulário (`cliente-contato`, `materia-prima-*-novo`
e `*-excluir` de categoria/unidade/processo/coleção) não precisam de registro: a
varredura genérica dá conta.

## Testes

```bash
node --test src/js/__tests__/restauracaoTrabalho.test.js src/js/__tests__/estadoTrabalho.test.js src/js/__tests__/restauracaoModais.test.js src/js/__tests__/usuarioPermissoesRestauracao.test.js
```

- `restauracaoTrabalho` — a regra pura (quando e para quem restaurar).
- `estadoTrabalho` — os scripts de verdade num contexto com
  `document`/`localStorage`/`electronAPI` simulados: gravar, descartar,
  restaurar e a corrida com o login.
- `restauracaoModais` — a reabertura de modais: `__contexto`, registro tardio,
  overlay que nasce escondido e `reporSelect`.
- `usuarioPermissoesRestauracao` — as permissões de usuário: roda os
  normalizadores reais do modal e garante que marcar **e desmarcar** voltam.
