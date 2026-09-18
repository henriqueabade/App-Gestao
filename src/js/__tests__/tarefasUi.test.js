/**
 * As partes puras de src/js/utils/tarefas-ui.js: a criação rápida por texto,
 * os feriados e o arquivo .ics.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

const codigo = fs.readFileSync(path.join(__dirname, '..', 'utils', 'tarefas-ui.js'), 'utf8');
const contexto = { window: {}, Intl, Date, Map, Set, TextEncoder, console, URL, Blob: class {} };
vm.runInNewContext(codigo, contexto, { filename: 'tarefas-ui.js' });
const T = contexto.window.TarefasUI;
const daqui = v => JSON.parse(JSON.stringify(v));

// Sexta, 18/09/2026, 10h.
const AGORA = { dia: '2026-09-18', minutos: 600 };
const CTX = {
  agora: AGORA,
  usuarios: [{ id: 2, nome: 'Ana Souza' }, { id: 3, nome: 'João Silva' }],
  listas: [{ id: 7, nome: 'Clientes VIP' }, { id: 8, nome: 'Pessoal' }],
  marcadores: [{ id: 5, nome: 'urgente' }]
};

test('criação rápida: data, hora, prioridade, marcador, lista, pessoa e duração saem do título', () => {
  const r = daqui(T.interpretarTexto('ligar para ACME amanhã às 14h30 !alta #urgente #novo ~"Clientes VIP" @ana por 30min', CTX));
  assert.strictEqual(r.titulo, 'Ligar para ACME');
  assert.strictEqual(r.data, '2026-09-19');
  assert.strictEqual(r.hora, '14:30');
  assert.strictEqual(r.prioridade, 'alta');
  assert.deepStrictEqual(r.marcadores, [{ id: 5, nome: 'urgente' }, { id: null, nome: 'novo' }]);
  assert.deepStrictEqual(r.lista, { id: 7, nome: 'Clientes VIP' });
  assert.deepStrictEqual(r.pessoa, { id: 2, nome: 'Ana Souza' });
  assert.strictEqual(r.duracao_min, 30);
  assert.strictEqual(r.tipo, 'Ligação');
});

test('criação rápida: dias da semana, "em N dias", dd/mm e "dia N"', () => {
  const t = texto => daqui(T.interpretarTexto(texto, CTX));
  assert.strictEqual(t('Reunião segunda').data, '2026-09-21');
  assert.strictEqual(t('Reunião sexta').data, '2026-09-25', 'hoje é sexta: a que vem');
  assert.strictEqual(t('Enviar e-mail em 10 dias').data, '2026-09-28');
  assert.strictEqual(t('Visita 25/12').data, '2026-12-25');
  assert.strictEqual(t('Visita 02/01').data, '2027-01-02', 'data que já passou vai para o ano que vem');
  assert.strictEqual(t('Pagar dia 5').data, '2026-10-05');
  assert.strictEqual(t('Pagar dia 30').data, '2026-09-30');
  assert.strictEqual(t('Relatório semana que vem').data, '2026-09-21');
  assert.strictEqual(t('Café 9h').data, '2026-09-19', 'hora que já passou hoje: amanhã');
  assert.strictEqual(t('Café 15h').data, '2026-09-18');
  assert.strictEqual(t('Proposta !!').prioridade, 'urgente');
  assert.strictEqual(t('Visitar loja').tipo, 'Visita');
  assert.strictEqual(t('Pedido 31/02').data, null, 'data impossível não é data');
  assert.strictEqual(t('Falar com @Pedro').pessoa, null, 'pessoa que não existe fica no título');
  assert.strictEqual(t('Falar com @Pedro').titulo, 'Falar com @Pedro');
});

test('feriados de 2026: nacionais, Páscoa móvel e os de Belo Horizonte', () => {
  assert.strictEqual(T.pascoa(2026), '2026-04-05');
  assert.strictEqual(T.pascoa(2027), '2027-03-28');
  const nacionais = daqui(T.feriadosDoAno(2026));
  const por = dia => nacionais.find(f => f.dia === dia);
  assert.strictEqual(por('2026-04-03').nome, 'Sexta-feira Santa');
  assert.strictEqual(por('2026-02-16').tipo, 'facultativo', 'Carnaval');
  assert.strictEqual(por('2026-06-04').tipo, 'facultativo', 'Corpus Christi fora de BH');
  assert.strictEqual(por('2026-11-20').tipo, 'nacional');
  assert.ok(!por('2026-08-15'));
  const bh = daqui(T.feriadosDoAno(2026, { municipio: { codigo: '3106200', nome: 'Belo Horizonte' } }));
  assert.strictEqual(bh.find(f => f.dia === '2026-08-15').tipo, 'municipal');
  assert.strictEqual(bh.find(f => f.dia === '2026-06-04').tipo, 'municipal');
});

test('.ics: dia inteiro, com hora, repetição, lembrete e texto escapado', () => {
  const ics = T.gerarIcs([
    { id: 1, titulo: 'Ligar; ACME, hoje', tipo: 'Ligação', prioridade: 'alta', data: '2026-09-21', hora: '14:30', duracao_min: 45, lembrete_min: 15, recorrencia: { freq: 'semanal', intervalo: 1, dias_semana: [1, 3], fim: { tipo: 'vezes', vezes: 4 }, ocorrencia: 1 }, vinculos: [{ tipo: 'cliente', nome: 'ACME' }] },
    { id: 2, titulo: 'Dia inteiro', data: '2026-09-22', status: 'concluida' },
    { id: 3, titulo: 'Sem data' }
  ], { agora: new Date('2026-09-18T12:00:00Z') });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.includes('DTSTART;TZID=America/Sao_Paulo:20260921T143000'));
  assert.ok(ics.includes('DTEND;TZID=America/Sao_Paulo:20260921T151500'));
  assert.ok(ics.includes('SUMMARY:Ligar\\; ACME\\, hoje'));
  assert.ok(ics.includes('RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4'));
  assert.ok(ics.includes('TRIGGER:-PT15M'));
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20260922'));
  assert.ok(ics.includes('DTEND;VALUE=DATE:20260923'));
  assert.ok(ics.includes('SUMMARY:✓ Dia inteiro'));
  assert.ok(!ics.includes('tarefa-3@'), 'sem data não vai para a agenda');
  assert.ok(ics.split('\r\n').every(l => new TextEncoder().encode(l).length <= 75), 'linhas dobradas em 75 bytes');
});

test('prazo legível e atraso', () => {
  assert.strictEqual(T.rotuloDoPrazo({ data: '2026-09-18', hora: '14:00' }, '2026-09-18'), 'Hoje 14:00');
  assert.strictEqual(T.rotuloDoPrazo({ data: '2026-09-19' }, '2026-09-18'), 'Amanhã');
  assert.strictEqual(T.rotuloDoPrazo({ data: '2026-09-22' }, '2026-09-18'), 'ter 22/09');
  assert.strictEqual(T.rotuloDoPrazo({ data: '2027-01-05' }, '2026-09-18'), '05/01/2027');
  assert.strictEqual(T.rotuloDoPrazo({}, '2026-09-18'), 'Sem data');
  assert.ok(T.atrasada({ data: '2026-09-17', status: 'a_fazer' }, AGORA));
  assert.ok(T.atrasada({ data: '2026-09-18', hora: '09:00', status: 'a_fazer' }, AGORA));
  assert.ok(!T.atrasada({ data: '2026-09-18', status: 'a_fazer' }, AGORA));
  assert.strictEqual(T.descreverRepeticao({ freq: 'semanal', intervalo: 1, dias_semana: [1, 3] }), 'Toda semana (seg, qua)');
});
