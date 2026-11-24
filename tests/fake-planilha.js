// A planilha falsa fica em gestao/demo.js (usada também pelo modo demonstração do app).
const { fake } = require('../gestao/demo.js');

function post(fns, corpo) {
  const r = fns.doPost({ postData: { contents: JSON.stringify(corpo) } });
  return JSON.parse(r.conteudo);
}

module.exports = { fake, post };
