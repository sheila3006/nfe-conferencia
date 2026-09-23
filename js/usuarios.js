// usuarios.js — Configurações: cadastrar, alterar e excluir usuários (só administrador).
import {
  auth, db, criarLogin, sendPasswordResetEmail,
  collection, doc, getDocs, setDoc, updateDoc, deleteDoc, serverTimestamp,
} from "./firebase-init.js";
import { EMPRESAS, estado, $, esc, rotuloPapel, ICONES } from "./estado.js";

let usuarios = [];

const nomesEmpresas = (u) => u.papel === "admin"
  ? "Todas"
  : EMPRESAS.filter((e) => (u.empresas || []).includes(e.id)).map((e) => e.nome).join(", ") || "—";

export async function renderUsuarios() {
  const alvo = $("usuarios-tabela");
  alvo.innerHTML = '<p class="vazio">Carregando...</p>';
  try {
    const snap = await getDocs(collection(db, "usuarios"));
    usuarios = snap.docs.map((d) => ({ uid: d.id, ...d.data() }))
      .sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
  } catch (err) {
    alvo.innerHTML = `<p class="vazio">Não foi possível carregar os usuários: ${esc(err.message)}</p>`;
    return;
  }
  alvo.innerHTML = `<table>
    <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Empresas</th><th>Situação</th><th></th></tr></thead>
    <tbody>${usuarios.map((u) => {
      const eu = u.uid === estado.usuario.uid;
      return `<tr data-uid="${esc(u.uid)}">
        <td>${esc(u.nome)}${eu ? " <small>(você)</small>" : ""}</td><td>${esc(u.email)}</td>
        <td><span class="selo ${u.papel === "admin" ? "cad" : "man"}">${rotuloPapel(u.papel)}</span></td>
        <td>${esc(nomesEmpresas(u))}</td>
        <td><span class="selo ${u.ativo ? "ok" : "sug"}">${u.ativo ? "Ativo" : "Inativo"}</span></td>
        <td class="acoes-linha">
          <button data-acao="editar" class="icone" title="Alterar" aria-label="Alterar">${ICONES.editar}</button>
          <button data-acao="senha" class="sec">Redefinir senha</button>
          <button data-acao="excluir" class="icone perigo" title="${eu ? "Você não pode excluir o próprio usuário" : "Excluir"}" aria-label="Excluir" ${eu ? "disabled" : ""}>${ICONES.lixeira}</button>
        </td></tr>`;
    }).join("")}</tbody></table>`;
}

function atualizarEmpresasBox() {
  const admin = $("u-papel").value === "admin";
  $("u-empresas").querySelectorAll("input").forEach((i) => { i.disabled = admin; if (admin) i.checked = true; });
  $("u-empresas-aviso").classList.toggle("oculto", !admin);
}

function abrirDialogo(u) {
  const novo = !u;
  $("u-titulo").textContent = novo ? "Novo usuário" : "Alterar usuário";
  $("u-uid").value = u ? u.uid : "";
  $("u-nome").value = u?.nome || "";
  $("u-email").value = u?.email || "";
  $("u-email").disabled = !novo;
  $("u-senha-box").classList.toggle("oculto", !novo);
  $("u-senha").value = "";
  $("u-senha").required = novo;
  $("u-papel").value = u?.papel || "user";
  $("u-ativo").checked = u ? u.ativo === true : true;
  $("u-empresas").innerHTML = EMPRESAS.map((e) =>
    `<label><input type="checkbox" value="${e.id}" ${(u?.empresas || []).includes(e.id) ? "checked" : ""}> ${esc(e.nome)}</label>`).join("");
  $("u-erro").textContent = "";
  atualizarEmpresasBox();
  $("dlg-usuario").showModal();
}

const ERROS_AUTH = {
  "auth/email-already-in-use": "Este e-mail já tem login no Firebase. Se o usuário foi excluído antes, apague-o também em Authentication no Console do Firebase e cadastre de novo.",
  "auth/weak-password": "A senha precisa ter ao menos 6 caracteres.",
  "auth/invalid-email": "E-mail inválido.",
};

async function salvar(e) {
  e.preventDefault();
  const uid = $("u-uid").value;
  const papel = $("u-papel").value;
  const ativo = $("u-ativo").checked;
  const empresas = papel === "admin"
    ? EMPRESAS.map((x) => x.id)
    : [...$("u-empresas").querySelectorAll("input:checked")].map((i) => i.value);
  const erro = $("u-erro");
  erro.textContent = "";

  if (papel === "user" && !empresas.length) { erro.textContent = "Marque ao menos uma empresa."; return; }
  if (uid && uid === estado.usuario.uid && (papel !== "admin" || !ativo)) {
    erro.textContent = "Você não pode remover o seu próprio acesso de administrador.";
    return;
  }

  const btn = $("u-salvar");
  btn.disabled = true;
  try {
    const dados = { nome: $("u-nome").value.trim(), papel, ativo, empresas };
    if (!uid) {
      const email = $("u-email").value.trim();
      const novoUid = await criarLogin(email, $("u-senha").value);
      await setDoc(doc(db, "usuarios", novoUid), { ...dados, email, criadoEm: serverTimestamp() });
    } else {
      await updateDoc(doc(db, "usuarios", uid), dados);
      if (uid === estado.usuario.uid) Object.assign(estado.perfil, dados);
    }
    $("dlg-usuario").close();
    await renderUsuarios();
  } catch (err) {
    erro.textContent = ERROS_AUTH[err.code] || err.message;
  } finally {
    btn.disabled = false;
  }
}

export function iniciarUsuarios() {
  $("btn-novo-usuario").addEventListener("click", () => abrirDialogo(null));
  $("u-papel").addEventListener("change", atualizarEmpresasBox);
  $("u-cancelar").addEventListener("click", () => $("dlg-usuario").close());
  $("form-usuario").addEventListener("submit", salvar);

  $("usuarios-tabela").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-acao]");
    if (!btn) return;
    const u = usuarios.find((x) => x.uid === btn.closest("tr").dataset.uid);
    try {
      if (btn.dataset.acao === "editar") abrirDialogo(u);
      else if (btn.dataset.acao === "senha") {
        if (!confirm(`Enviar e-mail de redefinição de senha para ${u.email}?`)) return;
        await sendPasswordResetEmail(auth, u.email);
        alert("E-mail de redefinição enviado.");
      } else if (btn.dataset.acao === "excluir") {
        if (!confirm(`Excluir o usuário ${u.nome || u.email}? Ele perde o acesso ao sistema imediatamente.`)) return;
        await deleteDoc(doc(db, "usuarios", u.uid));
        await renderUsuarios();
      }
    } catch (err) {
      alert("Erro: " + err.message);
    }
  });
}
