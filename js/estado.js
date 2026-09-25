// estado.js — estado compartilhado, empresas e utilidades.
import { db, collection, doc } from "./firebase-init.js";

// Empresas do sistema. O "id" vira a "pasta" no banco (empresas/<id>/...).
// Pode trocar o nome/ramo à vontade; NÃO mude o id depois que houver dados.
export const EMPRESAS = [
  { id: "just-burger", nome: "Just Burger", ramo: "Hamburgueria" },
  { id: "industria", nome: "Indústria alimentícia", ramo: "Indústria" },
];

export const estado = {
  usuario: null,       // usuário do Firebase Auth
  perfil: null,        // documento usuarios/<uid> (nome, papel, empresas, ativo)
  empresa: null,       // empresa escolhida no login
  notas: [],           // todas as notas da empresa
  sessao: new Set(),   // ids importados nesta sessão (aparecem na Conferência)
};

export const ehAdmin = () => estado.perfil?.papel === "admin";
export const rotuloPapel = (p) => (p === "admin" ? "Administrador" : "Usuário");
export const colEmpresa = (nome) => collection(db, "empresas", estado.empresa.id, nome);
export const docEmpresa = (nome, id) => doc(db, "empresas", estado.empresa.id, nome, id);

export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const moeda = (v) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const norm = (s) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export const formatarCnpj = (c) => {
  const d = (c || "").replace(/\D/g, "");
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : (c || "");
};

// Competência = mês/ano da data de emissão. Formato interno "2026-09".
export const competenciaDe = (n) => (n.dataEmissao || "").slice(0, 7);
export const rotuloCompetencia = (c) => (c ? c.split("-").reverse().join("/") : "Sem data");
export const valorNota = (n) => n.valorTotal || (n.itens || []).reduce((s, i) => s + (i.valorProduto || 0), 0);

// Unidades (matriz/filiais) presentes nas notas, pelo CNPJ do destinatário (quem recebeu a NF-e).
export const rotuloUnidade = (n) => (n.destNome ? `${n.destNome} — ${formatarCnpj(n.destCnpj)}` : formatarCnpj(n.destCnpj) || "CNPJ não identificado");
export function unidadesDe(notas) {
  const mapa = new Map();
  for (const n of notas) {
    if (!n.destCnpj) continue;
    if (!mapa.has(n.destCnpj)) mapa.set(n.destCnpj, { cnpj: n.destCnpj, nome: n.destNome || "" });
  }
  return [...mapa.values()].sort((a, b) => (a.nome || a.cnpj).localeCompare(b.nome || b.cnpj, "pt-BR"));
}

// Busca do topo: número da NF, CNPJ ou fornecedor
export function passaBusca(n) {
  const termo = norm($("busca-global").value.trim());
  if (!termo) return true;
  const digitos = termo.replace(/\D/g, "");
  return norm(`${n.numero} ${n.emitenteNome}`).includes(termo) ||
    (digitos.length > 0 && (n.emitenteCnpj || "").includes(digitos));
}

const svg = (corpo) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${corpo}</svg>`;
export const ICONES = {
  lixeira: svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>'),
  editar: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>'),
};
