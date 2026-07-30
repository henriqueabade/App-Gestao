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

## Quando o arquivo é apagado

Só existe um arquivo de estado por máquina (`session-state.json`), então quem
apaga importa:

| Situação | O arquivo |
| --- | --- |
| Restaurado com sucesso | **apaga** (uso único) |
| Expirado, sem motivo válido ou sem dono | **apaga** (é lixo) |
| Pertence a outro usuário | **fica** — quem caiu ainda pode voltar |
| Saída voluntária do próprio dono | **apaga** |
| Saída voluntária de outra pessoa | **fica** |

Essa última linha é o detalhe que evita o pior caso: X cai, Y entra e sai na
mesma máquina, e o trabalho de X sobrevive para quando X voltar.

## Testes

```bash
node --test src/js/__tests__/restauracaoTrabalho.test.js src/js/__tests__/estadoTrabalho.test.js
```

O primeiro cobre a regra pura; o segundo carrega os scripts de verdade num
contexto com `document`/`localStorage`/`electronAPI` simulados e exercita gravar,
descartar e restaurar.
