import {
  auth, db,
  signInWithEmailAndPassword, onAuthStateChanged, signOut,
  collection, doc, setDoc, getDoc, getDocs, updateDoc, query, orderBy, serverTimestamp,
} from "./firebase-init.js";
import { parseNFeXml } from "./parser.js";
import {
  CLASSIFICACOES, CST_ENTRADA, classificarItem, cfopEntradaSugerido,
  cstEntradaSugerido, chaveProduto,
} from "./regras.js";
import { gerarXmlAjustado, gerarPdf, baixarArquivo } from "./exportacao.js";

const POR_PAGINA = 20;
const $ = (id) => document.getElementById(id);
const loginView = $("login-view"), appView = $("app-view"), userInfo = $("user-info");
const loginErro = $("login-erro"), inputXml = $("input-xml"), statusImport = $("status-import");
const listaNotas = $("lista-notas"), paginacao = $("paginacao"), filtroStatus = $("filtro-status");

$("lista-cst").innerHTML = CST_ENTRADA.map((c) => `<option value="${c}">`).join("");

let notas = [];          // todas as notas carregadas (mais recentes primeiro)
let pagina = 0;
let visiveis = [];       // notas da página atual
const abertas = new Set(); // notas com a caixa aberta

// ---------- utilidades ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const moeda = (v) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const validadores = {
  cfopEntrada: (v) => /^[123]\d{3}$/.test(v),
  cstPis: (v) => CST_ENTRADA.includes(v),
  cstCofins: (v) => CST_ENTRADA.includes(v),
};
const itemValido = (i) =>
  CLASSIFICACOES.includes(i.classificacao) &&
  validadores.cfopEntrada(i.cfopEntrada) && validadores.cstPis(i.cstPis) && validadores.cstCofins(i.cstCofins);

// ---------- login ----------
onAuthStateChanged(auth, (user) => {
  loginView.classList.toggle("oculto", !!user);
  appView.classList.toggle("oculto", !user);
  userInfo.classList.toggle("oculto", !user);
  if (user) {
    $("usuario-label").textContent = user.email;
    carregarNotas();
  }
});

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  loginErro.textContent = "";
  try {
    await signInWithEmailAndPassword(auth, $("login-email").value, $("login-senha").value);
  } catch (err) {
    loginErro.textContent = "Não foi possível entrar: " + err.message;
  }
});
$("btn-sair").addEventListener("click", () => signOut(auth));

// ---------- importação ----------
async function montarItem(nota, item) {
  const cad = await getDoc(doc(db, "produtos", chaveProduto(nota.emitente.cnpj, item.codigoProduto)));
  let classificacao, cfopEntrada, cstPis, cstCofins, origem, motivo;

  if (cad.exists()) {
    const c = cad.data();
    classificacao = c.classificacao;
    cfopEntrada = c.cfopOrigem === item.cfop ? c.cfopEntrada : cfopEntradaSugerido(item.cfop, classificacao);
    cstPis = c.cstPis;
    cstCofins = c.cstCofins;
    origem = "cadastro";
    motivo = "Item já revisado anteriormente (cadastro de produtos).";
  } else {
    const s = classificarItem(item);
    classificacao = s.classificacao;
    cfopEntrada = cfopEntradaSugerido(item.cfop, classificacao);
    const cst = cstEntradaSugerido(classificacao, item.ncm, item.cstPis);
    cstPis = cstCofins = cst.cst;
    origem = "sugestao";
    motivo = `${s.motivo} ${cst.motivo}`;
  }

  return {
    numeroItem: item.numeroItem, codigoProduto: item.codigoProduto, descricao: item.descricao,
    ncm: item.ncm, valorProduto: item.valorProduto,
    cfopOrigem: item.cfop, cstPisOrigem: item.cstPis, cstCofinsOrigem: item.cstCofins,
    classificacao, cfopEntrada, cstPis, cstCofins, origem, motivo, revisado: false,
  };
}

inputXml.addEventListener("change", async (e) => {
  const arquivos = Array.from(e.target.files || []);
  const avisos = [];

  for (let n = 0; n < arquivos.length; n++) {
    const arq = arquivos[n];
    statusImport.textContent = `Processando ${n + 1} de ${arquivos.length}: ${arq.name}`;
    try {
      const xml = await arq.text();
      if (new Blob([xml]).size > 900000) throw new Error("XML maior que 900 KB (limite do Firestore).");
      const nota = parseNFeXml(xml);
      const id = nota.chaveAcesso || `${nota.emitente.cnpj}_${nota.numero}`;

      const existente = await getDoc(doc(db, "notas", id));
      if (existente.exists() &&
          !confirm(`A nota ${nota.numero} já foi importada. Reimportar e perder a revisão feita?`)) {
        avisos.push(`${arq.name}: já importada, ignorada.`);
        continue;
      }

      const itens = await Promise.all(nota.itens.map((it) => montarItem(nota, it)));
      const registro = {
        chaveAcesso: nota.chaveAcesso, numero: nota.numero, serie: nota.serie,
        dataEmissao: nota.dataEmissao, valorTotal: nota.valorTotal,
        emitenteNome: nota.emitente.nome, emitenteCnpj: nota.emitente.cnpj, emitenteCrt: nota.emitente.crt,
        itens, status: "pendente",
      };
      await setDoc(doc(db, "notas", id), { ...registro, criadoEm: serverTimestamp() });
      await setDoc(doc(db, "xmls", id), { xml, criadoEm: serverTimestamp() });

      notas = [{ id, ...registro }, ...notas.filter((x) => x.id !== id)];
    } catch (err) {
      avisos.push(`${arq.name}: ${err.message}`);
    }
  }

  inputXml.value = "";
  statusImport.textContent = arquivos.length ? "Importação concluída." : "";
  pagina = 0;
  render();
  if (avisos.length) alert(avisos.join("\n"));
});

// ---------- carregar / renderizar ----------
async function carregarNotas() {
  const snap = await getDocs(query(collection(db, "notas"), orderBy("criadoEm", "desc")));
  notas = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  pagina = 0;
  render();
}

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

function htmlNota(n) {
  const pendentes = n.itens.filter((i) => !i.revisado).length;
  return `<details class="nota" data-id="${esc(n.id)}" ${abertas.has(n.id) ? "open" : ""}>
    <summary>
      <span class="nota-titulo"><b>NF ${esc(n.numero)}</b> — ${esc(n.emitenteNome)}</span>
      <span class="nota-meta">${n.itens.length} itens · ${moeda(n.valorTotal)} · ${pendentes} a revisar</span>
      <span class="badge ${n.status}">${n.status === "revisada" ? "Revisada" : "Pendente"}</span>
      <span class="acoes">
        <button data-acao="salvar" class="btn-salvar ${n.sujo ? "destaque" : ""}">Salvar revisão</button>
        <button data-acao="xml">Gerar XML</button>
        <button data-acao="pdf" class="sec">PDF</button>
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

function render() {
  const f = filtroStatus.value;
  const lista = notas.filter((n) => f === "todas" || n.status === f);
  const totalPag = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  pagina = Math.min(pagina, totalPag - 1);
  visiveis = lista.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA);

  listaNotas.innerHTML = visiveis.length
    ? visiveis.map(htmlNota).join("")
    : "<p>Nenhuma nota nesta lista. Envie os XMLs acima para começar.</p>";
  paginacao.innerHTML = `
    <button data-pag="-1" class="sec" ${pagina === 0 ? "disabled" : ""}>Anterior</button>
    <span>Página ${pagina + 1} de ${totalPag} · ${lista.length} nota(s)</span>
    <button data-pag="1" class="sec" ${pagina >= totalPag - 1 ? "disabled" : ""}>Próxima</button>`;
}

function renderNota(nota) {
  const el = listaNotas.querySelector(`details[data-id="${CSS.escape(nota.id)}"]`);
  if (el) el.outerHTML = htmlNota(nota);
}

filtroStatus.addEventListener("change", () => { pagina = 0; render(); });
paginacao.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-pag]");
  if (!b) return;
  pagina += Number(b.dataset.pag);
  render();
  window.scrollTo({ top: 0 });
});
$("btn-pdf-pagina").addEventListener("click", () => {
  if (!visiveis.length) return alert("Não há notas na página para gerar o PDF.");
  gerarPdf(visiveis, `analise-nfe-pagina-${pagina + 1}.pdf`);
});

// lembra quais caixas estão abertas (o evento "toggle" não borbulha, por isso captura)
listaNotas.addEventListener("toggle", (e) => {
  const d = e.target;
  if (!d.matches || !d.matches("details.nota")) return;
  d.open ? abertas.add(d.dataset.id) : abertas.delete(d.dataset.id);
}, true);

// ---------- edição na tela ----------
function marcarAlterada(nota, det) {
  nota.sujo = true;
  nota.status = "pendente";
  const badge = det.querySelector(".badge");
  badge.className = "badge pendente";
  badge.textContent = "Pendente";
  det.querySelector(".btn-salvar").classList.add("destaque");
}

listaNotas.addEventListener("change", (e) => {
  const campo = e.target.dataset.campo;
  if (!campo) return;
  const det = e.target.closest("details");
  const tr = e.target.closest("tr");
  const nota = notas.find((n) => n.id === det.dataset.id);
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
    renderNota(nota);
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

// ---------- ações por nota ----------
listaNotas.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-acao]");
  if (!btn) return;
  e.preventDefault(); // não deixa o clique abrir/fechar a caixa
  const nota = notas.find((n) => n.id === btn.closest("details").dataset.id);
  btn.disabled = true;
  try {
    if (btn.dataset.acao === "salvar") await salvarRevisao(nota);
    else if (btn.dataset.acao === "xml") await gerarXml(nota);
    else gerarPdf([nota], `analise-nf-${nota.numero}.pdf`);
  } catch (err) {
    alert("Erro: " + err.message);
  } finally {
    btn.disabled = false;
  }
});

async function salvarRevisao(nota) {
  const invalidos = nota.itens.filter((i) => !itemValido(i)).map((i) => i.numeroItem);
  if (invalidos.length) {
    abertas.add(nota.id);
    renderNota(nota);
    alert(`Corrija antes de salvar — itens com classificação, CFOP ou CST inválido: ${invalidos.join(", ")}.`);
    return;
  }

  nota.itens.forEach((i) => { i.revisado = true; });
  nota.status = "revisada";
  nota.sujo = false;
  await updateDoc(doc(db, "notas", nota.id), { itens: nota.itens, status: "revisada", revisadoEm: serverTimestamp() });

  // cadastra/atualiza os produtos para as próximas importações
  const produtos = new Map();
  nota.itens.forEach((i) => produtos.set(chaveProduto(nota.emitenteCnpj, i.codigoProduto), i));
  await Promise.all([...produtos].map(([id, i]) => setDoc(doc(db, "produtos", id), {
    cnpj: nota.emitenteCnpj, emitenteNome: nota.emitenteNome,
    codigoProduto: i.codigoProduto, descricao: i.descricao, ncm: i.ncm, cfopOrigem: i.cfopOrigem,
    classificacao: i.classificacao, cfopEntrada: i.cfopEntrada, cstPis: i.cstPis, cstCofins: i.cstCofins,
    atualizadoEm: serverTimestamp(),
  })));

  renderNota(nota);
}

async function gerarXml(nota) {
  if (nota.sujo && !confirm("Há alterações não salvas. Gerar o XML mesmo assim, com o que está na tela?")) return;
  const snap = await getDoc(doc(db, "xmls", nota.id));
  if (!snap.exists()) throw new Error("XML original não encontrado no banco. Reimporte a nota.");
  const xml = gerarXmlAjustado(snap.data().xml, nota.itens);
  baixarArquivo(xml, `${nota.chaveAcesso || nota.numero}-ajustado.xml`, "application/xml");
}
