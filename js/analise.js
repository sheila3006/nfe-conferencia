// analise.js — lógica pura (sem tela) para conferir as notas do app contra a planilha do sistema.

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Campos que a planilha pode ter. "regex" serve para o app adivinhar a coluna pelo título.
export const CAMPOS = [
  { id: "nota", rotulo: "Nº da nota", obrigatorio: true,
    regex: [/(numero|num|n) (da )?(nota|nf|nfe|documento|doc)\b/, /^(nota|nf|nfe|documento|doc)( fiscal)?$/, /\b(nota|nfe|nf|documento)\b/] },
  { id: "cnpj", rotulo: "CNPJ do fornecedor", regex: [/cnpj/, /cpf/] },
  { id: "codigo", rotulo: "Código do produto", regex: [/\b(codigo|cod|referencia|ref|sku)\b/] },
  { id: "item", rotulo: "Nº do item na nota", regex: [/^(n |num |numero )?(do )?(item|seq|sequencia)/, /\b(item|seq)\b/] },
  { id: "descricao", rotulo: "Descrição do item", regex: [/descri/, /produto|mercadoria|material/] },
  { id: "cfop", rotulo: "CFOP (compara)", regex: [/cfop/] },
  { id: "cstPis", rotulo: "CST PIS (compara)", regex: [/cst.*pis|pis.*cst/, /^pis$/] },
  { id: "cstCofins", rotulo: "CST COFINS (compara)", regex: [/cst.*cofins|cofins.*cst/, /^cofins$/] },
  { id: "valor", rotulo: "Valor do item (compara)", regex: [/valor.*(total|produto|item)|(total|produto).*valor/, /^(vl|valor) ?(total|prod)?$/, /vprod/] },
];

/** Escolhe sozinho a coluna de cada campo, olhando os títulos. Devolve {campo: índice ou -1}. */
export function sugerirMapa(cabecalhos) {
  const mapa = {};
  const usadas = new Set();
  for (const campo of CAMPOS) {
    mapa[campo.id] = -1;
    achou: for (const r of campo.regex) {
      for (let i = 0; i < cabecalhos.length; i++) {
        if (usadas.has(i)) continue;
        if (r.test(norm(cabecalhos[i]))) { mapa[campo.id] = i; usadas.add(i); break achou; }
      }
    }
  }
  return mapa;
}

/** Descobre qual linha (0-based) é o cabeçalho: a que tem mais títulos reconhecíveis nas 20 primeiras. */
export function detectarCabecalho(linhas) {
  let melhor = 0, pontos = -1;
  linhas.slice(0, 20).forEach((linha, i) => {
    const p = linha.filter((c) => typeof c === "string" && CAMPOS.some((k) => k.regex.some((r) => r.test(norm(c))))).length;
    if (p > pontos) { pontos = p; melhor = i; }
  });
  return melhor;
}

/** Lê um CSV (detecta ; , tab ou |; respeita aspas). Devolve matriz de textos. */
export function parseCsv(texto) {
  texto = texto.replace(/^sep=.\r?\n/i, "");
  const primeira = texto.split(/\r?\n/, 1)[0];
  const cont = (ch) => primeira.split(ch).length - 1;
  const delim = [";", "\t", ",", "|"].sort((a, b) => cont(b) - cont(a))[0];
  const linhas = [];
  let linha = [], campo = "", aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false; }
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === delim) { linha.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      linha.push(campo); linhas.push(linha); linha = []; campo = "";
    } else campo += c;
  }
  if (campo !== "" || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

// ---------- normalização dos valores ----------
export const chaveNota = (v) => String(v ?? "").split(/[\/\-]/)[0].replace(/\D/g, "").replace(/^0+/, "");
const cnpjNorm = (v) => { const d = String(v ?? "").replace(/\D/g, ""); return d ? d.padStart(14, "0") : ""; };
const cfopNorm = (v) => String(v ?? "").replace(/\D/g, "").slice(0, 4);
const cstNorm = (v) => { const m = String(v ?? "").trim().match(/^0*(\d{1,2})(?!\d)/); return m ? m[1].padStart(2, "0") : ""; };
const codigoNorm = (v) => String(v ?? "").trim().toLowerCase().replace(/^0+(?=.)/, "");
export function numero(v) {
  if (typeof v === "number") return v;
  let s = String(v ?? "").replace(/[^\d,.\-]/g, "");
  if (!s) return NaN;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  return parseFloat(s);
}

function acharLinha(it, rows, mapa) {
  const livres = rows.filter((r) => !r.usada);
  if (mapa.codigo >= 0) {
    const c = codigoNorm(it.codigoProduto);
    const r = c && livres.find((x) => x.codigo === c);
    if (r) return r;
  }
  const d = norm(it.descricao);
  if (mapa.descricao >= 0 && d) {
    const r = livres.find((x) => norm(x.descricao) === d);
    if (r) return r;
  }
  if (mapa.item >= 0) {
    const r = livres.find((x) => x.item === Number(it.numeroItem));
    if (r) return r;
  }
  if (mapa.descricao >= 0 && d.length >= 5) {
    const r = livres.find((x) => { const y = norm(x.descricao); return y.length >= 5 && (y.includes(d) || d.includes(y)); });
    if (r) return r;
  }
  return null;
}

/**
 * notasApp: notas do app (com itens). linhas: [{ n: nº da linha na planilha, cells: [...] }] sem o cabeçalho.
 * mapa: { campo: índice da coluna ou -1 }.
 */
export function compararLote(notasApp, linhas, mapa) {
  const cel = (l, campo) => (mapa[campo] >= 0 ? l.cells[mapa[campo]] : undefined);
  const porNota = new Map();
  for (const l of linhas) {
    const k = chaveNota(cel(l, "nota"));
    if (!k) continue;
    if (!porNota.has(k)) porNota.set(k, []);
    porNota.get(k).push({
      n: l.n, nota: k, usada: false, reivindicada: false,
      cnpj: cnpjNorm(cel(l, "cnpj")),
      codigo: codigoNorm(cel(l, "codigo")),
      item: numero(cel(l, "item")),
      descricao: String(cel(l, "descricao") ?? "").trim(),
      cfop: cfopNorm(cel(l, "cfop")),
      cstPis: cstNorm(cel(l, "cstPis")),
      cstCofins: cstNorm(cel(l, "cstCofins")),
      valor: numero(cel(l, "valor")),
    });
  }

  const repetidas = new Map();
  notasApp.forEach((n) => repetidas.set(chaveNota(n.numero), (repetidas.get(chaveNota(n.numero)) || 0) + 1));
  const podeItens = mapa.codigo >= 0 || mapa.item >= 0 || mapa.descricao >= 0;

  const notas = notasApp.map((n) => {
    const k = chaveNota(n.numero);
    let rows = (porNota.get(k) || []).filter((r) => !r.reivindicada);
    if (mapa.cnpj >= 0) {
      const c = cnpjNorm(n.emitenteCnpj);
      rows = rows.filter((r) => !r.cnpj || r.cnpj === c);
    }
    rows.forEach((r) => { r.reivindicada = true; });

    const base = { id: n.id, numero: n.numero, fornecedor: n.emitenteNome, cnpj: n.emitenteCnpj, itens: [], sobrando: [], alertas: [], qtdProblemas: 0 };
    if (mapa.cnpj < 0 && repetidas.get(k) > 1) {
      base.alertas.push("Há outra nota com este mesmo número no lote. Indique a coluna do CNPJ para conferir com segurança.");
    }
    if (!rows.length) return { ...base, status: "ausente", qtdProblemas: 1 };

    if (!podeItens) {
      base.alertas.push("Sem coluna de código, item ou descrição: conferi só o número da nota e a quantidade de linhas.");
      if (rows.length !== n.itens.length) {
        base.alertas.push(`A planilha tem ${rows.length} linha(s) e o app tem ${n.itens.length} item(ns).`);
        return { ...base, status: "divergente", qtdProblemas: 1 };
      }
      return { ...base, status: "ok" };
    }

    for (const it of n.itens) {
      const r = acharLinha(it, rows, mapa);
      if (!r) { base.itens.push({ numeroItem: it.numeroItem, descricao: it.descricao, status: "faltando", problemas: [] }); continue; }
      r.usada = true;
      const problemas = [];
      if (mapa.cfop >= 0 && r.cfop !== it.cfopEntrada) problemas.push({ campo: "cfop", app: it.cfopEntrada, planilha: r.cfop });
      if (mapa.cstPis >= 0 && r.cstPis !== it.cstPis) problemas.push({ campo: "cstPis", app: it.cstPis, planilha: r.cstPis });
      if (mapa.cstCofins >= 0 && r.cstCofins !== it.cstCofins) problemas.push({ campo: "cstCofins", app: it.cstCofins, planilha: r.cstCofins });
      if (mapa.valor >= 0 && !(Math.abs(r.valor - it.valorProduto) <= 0.01)) problemas.push({ campo: "valor", app: it.valorProduto, planilha: r.valor });
      base.itens.push({
        numeroItem: it.numeroItem, descricao: it.descricao, status: problemas.length ? "divergente" : "ok",
        problemas, linha: r.n, descPlanilha: r.descricao,
      });
    }
    base.sobrando = rows.filter((r) => !r.usada).map((r) => ({ linha: r.n, descricao: r.descricao }));
    base.qtdProblemas = base.itens.filter((i) => i.status !== "ok").length + base.sobrando.length;
    return { ...base, status: base.qtdProblemas ? "divergente" : "ok" };
  });

  // linhas de notas que o lote não reivindicou (informativo)
  const extrasMapa = new Map();
  for (const rows of porNota.values()) {
    for (const r of rows) {
      if (r.reivindicada) continue;
      const e = extrasMapa.get(r.nota + "|" + r.cnpj) || { nota: r.nota, cnpj: r.cnpj, linhas: 0 };
      e.linhas += 1;
      extrasMapa.set(r.nota + "|" + r.cnpj, e);
    }
  }

  const itensDe = (st) => notas.reduce((s, n) => s + n.itens.filter((i) => i.status === st).length, 0);
  return {
    notas,
    extras: [...extrasMapa.values()],
    resumo: {
      notas: notas.length,
      notasOk: notas.filter((n) => n.status === "ok").length,
      notasDivergentes: notas.filter((n) => n.status === "divergente").length,
      notasAusentes: notas.filter((n) => n.status === "ausente").length,
      itensDivergentes: itensDe("divergente"),
      itensFaltando: itensDe("faltando"),
      linhasSobrando: notas.reduce((s, n) => s + n.sobrando.length, 0),
    },
  };
}
