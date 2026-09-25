// notas-ui.js — cartão de nota (caixa suspensa), edição na tela, ações e paginação.
// Usado pela Conferência e pelos XML arquivados.
import { getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from "./firebase-init.js";
import { CLASSIFICACOES, CST_ENTRADA, cfopEntradaSugerido, cstEntradaSugerido, chaveProduto } from "./regras.js";
import { gerarXmlAjustado, gerarPdf, baixarArquivo, gerarZipXmls } from "./exportacao.js";
import {
  estado, ehAdmin, docEmpresa, esc, moeda, formatarCnpj, competenciaDe, rotuloCompetencia, valorNota, ICONES,
} from "./estado.js";

const POR_PAGINA = 20;

const validadores = {
  cfopEntrada: (v) => /^[123]\d{3}$/.test(v),
  cstPis: (v) => CST_ENTRADA.includes(v),
  cstCofins: (v) => CST_ENTRADA.includes(v),
};
const itemValido = (i) =>
  CLASSIFICACOES.includes(i.classificacao) &&
  validadores.cfopEntrada(i.cfopEntrada) && validadores.cstPis(i.cstPis) && validadores.cstCofins(i.cstCofins);

function selo(i) {
  if (i.revisado) return '<span class="selo ok">Revisado</span>';
  if (i.origem === "cadastro") return '<span class="selo cad">Do cadastro</span>';
  if (i.origem === "manual") return '<span class="selo man">Editado</span>';
  return '<span class="selo sug">Sugestão</span>';
}

function htmlItem(i, idx) {
  const classe = i.revisado ? "" : !i.classificacao ? "sem-class" : i.origem === "sugestao" ? "sugestao" : "";
  const inv = (campo) => (validadores[campo](i[campo]) ? "" : "invalido");
  return `<tr data-idx="${idx}" class="${classe}" title="${esc(i.motivo)}">
    <td>${esc(i.numeroItem)}</td>
    <td class="desc">${esc(i.descricao)}<small>NCM ${esc(i.ncm)} · CST orig. ${esc(i.cstPisOrigem)}/${esc(i.cstCofinsOrigem)}</small></td>
    <td>${esc(i.cfopOrigem)}</td>
    <td><select data-campo="classificacao">
      <option value="">— escolher —</option>
      ${CLASSIFICACOES.map((c) => `<option ${c === i.classificacao ? "selected" : ""}>${c}</option>`).join("")}
    </select></td>
    <td><input data-campo="cfopEntrada" maxlength="4" value="${esc(i.cfopEntrada)}" class="${inv("cfopEntrada")}"></td>
    <td><input data-campo="cstPis" list="lista-cst" maxlength="2" value="${esc(i.cstPis)}" class="${inv("cstPis")}"></td>
    <td><input data-campo="cstCofins" list="lista-cst" maxlength="2" value="${esc(i.cstCofins)}" class="${inv("cstCofins")}"></td>
    <td class="celula-selo">${selo(i)}</td>
  </tr>`;
}

function htmlNota(n, abertas, selecionadas) {
  const pendentes = n.itens.filter((i) => !i.revisado).length;
  const qtd = n.itens.length;
  return `<details class="nota" data-id="${esc(n.id)}" ${abertas.has(n.id) ? "open" : ""}>
    <summary>
      <label class="chk-nota" onclick="event.stopPropagation()"><input type="checkbox" data-sel="${esc(n.id)}" ${selecionadas.has(n.id) ? "checked" : ""} aria-label="Selecionar NF ${esc(n.numero)}"></label>
      <span class="nota-titulo"><b>NF ${esc(n.numero)}</b> — ${esc(n.emitenteNome)}</span>
      <span class="nota-meta">${n.destNome ? `${esc(n.destNome)} · ` : ""}${rotuloCompetencia(competenciaDe(n))} · ${qtd} ${qtd === 1 ? "item" : "itens"} · ${moeda(valorNota(n))} · ${pendentes} a revisar</span>
      <span class="badge ${n.status}">${n.status === "revisada" ? "Revisada" : "Pendente"}</span>
      <span class="acoes">
        <button data-acao="salvar" class="btn-salvar ${n.sujo ? "destaque" : ""}">Salvar revisão</button>
        <button data-acao="xml">Gerar XML</button>
        <button data-acao="pdf" class="sec">PDF</button>
        ${ehAdmin() ? `<button data-acao="excluir" class="icone perigo" title="Excluir XML" aria-label="Excluir XML">${ICONES.lixeira}</button>` : ""}
      </span>
    </summary>
    <div class="tabela-itens">
      <table>
        <thead><tr><th>#</th><th>Item</th><th>CFOP orig.</th><th>Classificação</th>
          <th>CFOP entrada</th><th>CST PIS</th><th>CST COFINS</th><th>Situação</th></tr></thead>
        <tbody>${n.itens.map(htmlItem).join("")}</tbody>
      </table>
    </div>
  </details>`;
}

// Agrupa as notas da página por fornecedor: caixa do fornecedor > caixas das notas > itens
function htmlPorFornecedor(notas, abertas, fornAberto, prefixo = "", selecionadas) {
  const grupos = new Map();
  for (const n of notas) {
    const chave = n.emitenteCnpj || n.emitenteNome;
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(n);
  }
  return [...grupos].map(([chave, lista]) => {
    const pendentes = lista.reduce((s, n) => s + n.itens.filter((i) => !i.revisado).length, 0);
    const total = lista.reduce((s, n) => s + valorNota(n), 0);
    return `<details class="fornecedor" data-forn="${esc(prefixo + chave)}" ${fornAberto(prefixo + chave) ? "open" : ""}>
      <summary>
        <span class="forn-titulo"><b>${esc(lista[0].emitenteNome)}</b><small>${esc(formatarCnpj(lista[0].emitenteCnpj))}</small></span>
        <span class="nota-meta">${lista.length} ${lista.length === 1 ? "nota" : "notas"} · ${moeda(total)} · ${pendentes} item(ns) a revisar</span>
      </summary>
      <div class="forn-notas">${lista.map((n) => htmlNota(n, abertas, selecionadas)).join("")}</div>
    </details>`;
  }).join("");
}

function marcarAlterada(nota, det) {
  nota.sujo = true;
  nota.status = "pendente";
  const badge = det.querySelector(".badge");
  badge.className = "badge pendente";
  badge.textContent = "Pendente";
  det.querySelector(".btn-salvar").classList.add("destaque");
}

async function salvarRevisao(nota) {
  const invalidos = nota.itens.filter((i) => !itemValido(i)).map((i) => i.numeroItem);
  if (invalidos.length) {
    throw new Error(`Corrija antes de salvar — itens com classificação, CFOP ou CST inválido: ${invalidos.join(", ")}.`);
  }
  nota.itens.forEach((i) => { i.revisado = true; });
  nota.status = "revisada";
  nota.sujo = false;
  await updateDoc(docEmpresa("notas", nota.id), { itens: nota.itens, status: "revisada", revisadoEm: serverTimestamp() });

  // cadastra/atualiza os produtos desta empresa para as próximas importações
  const produtos = new Map();
  nota.itens.forEach((i) => produtos.set(chaveProduto(nota.emitenteCnpj, i.codigoProduto), i));
  await Promise.all([...produtos].map(([id, i]) => setDoc(docEmpresa("produtos", id), {
    cnpj: nota.emitenteCnpj, emitenteNome: nota.emitenteNome,
    codigoProduto: i.codigoProduto, descricao: i.descricao, ncm: i.ncm, cfopOrigem: i.cfopOrigem,
    classificacao: i.classificacao, cfopEntrada: i.cfopEntrada, cstPis: i.cstPis, cstCofins: i.cstCofins,
    atualizadoEm: serverTimestamp(),
  })));
}

async function gerarXml(nota) {
  if (nota.sujo && !confirm("Há alterações não salvas. Gerar o XML mesmo assim, com o que está na tela?")) return;
  const snap = await getDoc(docEmpresa("xmls", nota.id));
  if (!snap.exists()) throw new Error("XML original não encontrado no banco. Reimporte a nota.");
  const xml = gerarXmlAjustado(snap.data().xml, nota.itens);
  baixarArquivo(xml, `${nota.chaveAcesso || nota.numero}-ajustado.xml`, "application/xml");
}

async function excluirNota(nota) {
  if (!confirm(`Excluir a NF ${nota.numero} (${nota.emitenteNome})?\nO XML e a revisão serão apagados e não dá para desfazer.`)) return false;
  await Promise.all([deleteDoc(docEmpresa("notas", nota.id)), deleteDoc(docEmpresa("xmls", nota.id))]);
  estado.notas = estado.notas.filter((n) => n.id !== nota.id);
  estado.sessao.delete(nota.id);
  return true;
}

async function excluirNotas(notas) {
  if (!confirm(`Excluir ${notas.length} nota(s) selecionada(s)?\nO XML e a revisão de cada uma serão apagados e não dá para desfazer.`)) return false;
  await Promise.all(notas.flatMap((n) => [deleteDoc(docEmpresa("notas", n.id)), deleteDoc(docEmpresa("xmls", n.id))]));
  const idsExcluidos = new Set(notas.map((n) => n.id));
  estado.notas = estado.notas.filter((n) => !idsExcluidos.has(n.id));
  idsExcluidos.forEach((id) => estado.sessao.delete(id));
  return true;
}

/**
 * Cria uma lista paginada (20 notas por página) dentro de `raiz`.
 * obter(): devolve as notas já filtradas/ordenadas. agrupar: título por competência.
 * vazio: texto (ou função que devolve o texto) mostrado quando não há notas.
 * zipNomeSelecionados: nome do .zip gerado ao baixar as notas marcadas.
 */
export function criarLista({
  raiz, paginacao, obter, vazio, agrupar = false, porFornecedor = false, fornecedoresAbertos = true,
  zipNomeSelecionados = "xmls-selecionados.zip",
}) {
  let pagina = 0;
  let visiveis = [];
  const abertas = new Set();      // notas com a caixa aberta
  const selecionadas = new Set(); // ids marcados na caixa de seleção (para baixar/excluir em lote)
  // fornecedores que você abriu/fechou em relação ao padrão (aberto na Conferência, fechado nos arquivados)
  const fornAlterados = new Set();
  const fornAberto = (chave) => fornecedoresAbertos !== fornAlterados.has(chave);
  const acharNota = (el) => estado.notas.find((n) => n.id === el.closest("details").dataset.id);
  const textoVazio = () => (typeof vazio === "function" ? vazio() : vazio);

  function htmlBarraSelecao() {
    if (!visiveis.length) return "";
    const n = selecionadas.size;
    const todasMarcadas = visiveis.every((x) => selecionadas.has(x.id));
    return `<div class="barra barra-selecao">
      <label><input type="checkbox" data-marcar-todas ${todasMarcadas ? "checked" : ""}> Selecionar todas desta página</label>
      <span class="nota-meta">${n} selecionada(s)</span>
      <button type="button" data-lote="zip" class="sec" ${n ? "" : "disabled"}>Baixar selecionadas (.zip)</button>
      ${ehAdmin() ? `<button type="button" data-lote="excluir" class="perigo" ${n ? "" : "disabled"}>Excluir selecionadas</button>` : ""}
    </div>`;
  }

  function render(zerar = false) {
    if (zerar) pagina = 0;
    const lista = obter();
    const totalPag = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
    pagina = Math.min(pagina, totalPag - 1);
    visiveis = lista.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA);
    for (const id of [...selecionadas]) if (!estado.notas.some((n) => n.id === id)) selecionadas.delete(id);

    let html = "";
    let comp = null;
    const cabecalho = (c) => {
      const doMes = lista.filter((x) => competenciaDe(x) === c);
      return `<h4 class="grupo">${rotuloCompetencia(c)} <small>${doMes.length} XML(s) · ${moeda(doMes.reduce((s, x) => s + valorNota(x), 0))}</small></h4>`;
    };
    if (porFornecedor && agrupar) {
      // competência > fornecedor > nota (visiveis já vem ordenado por competência)
      const porComp = new Map();
      for (const n of visiveis) {
        const c = competenciaDe(n);
        if (!porComp.has(c)) porComp.set(c, []);
        porComp.get(c).push(n);
      }
      for (const [c, doMes] of porComp) html += cabecalho(c) + htmlPorFornecedor(doMes, abertas, fornAberto, c + "|", selecionadas);
    } else if (porFornecedor) html = htmlPorFornecedor(visiveis, abertas, fornAberto, "", selecionadas);
    else for (const n of visiveis) {
      if (agrupar && competenciaDe(n) !== comp) {
        comp = competenciaDe(n);
        const doMes = lista.filter((x) => competenciaDe(x) === comp);
        html += `<h4 class="grupo">${rotuloCompetencia(comp)} <small>${doMes.length} XML(s) · ${moeda(doMes.reduce((s, x) => s + valorNota(x), 0))}</small></h4>`;
      }
      html += htmlNota(n, abertas, selecionadas);
    }
    raiz.innerHTML = htmlBarraSelecao() + (html || `<p class="vazio">${esc(textoVazio())}</p>`);
    paginacao.innerHTML = `
      <button data-pag="-1" class="sec" ${pagina === 0 ? "disabled" : ""}>Anterior</button>
      <span>Página ${pagina + 1} de ${totalPag} · ${lista.length} nota(s)</span>
      <button data-pag="1" class="sec" ${pagina >= totalPag - 1 ? "disabled" : ""}>Próxima</button>`;
  }

  // com fornecedores agrupados, redesenha a lista toda para atualizar os totais do fornecedor
  function atualizarNota(nota) {
    if (porFornecedor) render();
    else renderNota(nota);
  }

  function renderNota(nota) {
    const el = raiz.querySelector(`details[data-id="${CSS.escape(nota.id)}"]`);
    if (el) el.outerHTML = htmlNota(nota, abertas, selecionadas);
  }

  paginacao.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-pag]");
    if (!b) return;
    pagina += Number(b.dataset.pag);
    render();
    window.scrollTo({ top: 0 });
  });

  // lembra quais caixas estão abertas ("toggle" não borbulha, por isso captura)
  raiz.addEventListener("toggle", (e) => {
    const d = e.target;
    if (!d.matches) return;
    if (d.matches("details.nota")) d.open ? abertas.add(d.dataset.id) : abertas.delete(d.dataset.id);
    else if (d.matches("details.fornecedor")) d.open === fornecedoresAbertos ? fornAlterados.delete(d.dataset.forn) : fornAlterados.add(d.dataset.forn);
  }, true);

  raiz.addEventListener("change", (e) => {
    if (e.target.matches("input[data-sel]")) {
      const id = e.target.dataset.sel;
      if (e.target.checked) selecionadas.add(id); else selecionadas.delete(id);
      render();
      return;
    }
    if (e.target.matches("input[data-marcar-todas]")) {
      if (e.target.checked) visiveis.forEach((n) => selecionadas.add(n.id));
      else visiveis.forEach((n) => selecionadas.delete(n.id));
      render();
      return;
    }
    const campo = e.target.dataset.campo;
    if (!campo) return;
    const det = e.target.closest("details");
    const tr = e.target.closest("tr");
    const nota = acharNota(e.target);
    const item = nota.itens[Number(tr.dataset.idx)];
    const valor = e.target.value.trim();

    item.revisado = false;
    item.origem = "manual";

    if (campo === "classificacao") {
      // trocou a classificação: recalcula CFOP e CST sugeridos (ainda dá para ajustar)
      item.classificacao = valor;
      item.cfopEntrada = cfopEntradaSugerido(item.cfopOrigem, valor);
      const cst = cstEntradaSugerido(valor, item.ncm, item.cstPisOrigem);
      item.cstPis = item.cstCofins = cst.cst;
      item.motivo = cst.motivo;
      marcarAlterada(nota, det);
      atualizarNota(nota);
      return;
    }

    if (campo === "cstPis" && item.cstCofins === item.cstPis) item.cstCofins = valor; // COFINS acompanha o PIS
    item[campo] = valor;
    e.target.classList.toggle("invalido", !validadores[campo](valor));
    const cof = tr.querySelector('[data-campo="cstCofins"]');
    cof.value = item.cstCofins;
    cof.classList.toggle("invalido", !validadores.cstCofins(item.cstCofins));
    tr.querySelector(".celula-selo").innerHTML = selo(item);
    marcarAlterada(nota, det);
  });

  raiz.addEventListener("click", async (e) => {
    const loteBtn = e.target.closest("button[data-lote]");
    if (loteBtn) {
      const notas = estado.notas.filter((n) => selecionadas.has(n.id));
      if (!notas.length) return;
      const original = loteBtn.textContent;
      loteBtn.disabled = true;
      try {
        if (loteBtn.dataset.lote === "zip") {
          await gerarZipXmls(notas, zipNomeSelecionados, (feito, total) => { loteBtn.textContent = `Baixando ${feito}/${total}...`; });
        } else if (loteBtn.dataset.lote === "excluir") {
          if (await excluirNotas(notas)) { notas.forEach((n) => selecionadas.delete(n.id)); render(); }
        }
      } catch (err) {
        alert("Erro: " + err.message);
      } finally {
        loteBtn.textContent = original;
        loteBtn.disabled = false;
      }
      return;
    }

    const btn = e.target.closest("button[data-acao]");
    if (!btn) return;
    e.preventDefault(); // não deixa o clique abrir/fechar a caixa
    const nota = acharNota(btn);
    btn.disabled = true;
    try {
      const acao = btn.dataset.acao;
      if (acao === "salvar") { await salvarRevisao(nota); atualizarNota(nota); }
      else if (acao === "xml") await gerarXml(nota);
      else if (acao === "excluir") { if (await excluirNota(nota)) render(); }
      else gerarPdf([nota], `analise-nf-${nota.numero}.pdf`, `Análise de NF-e - ${estado.empresa.nome}`);
    } catch (err) {
      alert("Erro: " + err.message);
      if (btn.dataset.acao === "salvar") { abertas.add(nota.id); atualizarNota(nota); }
    } finally {
      btn.disabled = false;
    }
  });

  return { render, visiveis: () => visiveis };
}
