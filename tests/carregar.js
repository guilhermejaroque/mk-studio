// Carrega arquivos .gs (Apps Script) num contexto vm e devolve as funções declaradas.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');

function carregar(arquivos, globais = {}) {
  const codigo = arquivos.map(a => fs.readFileSync(path.join(RAIZ, a), 'utf8')).join('\n;\n');
  const nomes = [...codigo.matchAll(/^function (\w+)/gm)].map(m => m[1]);
  const ctx = vm.createContext({ console, ...globais });
  return vm.runInContext(codigo + `\n;({${nomes.join(',')}})`, ctx, { filename: arquivos.join('+') });
}

module.exports = { carregar };
