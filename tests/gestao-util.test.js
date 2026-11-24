const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'gestao', 'index.html'), 'utf8');
const bloco = (html.match(/<script id="util">([\s\S]*?)<\/script>/) || [])[1] || '';
const u = vm.runInContext(bloco + ';({parseReais, reais, nomeMes, somaMes})', vm.createContext({}));

test('parseReais entende valores digitados do jeito brasileiro', () => {
  assert.equal(u.parseReais('1.234,50'), 1234.5);
  assert.equal(u.parseReais('80'), 80);
  assert.equal(u.parseReais('80,5'), 80.5);
  assert.equal(u.parseReais('R$ 45,00'), 45);
  assert.equal(u.parseReais(''), null);
  assert.equal(u.parseReais('abc'), null);
});

test('reais formata com milhar e vírgula', () => {
  assert.equal(u.reais(1234.5), '1.234,50');
  assert.equal(u.reais(0), '0,00');
  assert.equal(u.reais(-86), '-86,00');
});

test('nomes e soma de meses', () => {
  assert.equal(u.nomeMes('2026-11'), 'novembro de 2026');
  assert.equal(u.somaMes('2026-12', 1), '2027-01');
  assert.equal(u.somaMes('2026-01', -1), '2025-12');
});
