const test = require('node:test');
const assert = require('node:assert/strict');
const { carregar } = require('./carregar');

const c = carregar(['mk-gestao-app/calculos.gs']);
const TAXAS = { pix: 0, credito: 4, debito: 0 };
const plain = v => JSON.parse(JSON.stringify(v));

test('taxaDe usa a taxa da forma de pagamento e 0 para forma vazia ou desconhecida', () => {
  assert.equal(c.taxaDe(100, 'credito', { pix: 0, credito: 4, debito: 2 }), 4);
  assert.equal(c.taxaDe(100, '', { pix: 0, credito: 4, debito: 2 }), 0);
  assert.equal(c.taxaDe(100, 'dinheiro', { pix: 0, credito: 4, debito: 2 }), 0);
});

test('datas: semana conta no mês do domingo; domingo volta para a segunda anterior', () => {
  assert.equal(c.mesDaSemana('2026-11-30'), '2026-12');
  assert.equal(c.segundaDe('2026-11-29'), '2026-11-23');
  assert.equal(c.domingoDe('2026-11-23'), '2026-11-29');
  assert.equal(c.mesDe('2026-11-05'), '2026-11');
});

const agenda = [
  { data: '2026-11-10', profissional: 'Katia', servico: 'Mão', cliente: 'Ana', valor: 100, execucao: 'feito', status: 'confirmado', pagamento: 'credito' },
  { data: '2026-11-11', profissional: 'Suênia', servico: 'Pé', cliente: 'Bia', valor: 80, execucao: 'feito', status: 'confirmado', pagamento: '' },
  { data: '2026-11-12', profissional: 'Katia', servico: 'Mão', cliente: 'Cris', valor: '', execucao: 'feito', status: 'confirmado', pagamento: 'pix' },
  { data: '2026-11-13', profissional: 'Katia', servico: 'Mão', cliente: 'Dani', valor: 50, execucao: 'não feito', status: 'cancelado', pagamento: '' },
  { data: '2026-12-01', profissional: 'Katia', servico: 'Mão', cliente: 'Eva', valor: 70, execucao: 'feito', status: 'confirmado', pagamento: 'pix' }
];

test('entradasDoMes: só feitos com valor numérico do mês; sem forma de pagamento = taxa 0', () => {
  const e = c.entradasDoMes('2026-11', agenda, 0.5, TAXAS);
  assert.equal(e.length, 2);
  assert.deepEqual([e[0].taxa, e[0].parteProf, e[0].liquido], [4, 50, 46]);
  assert.deepEqual([e[1].taxa, e[1].parteProf, e[1].liquido], [0, 40, 40]);
  assert.equal(e[0].cliente, 'Ana');
});

test('semanasEquipe: devido, pago, diferença e nada antes do início', () => {
  const ag = [{ data: '2026-11-24', profissional: 'Katia', valor: 100, execucao: 'feito', status: 'confirmado', pagamento: 'pix' }];
  const pag = [{ semana: '2026-11-23', profissional: 'Katia', valor: 40, pagoEm: '2026-11-30' }];
  const s = c.semanasEquipe(ag, pag, ['Katia', 'Suênia'], 0.5, '2026-11-16', '2026-11-25');
  assert.deepEqual(plain(s.map(x => x.semana)), ['2026-11-23', '2026-11-16']);
  const k = s[0].profissionais.find(p => p.nome === 'Katia');
  assert.deepEqual([k.devido, k.pago, k.valorPago, k.diferenca, k.pagoEm], [50, true, 40, 10, '2026-11-30']);
  const su = s[0].profissionais.find(p => p.nome === 'Suênia');
  assert.deepEqual([su.devido, su.pago, su.diferenca], [0, false, 0]);
});

test('semanasEquipe: semana que cruza o mês conta no mês do domingo', () => {
  const ag = [{ data: '2026-12-02', profissional: 'Katia', valor: 100, execucao: 'feito', status: 'confirmado', pagamento: '' }];
  const s = c.semanasEquipe(ag, [], ['Katia'], 0.5, '2026-11-30', '2026-12-02');
  assert.equal(s.length, 1);
  assert.equal(s[0].mes, '2026-12');
  assert.equal(s[0].domingo, '2026-12-06');
  assert.equal(s[0].profissionais[0].devido, 50);
});

test('resumoMes: entrou bruto, saiu com contas/material/profissionais/taxas, sobrou', () => {
  const r = c.resumoMes('2026-11', {
    entradas: [{ valor: 100, taxa: 4, parteProf: 50 }],
    alugueis: [{ mes: '2026-11', valor: 300, recebido: true }, { mes: '2026-11', valor: 300, recebido: false }],
    lancamentos: [
      { mes: '2026-11', categoria: 'Fixas', valor: 200, pago: true },
      { mes: '2026-11', categoria: 'Material', valor: 60, pago: true },
      { mes: '2026-11', categoria: 'Fixas', valor: 90, pago: false },
      { mes: '2026-10', categoria: 'Fixas', valor: 999, pago: true }
    ],
    semanas: [{ mes: '2026-11', profissionais: [{ devido: 50 }] }, { mes: '2026-12', profissionais: [{ devido: 70 }] }]
  });
  assert.deepEqual(plain(r), {
    entrou: { atendimentos: 100, alugueis: 300, total: 400 },
    saiu: { contas: 200, material: 60, profissionais: 50, taxas: 4, total: 314 },
    sobrou: 86
  });
});
