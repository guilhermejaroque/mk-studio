const test = require('node:test');
const assert = require('node:assert/strict');
const { carregar } = require('./carregar');
const { fake } = require('./fake-planilha');

const plain = v => JSON.parse(JSON.stringify(v));
const BLOCOS = '08:00, 09:30, 11:00, 13:30, 15:00, 16:30, 18:00';
const CAB_AGENDA = ['ID', 'Data', 'Horário', 'Fim', 'Profissional', 'Serviço', 'Cliente', 'Telefone', 'Observação', 'Origem', 'Status', 'Criado em'];

function novo(extra = {}) {
  const g = fake(Object.assign({
    Agenda: [CAB_AGENDA],
    Profissionais: [['Nome', 'ID', 'Função', 'Ativa', 'Horários extras', 'Blocos', 'Duração (min)'],
      ['Katia', 'katia', 'Manicure', 'sim', '19:30'],
      ['Suênia', 'suenia', 'Manicure', 'sim', '', '08:00, 09:00, 10:00, 11:00, 13:30, 14:30, 15:30, 16:30', 60]],
    'Serviços': [['Serviço', 'Categoria', 'Tipo', 'Preço (R$)', 'Por unidade', 'Descrição', 'Ativo'], ['Manicure tradicional', '', 'principal', '35', 'não', '', 'sim']],
    'Horários': [['Dia', 'Aberto', 'Blocos'], ['Domingo', 'não'], ['Segunda', 'não'], ['Terça', 'sim', BLOCOS], ['Quarta', 'sim', BLOCOS],
      ['Quinta', 'sim', BLOCOS], ['Sexta', 'sim', BLOCOS], ['Sábado', 'sim', BLOCOS]],
    Bloqueios: [['Data', 'Profissional', 'Horário', 'Motivo']]
  }, extra), { hoje: '2026-11-24' });
  const fns = carregar(['site-agenda/Codigo.gs'], g);
  return { g, fns, get: () => JSON.parse(fns.doGet().conteudo),
    post: corpo => JSON.parse(fns.doPost({ postData: { contents: JSON.stringify(corpo) } }).conteudo) };
}
const reserva = o => Object.assign({ profissional: 'suenia', servico: 'Manicure tradicional', data: '2026-11-26', cliente: 'Ana', telefone: '11999998888' }, o);

test('site: Suênia tem blocos de 1h próprios; Katia segue os do dia', () => {
  const j = novo().get();
  const s = j.profissionais.find(p => p.id === 'suenia'), k = j.profissionais.find(p => p.id === 'katia');
  assert.deepEqual(plain(s.blocos), ['08:00', '09:00', '10:00', '11:00', '13:30', '14:30', '15:30', '16:30']);
  assert.equal(s.duracao, 60);
  assert.equal(k.blocos, null);
  assert.equal(k.duracao, 90);
});

test('site: agendar Suênia grava fim 1h depois e recusa horário da grade antiga', () => {
  const { g, post } = novo();
  assert.equal(post(reserva({ horario: '13:30' })).ok, true);
  const linha = g._planilha.abas.Agenda.linhas[1];
  assert.deepEqual([linha[2], linha[3], linha[4]], ["'13:30", "'14:30", 'Suênia']);
  assert.equal(post(reserva({ horario: '09:30', telefone: '11999997777' })).ok, false);
});

test('site: atendimento antigo de 1h30 ocupa os blocos de 1h que ele cobre', () => {
  const { get } = novo({
    Agenda: [CAB_AGENDA, ['x', '26/11/2026', '09:30', '11:00', 'Suênia', 'Mão', 'Bia', '', '', 'site', 'confirmado', '']]
  });
  const h = get().ocupados.filter(o => o.p === 'suenia' && o.d === '2026-11-26').map(o => o.h).sort();
  assert.ok(h.includes('09:00') && h.includes('10:00'));
  assert.ok(!h.includes('08:00') && !h.includes('11:00'));
});

test('site: folga marcada pelo app (nome ou ID) aparece como folga', () => {
  ['Suênia', 'suenia'].forEach(quem => {
    const j = novo({ Bloqueios: [['Data', 'Profissional', 'Horário', 'Motivo'], ['2026-11-27', quem, '', 'Folga (app)']] }).get();
    assert.deepEqual(plain(j.folgas), [{ p: 'suenia', d: '2026-11-27', t: 'folga' }], quem);
  });
});
