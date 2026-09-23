import {
  auth, db, signInWithEmailAndPassword, onAuthStateChanged, signOut,
  doc, getDoc, getDocs, query, orderBy,
} from "./firebase-init.js";
import { EMPRESAS, estado, ehAdmin, rotuloPapel, colEmpresa, $, esc } from "./estado.js";
import { CST_ENTRADA } from "./regras.js";
import { iniciarConferencia, renderConferencia } from "./conferencia.js";
import { iniciarArquivados, renderArquivados } from "./arquivados.js";
import { iniciarDashboard, renderDashboard } from "./dashboard.js";
import { iniciarUsuarios, renderUsuarios } from "./usuarios.js";

const VISOES = ["login-view", "sem-acesso-view", "empresa-view", "shell"];
const mostrar = (id) => VISOES.forEach((v) => $(v).classList.toggle("oculto", v !== id));

$("lista-cst").innerHTML = CST_ENTRADA.map((c) => `<option value="${c}">`).join("");
iniciarConferencia();
iniciarArquivados();
iniciarDashboard();
iniciarUsuarios();

// ---------- login ----------
$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("login-erro").textContent = "";
  try {
    await signInWithEmailAndPassword(auth, $("login-email").value, $("login-senha").value);
  } catch (err) {
    $("login-erro").textContent = "Não foi possível entrar: e-mail ou senha incorretos.";
  }
});
document.querySelectorAll("[data-sair]").forEach((b) => b.addEventListener("click", () => signOut(auth)));

const empresasPermitidas = () => ehAdmin()
  ? EMPRESAS
  : EMPRESAS.filter((e) => (estado.perfil.empresas || []).includes(e.id));

onAuthStateChanged(auth, async (user) => {
  estado.usuario = user;
  estado.perfil = null;
  estado.empresa = null;
  if (!user) return mostrar("login-view");

  let perfil = null;
  try {
    const snap = await getDoc(doc(db, "usuarios", user.uid));
    if (snap.exists()) perfil = snap.data();
  } catch (err) {
    console.error(err);
  }
  if (!perfil || perfil.ativo !== true) return semAcesso(user, "Seu acesso ainda não foi liberado (ou foi desativado).");

  estado.perfil = perfil;
  const nome = perfil.nome || user.email;
  $("usuario-nome").textContent = nome;
  $("usuario-papel").textContent = rotuloPapel(perfil.papel);
  $("avatar").textContent = nome.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
  $("menu-config").classList.toggle("oculto", !ehAdmin());

  const permitidas = empresasPermitidas();
  if (!permitidas.length) return semAcesso(user, "Seu usuário não tem nenhuma empresa liberada.");
  if (permitidas.length === 1) return entrarNaEmpresa(permitidas[0]);
  escolherEmpresa(permitidas);
});

function semAcesso(user, mensagem) {
  $("sem-acesso-msg").textContent = mensagem;
  $("sem-acesso-email").textContent = user.email;
  $("sem-acesso-uid").textContent = user.uid;
  mostrar("sem-acesso-view");
}

// ---------- empresa ----------
function escolherEmpresa(permitidas) {
  const ultima = localStorage.getItem("ultimaEmpresa");
  $("empresa-cards").innerHTML = permitidas.map((e) => `
    <button class="cartao-empresa ${e.id === ultima ? "ultima" : ""}" data-id="${esc(e.id)}">
      <b>${esc(e.nome)}</b><span>${esc(e.ramo)}</span>
    </button>`).join("");
  mostrar("empresa-view");
}
$("empresa-cards").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-id]");
  if (b) entrarNaEmpresa(EMPRESAS.find((x) => x.id === b.dataset.id));
});
$("btn-trocar-empresa").addEventListener("click", () => escolherEmpresa(empresasPermitidas()));

async function entrarNaEmpresa(emp) {
  estado.empresa = emp;
  estado.notas = [];
  estado.sessao.clear();
  $("busca-global").value = "";
  try { localStorage.setItem("ultimaEmpresa", emp.id); } catch (_) { /* ignora */ }
  $("marca-empresa").textContent = emp.nome;
  $("banner-empresa").textContent = emp.nome;
  $("btn-trocar-empresa").classList.toggle("oculto", empresasPermitidas().length < 2);
  mostrar("shell");
  irPara("conferencia");
  try {
    const snap = await getDocs(query(colEmpresa("notas"), orderBy("criadoEm", "desc")));
    estado.notas = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    alert("Não foi possível carregar as notas: " + err.message);
  }
  renderTelaAtual();
}

// ---------- navegação ----------
let telaAtual = "conferencia";
const RENDERS = { conferencia: renderConferencia, arquivados: renderArquivados, dashboard: renderDashboard, configuracoes: renderUsuarios };

function renderTelaAtual(zerar = false) { RENDERS[telaAtual](zerar); }

function irPara(tela) {
  telaAtual = tela;
  document.querySelectorAll(".tela").forEach((s) => s.classList.toggle("oculto", s.id !== "tela-" + tela));
  document.querySelectorAll("nav button[data-tela]").forEach((b) => b.classList.toggle("ativo", b.dataset.tela === tela));
  renderTelaAtual(true);
}
document.querySelectorAll("nav button[data-tela]").forEach((b) => b.addEventListener("click", () => irPara(b.dataset.tela)));

$("busca-global").addEventListener("input", () => {
  if (telaAtual === "conferencia" || telaAtual === "arquivados") renderTelaAtual(true);
});
