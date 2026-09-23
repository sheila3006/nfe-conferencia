import {
  auth, db,
  signInWithEmailAndPassword, onAuthStateChanged, signOut,
  collection, addDoc, getDocs, query, orderBy, serverTimestamp,
} from "./firebase-init.js";
import { parseNFeXml } from "./parser.js";
import { classificarPorCfop, ehProvavelInsumoProducao, conferirCstPisCofins } from "./regras.js";

const loginView = document.getElementById("login-view");
const appView = document.getElementById("app-view");
const userInfo = document.getElementById("user-info");
const loginForm = document.getElementById("login-form");
const loginErro = document.getElementById("login-erro");
const btnSair = document.getElementById("btn-sair");
const inputXml = document.getElementById("input-xml");
const tabelaCorpo = document.getElementById("tabela-corpo");
const usuarioLabel = document.getElementById("usuario-label");

onAuthStateChanged(auth, (user) => {
  if (user) {
    loginView.classList.add("oculto");
    appView.classList.remove("oculto");
    userInfo.classList.remove("oculto");
    usuarioLabel.textContent = user.email;
    carregarNotas();
  } else {
    appView.classList.add("oculto");
    userInfo.classList.add("oculto");
    loginView.classList.remove("oculto");
  }
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginErro.textContent = "";
  const email = document.getElementById("login-email").value;
  const senha = document.getElementById("login-senha").value;
  try {
    await signInWithEmailAndPassword(auth, email, senha);
  } catch (err) {
    loginErro.textContent = "Não foi possível entrar: " + err.message;
  }
});

btnSair.addEventListener("click", () => signOut(auth));

inputXml.addEventListener("change", async (e) => {
  const arquivos = Array.from(e.target.files || []);
  for (const arquivo of arquivos) {
    try {
      const texto = await arquivo.text();
      const nota = parseNFeXml(texto);
      const resultado = processarNota(nota);
      await salvarNota(resultado);
      adicionarLinhaNaTabela(resultado);
    } catch (err) {
      alert(`Erro ao processar ${arquivo.name}: ${err.message}`);
    }
  }
  inputXml.value = "";
});

function processarNota(nota) {
  const itensProcessados = nota.itens.map((item) => {
    const classificacao = classificarPorCfop(item.cfop);
    const provavelInsumo = ehProvavelInsumoProducao(item.ncm);
    const confPis = conferirCstPisCofins(item.cstPis, nota.emitente.crt, classificacao, provavelInsumo);
    const confCofins = conferirCstPisCofins(item.cstCofins, nota.emitente.crt, classificacao, provavelInsumo);
    return { ...item, classificacao, provavelInsumo, confPis, confCofins };
  });

  const statusGeral = itensProcessados.some(
    (i) => i.confPis.status !== "ok" || i.confCofins.status !== "ok"
  )
    ? "revisar"
    : "ok";

  return { ...nota, itens: itensProcessados, statusGeral };
}

async function salvarNota(nota) {
  await addDoc(collection(db, "notas"), {
    chaveAcesso: nota.chaveAcesso,
    numero: nota.numero,
    emitenteNome: nota.emitente.nome,
    emitenteCnpj: nota.emitente.cnpj,
    statusGeral: nota.statusGeral,
    itens: nota.itens,
    criadoEm: serverTimestamp(),
  });
}

async function carregarNotas() {
  tabelaCorpo.innerHTML = "";
  const q = query(collection(db, "notas"), orderBy("criadoEm", "desc"));
  const snap = await getDocs(q);
  snap.forEach((doc) => adicionarLinhaNaTabela(doc.data()));
}

function adicionarLinhaNaTabela(nota) {
  nota.itens.forEach((item) => {
    const tr = document.createElement("tr");
    tr.className = item.confPis.status === "ok" && item.confCofins.status === "ok"
      ? "linha-ok" : "linha-revisar";
    tr.innerHTML = `
      <td>${nota.numero}</td>
      <td>${nota.emitenteNome}</td>
      <td>${item.descricao}</td>
      <td>${item.cfop}</td>
      <td>${item.classificacao}</td>
      <td>${item.cstPis}</td>
      <td>${item.cstCofins}</td>
      <td>${item.confPis.status === "ok" && item.confCofins.status === "ok" ? "OK" : "Revisar"}</td>
    `;
    tr.title = [item.confPis.motivo, item.confCofins.motivo].join(" | ");
    tabelaCorpo.prepend(tr);
  });
}
