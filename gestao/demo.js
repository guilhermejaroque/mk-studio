/**
 * MK Studio — gestão: planilha de mentira em memória.
 * Usada no MODO DEMONSTRAÇÃO do app (roda o servidor de verdade, Codigo.gs +
 * calculos.gs, dentro do navegador) e pelos testes automáticos.
 */
(function (raiz) {

  function aba(nome, linhas) {
    const s = {
      nome: nome, linhas: linhas.map(l => l.slice()),
      getName: () => nome,
      getLastRow: () => s.linhas.length,
      getLastColumn: () => s.linhas.reduce((m, l) => Math.max(m, l.length), 0),
      getDataRange: () => intervalo(s, 1, 1, Math.max(1, s.linhas.length), Math.max(1, s.getLastColumn())),
      getRange: (r, c, nr, nc) => intervalo(s, r, c, nr || 1, nc || 1),
      appendRow: l => { s.linhas.push(l.slice()); },
      deleteRow: r => { s.linhas.splice(r - 1, 1); }
    };
    return s;
  }

  function intervalo(s, r, c, nr, nc) {
    const cel = (i, j) => { const v = (s.linhas[i] || [])[j]; return v === undefined ? '' : v; };
    const set = (lin, col, v) => {
      while (s.linhas.length < lin) s.linhas.push([]);
      const l = s.linhas[lin - 1];
      while (l.length < col - 1) l.push('');
      l[col - 1] = v;
    };
    return {
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cel(r - 1 + i, c - 1 + j))),
      getValue: () => cel(r - 1, c - 1),
      setValue: v => set(r, c, v),
      setValues: vs => vs.forEach((linha, i) => linha.forEach((v, j) => set(r + i, c + j, v)))
    };
  }

  function hojeLocal() {
    const d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  // Devolve os "globais" do Apps Script ligados a uma planilha em memória.
  function fake(abas, opcoes) {
    opcoes = opcoes || {};
    const planilha = { abas: {} };
    Object.keys(abas).forEach(n => { planilha.abas[n] = aba(n, abas[n]); });
    let uid = 0;
    const hoje = opcoes.hoje || hojeLocal();
    const DataReal = Date;
    function DataFalsa() {
      if (!arguments.length) { const d = new DataReal(hoje + 'T15:00:00Z'); d.__hoje = true; return d; }
      return new (Function.prototype.bind.apply(DataReal, [null].concat([].slice.call(arguments))))();
    }
    DataFalsa.prototype = DataReal.prototype;
    DataFalsa.now = () => new DataReal(hoje + 'T15:00:00Z').getTime();
    DataFalsa.UTC = DataReal.UTC;
    return {
      _planilha: planilha,
      SpreadsheetApp: {
        openById: () => ({
          getSheetByName: n => planilha.abas[n] || null,
          insertSheet: n => (planilha.abas[n] = aba(n, []))
        }),
        flush: () => {}
      },
      PropertiesService: {
        getScriptProperties: () => ({
          getProperty: k => (opcoes.props && Object.prototype.hasOwnProperty.call(opcoes.props, k) ? opcoes.props[k] : null),
          getProperties: () => Object.assign({}, opcoes.props || {})
        })
      },
      LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
      ContentService: {
        MimeType: { JSON: 'json' },
        createTextOutput: s => ({ conteudo: s, setMimeType() { return this; } })
      },
      Utilities: {
        getUuid: () => 'id' + (++uid),
        formatDate: (d, fuso, fmt) => {
          if (d && d.__hoje) return fmt === 'yyyy-MM-dd' ? hoje : '12:00';
          const iso = d.toISOString();
          return fmt === 'yyyy-MM-dd' ? iso.slice(0, 10) : iso.slice(11, 16);
        }
      },
      Date: DataFalsa
    };
  }

  // Executa o código dos arquivos .gs com os globais do fake e devolve doPost.
  function servidor(codigo, globais) {
    const nomes = ['SpreadsheetApp', 'PropertiesService', 'LockService', 'ContentService', 'Utilities', 'Date'];
    const fn = new Function(nomes.join(','), codigo + '\n;return { doPost: doPost };');
    return fn.apply(null, nomes.map(n => globais[n]));
  }

  // Dados de exemplo para o modo demonstração.
  function exemplo(hoje) {
    hoje = hoje || hojeLocal();
    const d0 = new Date(hoje + 'T12:00:00Z');
    const dia = n => { const d = new Date(d0); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    const dow = d0.getUTCDay();
    const seg = -((dow + 6) % 7);                     // deslocamento até a segunda desta semana
    const mes = hoje.slice(0, 7);
    const servs = [['Manicure tradicional', 40], ['Pedicure', 45], ['Mão e pé', 80], ['Esmaltação em gel', 90], ['Francesinha', 15]];
    const clientes = ['Ana Souza', 'Bia Lima', 'Camila Rocha', 'Dani Alves', 'Eva Martins', 'Fernanda Dias', 'Gabi Nunes', 'Helena Prado'];
    const formas = ['pix', 'credito', 'debito', 'pix', 'credito'];
    const agenda = [['ID', 'Data', 'Horário', 'Profissional', 'Serviço', 'Cliente', 'Status', 'Execução', 'Valor', 'Pagamento']];
    let k = 0;
    for (let n = seg - 14; n <= 0; n++) {
      const d = dia(n);
      const w = new Date(d + 'T12:00:00Z').getUTCDay();
      if (w === 0 || w === 1) continue;               // salão fecha domingo e segunda
      ['Katia', 'Suênia'].forEach((prof, j) => {
        for (let h = 0; h < 2; h++) {
          const s = servs[(k + j) % servs.length];
          agenda.push(['a' + k, d, ['08:00', '09:30'][h], prof, s[0], clientes[k % clientes.length],
            'confirmado', 'feito', s[1], formas[k % formas.length]]);
          k++;
        }
      });
    }
    return {
      Agenda: agenda,
      Profissionais: [['ID', 'Nome'], ['katia', 'Katia'], ['suenia', 'Suênia']],
      Contas: [['ID', 'Nome', 'Categoria', 'Fixa', 'Ativa'],
        ['c1', 'Aluguel do salão', 'Fixas', 'sim', 'sim'], ['c2', 'Luz', 'Fixas', 'sim', 'sim'],
        ['c3', 'Água', 'Fixas', 'sim', 'sim'], ['c4', 'Internet', 'Fixas', 'sim', 'sim']],
      'Lançamentos': [['ID', 'Mês', 'Data', 'ContaID', 'Descrição', 'Categoria', 'Valor', 'Pago'],
        ['l1', mes, dia(seg - 10), 'c1', '', 'Fixas', 2500, 'sim'],
        ['l2', mes, dia(seg - 6), 'c2', '', 'Fixas', 312.4, 'sim'],
        ['l3', mes, dia(seg - 3), '', 'Acetona e algodão', 'Material', 86.9, 'sim']],
      Estoque: [['ID', 'Item', 'Unidade', 'Quantidade', 'Mínimo'],
        ['e1', 'Acetona', 'frascos', 2, 2], ['e2', 'Algodão', 'pacotes', 6, 2],
        ['e3', 'Lixas', 'unidades', 40, 15], ['e4', 'Esmalte base', 'frascos', 1, 3]],
      Config: [['Chave', 'Valor'], ['taxa_pix', 0], ['taxa_credito', 0], ['taxa_debito', 0], ['comissao', 0.5],
        ['inicio', dia(seg - 14)]]
    };
  }

  const api = { fake: fake, servidor: servidor, exemplo: exemplo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.MKDemo = api;
})(typeof window !== 'undefined' ? window : this);
