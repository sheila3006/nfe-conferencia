// analista.js — Analista: confere as notas revisadas no app contra a planilha exportada do seu sistema.
import { estado, $, esc, moeda, formatarCnpj, competenciaDe, rotuloCompetencia } from "./estado.js";
import { CAMPOS, detectarCabecalho, sugerirMapa, compararLote, parseCsv } from "./analise.js";

const ROTULO_CAMPO = { cfop: "CFOP", cstPis: "CST PIS", cstCofins: "CST COFINS", valor: "Valor do item" };
const ROTULO_STATUS = { ok: "Tudo certo", divergente: "Divergência", ausente: "Ausente na planilha" };
const chaveMemoria = () => `mapa-planilha-${estado.empresa.id}`;

let planilha = null;      // { nome, wb, abas, dados, aba, linhas }
let mapa = {};            // campo -> índice da coluna (-1 = não usar)
let resultado = null;
let empresaDaTela = null;

const letra = (i) => { let s = ""; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
const decodificar = (buf) => {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); }
  catch (_) { return new TextDecoder("windows-1252").decode(buf); }
};

export function iniciarAnalista() {
  $("an-origem").addEventListener("change", atualizarContagem);
  $("an-so-revisadas").addEventListener("change", atualizarContagem);
  $("an-arquivo").addEventListener("change", lerArquivo);
  $("an-aba").addEventListener("change", () => escolherAba($("an-aba").value));
  $("an-cabecalho").addEventListener("change", montarMapa);
  $("an-mapa").addEventListener("change", (e) => {
    const campo = e.target.dataset.campo;
    if (!campo) return;
    mapa[campo] = Number(e.target.value);
    salvarMapa();
  });
  $("an-comparar").addEventListener("click", comparar);
  $("an-mostrar-ok").addEventListener("change", renderResultado);
  $("an-xlsx").addEventListener("click", exportarExcel);
  $("an-pdf").addEventListener("click", exportarPdf);
}

export function renderAnalista() {
  if (empresaDaTela !== estado.empresa.id) { // trocou de empresa: começa limpo
    empresaDaTela = estado.empresa.id;
    planilha = null; resultado = null; mapa = {};
    $("an-arquivo").value = "";
    $("an-config").classList.add("oculto");
    $("an-resultado").classList.add("oculto");
  }
  const sel = $("an-origem");
  const anterior = sel.value;
  const comps = [...new Set(estado.notas.map(competenciaDe))].sort().reverse();
  sel.innerHTML = `<option value="sessao">Notas importadas nesta sessão (${estado.sessao.size})</option>` +
    comps.map((c) => `<option value="${c}">Competência ${rotuloCompetencia(c)} (${estado.notas.filter((n) => competenciaDe(n) === c).length} notas)</option>`).join("");
  const existe = [...sel.options].some((o) => o.value === anterior);
  sel.value = existe ? anterior : (estado.sessao.size || !comps.length ? "sessao" : comps[0]);
  atualizarContagem();
}

// ---------- 1) notas do app ----------
function notasSelecionadas() {
  const origem = $("an-origem").value;
  const lista = origem === "sessao"
    ? estado.notas.filter((n) => estado.sessao.has(n.id))
    : estado.notas.filter((n) => competenciaDe(n) === origem);
  return $("an-so-revisadas").checked ? lista.filter((n) => n.status === "revisada") : lista;
}

function atualizarContagem() {
  const origem = $("an-origem").value;
  const todas = origem === "sessao" ? estado.notas.filter((n) => estado.sessao.has(n.id)) : estado.notas.filter((n) => competenciaDe(n) === origem);
  const sel = notasSelecionadas();
  const itens = sel.reduce((s, n) => s + n.itens.length, 0);
  const fora = todas.length - sel.length;
  $("an-contagem").textContent = `${sel.length} nota(s) e ${itens} item(ns) serão conferidos` +
    (fora ? ` — ${fora} nota(s) pendente(s) de revisão ficaram de fora.` : ".");
}

// ---------- 2) planilha ----------
async function lerArquivo(e) {
  const arq = e.target.files[0];
  if (!arq) return;
  try {
    const buf = await arq.arrayBuffer();
    if (/\.(csv|txt)$/i.test(arq.name)) {
      planilha = { nome: arq.name, wb: null, abas: ["CSV"], dados: { CSV: parseCsv(decodificar(buf)) } };
    } else {
      if (typeof XLSX === "undefined") throw new Error("A biblioteca de planilhas não carregou. Verifique a internet e recarregue a página.");
      const wb = XLSX.read(buf, { type: "array" });
      planilha = { nome: arq.name, wb, abas: wb.SheetNames, dados: {} };
    }
    $("an-aba").innerHTML = planilha.abas.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join("");
    resultado = null;
    $("an-resultado").classList.add("oculto");
    $("an-config").classList.remove("oculto");
    escolherAba(planilha.abas[0]);
  } catch (err) {
    planilha = null;
    alert("Não foi possível ler a planilha: " + err.message);
  }
}

function escolherAba(nome) {
  if (!planilha.dados[nome]) {
    planilha.dados[nome] = XLSX.utils.sheet_to_json(planilha.wb.Sheets[nome], { header: 1, raw: true, defval: "" });
  }
  planilha.aba = nome;
  planilha.linhas = planilha.dados[nome];
  $("an-cabecalho").value = detectarCabecalho(planilha.linhas) + 1;
  montarMapa();
}

const cabecalhosAtuais = () => {
  const cab = Math.max(0, Number($("an-cabecalho").value) - 1);
  return (planilha.linhas[cab] || []).map((c) => String(c ?? "").trim());
};

function montarMapa() {
  const cabecalhos = cabecalhosAtuais();
  let salvo = {};
  try { salvo = JSON.parse(localStorage.getItem(chaveMemoria()) || "{}"); } catch (_) { /* ignora */ }
  const sugerido = sugerirMapa(cabecalhos);
  mapa = {};
  for (const c of CAMPOS) {
    let idx = sugerido[c.id];
    if (c.id in salvo) { // lembra a escolha feita da última vez, pelo título da coluna
      if (salvo[c.id] === null) idx = -1;
      else if (cabecalhos.includes(salvo[c.id])) idx = cabecalhos.indexOf(salvo[c.id]);
    }
    mapa[c.id] = idx;
  }
  $("an-mapa").innerHTML = CAMPOS.map((c) => `<label>${esc(c.rotulo)}${c.obrigatorio ? " *" : ""}
    <select data-campo="${c.id}"><option value="-1">— não usar —</option>${
      cabecalhos.map((h, i) => `<option value="${i}" ${mapa[c.id] === i ? "selected" : ""}>${letra(i)}: ${esc(h || "(sem título)")}</option>`).join("")
    }</select></label>`).join("");
}

function salvarMapa() {
  const cabecalhos = cabecalhosAtuais();
  const obj = {};
  for (const c of CAMPOS) obj[c.id] = mapa[c.id] >= 0 ? cabecalhos[mapa[c.id]] : null;
  try { localStorage.setItem(chaveMemoria(), JSON.stringify(obj)); } catch (_) { /* ignora */ }
}

// ---------- 3) comparar ----------
function comparar() {
  const notas = notasSelecionadas();
  if (!notas.length) return alert("Não há notas para conferir com este filtro. Escolha outra origem ou desmarque “Só notas revisadas”.");
  if (!planilha) return alert("Envie a planilha do sistema primeiro.");
  if (mapa.nota < 0) return alert("Indique a coluna do número da nota.");
  salvarMapa();
  const cab = Math.max(0, Number($("an-cabecalho").value) - 1);
  const linhas = planilha.linhas.slice(cab + 1)
    .map((cells, i) => ({ n: cab + 2 + i, cells }))
    .filter((l) => l.cells.some((c) => String(c ?? "").trim() !== ""));
  resultado = compararLote(notas, linhas, mapa);
  renderResultado();
  $("an-resultado").scrollIntoView({ behavior: "smooth" });
}

const fmt = (campo, v) => (campo === "valor" ? (Number.isNaN(v) ? "(vazio)" : moeda(v)) : (v === "" || v == null ? "(vazio)" : String(v)));

function htmlNotaAnalise(n) {
  const mostrarOk = $("an-mostrar-ok").checked;
  const linhas = [];
  for (const it of n.itens) {
    if (it.status === "ok" && !mostrarOk) continue;
    const ctx = it.descPlanilha ? `<small>Planilha (linha ${it.linha}): ${esc(it.descPlanilha)}</small>` : (it.linha ? `<small>Planilha: linha ${it.linha}</small>` : "");
    const detalhe = it.status === "ok" ? "Confere"
      : it.status === "faltando" ? "Item não encontrado na planilha"
      : it.problemas.map((p) => `${ROTULO_CAMPO[p.campo]}: app <b>${esc(fmt(p.campo, p.app))}</b> · planilha <b>${esc(fmt(p.campo, p.planilha))}</b>`).join("<br>");
    const cls = it.status === "ok" ? "ok" : it.status === "faltando" ? "sug" : "man";
    const rot = it.status === "ok" ? "OK" : it.status === "faltando" ? "Faltando" : "Divergente";
    linhas.push(`<tr><td>${esc(it.numeroItem)}</td><td>${esc(it.descricao)}${ctx}</td><td><span class="selo ${cls}">${rot}</span></td><td>${detalhe}</td></tr>`);
  }
  for (const s of n.sobrando) {
    linhas.push(`<tr><td>—</td><td>${esc(s.descricao) || "(sem descrição)"}<small>Planilha: linha ${s.linha}</small></td><td><span class="selo sug">Sobrando</span></td><td>Linha da planilha sem item correspondente no app</td></tr>`);
  }
  const corpo = n.status === "ausente"
    ? '<p class="nota-ajuda" style="padding:0 14px 14px">Esta nota não foi encontrada na planilha.</p>'
    : `${n.alertas.map((a) => `<p class="nota-ajuda" style="padding:0 14px">Atenção: ${esc(a)}</p>`).join("")}
       <div class="tabela-itens"><table><thead><tr><th>#</th><th>Item</th><th>Situação</th><th>Detalhe</th></tr></thead>
       <tbody>${linhas.join("") || '<tr><td colspan="4" class="vazio">Nenhum problema nos itens.</td></tr>'}</tbody></table></div>`;
  return `<details class="nota"><summary>
      <span class="nota-titulo"><b>NF ${esc(n.numero)}</b> — ${esc(n.fornecedor)}</span>
      <span class="nota-meta">${n.qtdProblemas ? `${n.qtdProblemas} problema(s)` : "sem problemas"}</span>
      <span class="badge ${n.status}">${ROTULO_STATUS[n.status]}</span></summary>${corpo}</details>`;
}

function renderResultado() {
  if (!resultado) return;
  const r = resultado, s = r.resumo;
  $("an-resultado").classList.remove("oculto");
  $("an-kpis").innerHTML = [
    ["Notas conferidas", s.notas], ["Notas sem divergência", s.notasOk], ["Notas com divergência", s.notasDivergentes],
    ["Notas ausentes na planilha", s.notasAusentes], ["Itens divergentes", s.itensDivergentes],
    ["Itens faltando / linhas sobrando", `${s.itensFaltando} / ${s.linhasSobrando}`],
  ].map(([rot, v]) => `<div class="kpi"><span>${rot}</span><b>${v}</b></div>`).join("");

  const ordem = { ausente: 0, divergente: 1, ok: 2 };
  $("an-lista").innerHTML = r.notas.slice().sort((a, b) => ordem[a.status] - ordem[b.status]).map(htmlNotaAnalise).join("");

  $("an-extras").innerHTML = r.extras.length
    ? `<details class="nota"><summary><span class="nota-titulo"><b>Notas na planilha que não estão neste lote (${r.extras.length})</b></span>
        <span class="nota-meta">Normal se a planilha tiver mais notas do que as conferidas.</span></summary>
        <div class="tabela-itens"><table><thead><tr><th>Nota</th><th>CNPJ</th><th>Linhas</th></tr></thead><tbody>${
          r.extras.map((e) => `<tr><td>${esc(e.nota)}</td><td>${esc(formatarCnpj(e.cnpj)) || "—"}</td><td>${e.linhas}</td></tr>`).join("")
        }</tbody></table></div></details>`
    : "";
}

// ---------- exportação ----------
function linhasRelatorio() {
  const out = [];
  for (const n of resultado.notas) {
    const b = [n.numero, n.fornecedor, formatarCnpj(n.cnpj)];
    if (n.status === "ausente") { out.push([...b, "", "", "Nota não encontrada na planilha", "", "", ""]); continue; }
    for (const it of n.itens) {
      if (it.status === "faltando") out.push([...b, it.numeroItem, it.descricao, "Item não encontrado na planilha", "", "", ""]);
      for (const p of it.problemas) out.push([...b, it.numeroItem, it.descricao, ROTULO_CAMPO[p.campo], fmt(p.campo, p.app), fmt(p.campo, p.planilha), it.linha]);
    }
    for (const sb of n.sobrando) out.push([...b, "", sb.descricao, "Linha sobrando na planilha", "", "", sb.linha]);
    for (const a of n.alertas) out.push([...b, "", "", "Atenção: " + a, "", "", ""]);
  }
  return out;
}
const CABECALHO_REL = ["Nota", "Fornecedor", "CNPJ", "Item", "Descrição", "Problema", "No app", "Na planilha", "Linha na planilha"];

function exportarExcel() {
  const linhas = linhasRelatorio();
  if (!linhas.length) return alert("Nenhuma divergência para exportar.");
  const ws = XLSX.utils.aoa_to_sheet([CABECALHO_REL, ...linhas]);
  ws["!cols"] = [10, 34, 20, 6, 40, 36, 14, 14, 10].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Divergências");
  XLSX.writeFile(wb, "conferencia-planilha.xlsx");
}

function exportarPdf() {
  const linhas = linhasRelatorio();
  if (!linhas.length) return alert("Nenhuma divergência para exportar.");
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const s = resultado.resumo;
  pdf.setFontSize(14);
  pdf.text(`Conferência com a planilha - ${estado.empresa.nome}`, 30, 34);
  pdf.setFontSize(9);
  pdf.text(`Planilha: ${planilha.nome}  |  ${s.notas} nota(s): ${s.notasOk} ok, ${s.notasDivergentes} com divergência, ${s.notasAusentes} ausente(s)`, 30, 50);
  pdf.autoTable({
    startY: 60, margin: { left: 30, right: 30, bottom: 30 },
    styles: { fontSize: 8, cellPadding: 3 }, headStyles: { fillColor: [15, 42, 90] },
    head: [CABECALHO_REL], body: linhas,
  });
  pdf.save("conferencia-planilha.pdf");
}
