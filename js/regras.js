// regras.js
// Classificação da compra e sugestão de CFOP / CST de PIS-COFINS de ENTRADA.
// Ponto de partida (Lucro Real, PIS/COFINS não cumulativo). Não substitui a
// validação do contador — ajuste as listas abaixo ao dia a dia da empresa.

export const CLASSIFICACOES = ["industrialização", "comércio", "uso e consumo", "ativo imobilizado"];

// CST de PIS/COFINS válidos para operações de ENTRADA (Tabela 4.3.4)
export const CST_ENTRADA = [
  "50","51","52","53","54","55","56",
  "60","61","62","63","64","65","66","67",
  "70","71","72","73","74","75","98","99",
];

const norm = (s) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// ---------- 1) Classificação ----------
const USO_CONSUMO = /\b(container|conteiner|balde|lixeira|vassoura|rodo|detergente|desinfetante|sabao|esponja|pano de|luva|touca|papel toalha|limpeza|uniforme|avental|toner|lampada)/;
const ATIVO = /\b(fogao|fritadeira|chapeira|forno|freezer|geladeira|refrigerador|balanca|coifa|exaustor|maquina|equipamento|estufa|camara fria|moedor)/;

const NCM_REVENDA = ["2009", "2201", "2202", "2203", "2208"]; // sucos, água, refri, cerveja, destilados
const NCM_EMBALAGEM = ["4819", "3923"];
const NCM_INSUMO = [
  "0201","0202","0203","0206","0207","0210",           // carnes
  "0401","0402","0403","0404","0405","0406","0407",     // laticínios e ovos
  "0701","0702","0703","0704","0705","0706","0709","0710", // hortifruti
  "0910","1507","1512","1517","1701","1905",            // temperos, óleos, açúcar, pães
  "2001","2005","2103",                                 // conservas e molhos
];

// Sufixo do CFOP de origem -> classificação provável
const CFOP_FINAL = {
  "101": "industrialização", "401": "industrialização",
  "102": "comércio", "403": "comércio", "405": "comércio",
  "556": "uso e consumo", "407": "uso e consumo",
  "551": "ativo imobilizado", "406": "ativo imobilizado",
};

export function classificarItem({ descricao, ncm, cfop }) {
  const d = norm(descricao);
  const n4 = (ncm || "").slice(0, 4);
  if (USO_CONSUMO.test(d)) return { classificacao: "uso e consumo", motivo: "Descrição sugere material de uso e consumo." };
  if (ATIVO.test(d)) return { classificacao: "ativo imobilizado", motivo: "Descrição sugere equipamento/bem durável." };
  if (NCM_REVENDA.includes(n4)) return { classificacao: "comércio", motivo: "NCM de bebida pronta para revenda." };
  if (NCM_INSUMO.includes(n4)) return { classificacao: "industrialização", motivo: "NCM de matéria-prima/insumo de produção." };
  if (NCM_EMBALAGEM.includes(n4)) return { classificacao: "industrialização", motivo: "NCM de embalagem." };
  const porCfop = CFOP_FINAL[(cfop || "").slice(1)];
  if (porCfop) return { classificacao: porCfop, motivo: "Classificado pelo CFOP de origem." };
  return { classificacao: "", motivo: "Não foi possível classificar automaticamente — definir manualmente." };
}

// ---------- 2) CFOP de entrada ----------
// [normal, com substituição tributária]
const CFOP_ENTRADA_BASE = {
  "industrialização": ["101", "401"],
  "comércio": ["102", "403"],
  "uso e consumo": ["556", "407"],
  "ativo imobilizado": ["551", "406"],
};
const PREFIXO_ENTRADA = { "5": "1", "6": "2", "7": "3", "1": "1", "2": "2", "3": "3" };
const FINAL_ST = ["401", "402", "403", "404", "405"];

export function cfopEntradaSugerido(cfopOrigem, classificacao) {
  const base = CFOP_ENTRADA_BASE[classificacao];
  const prefixo = PREFIXO_ENTRADA[(cfopOrigem || "")[0]];
  if (!base || !prefixo || cfopOrigem.length !== 4) return "";
  const st = FINAL_ST.includes(cfopOrigem.slice(1));
  return prefixo + base[st ? 1 : 0];
}

// ---------- 3) CST de PIS/COFINS de entrada ----------
const NCM_BEBIDAS = ["2201", "2202", "2203"];
// CST informado pelo fornecedor na saída -> CST de entrada correspondente
const CORRESP_ORIGEM = {
  "05": ["75", "Fornecedor com tributação por substituição tributária (05): aquisição por ST."],
  "06": ["73", "Fornecedor com alíquota zero (06): aquisição a alíquota zero, sem crédito."],
  "07": ["71", "Fornecedor com operação isenta (07): aquisição com isenção, sem crédito."],
  "08": ["74", "Fornecedor sem incidência (08): aquisição sem incidência, sem crédito."],
  "09": ["72", "Fornecedor com suspensão (09): aquisição com suspensão."],
};

export function cstEntradaSugerido(classificacao, ncm, cstOrigem) {
  if (!classificacao) return { cst: "", motivo: "Sem classificação — defina para sugerir o CST." };
  const corresp = CORRESP_ORIGEM[cstOrigem];
  if (corresp) return { cst: corresp[0], motivo: corresp[1] };
  if (classificacao === "uso e consumo") {
    return { cst: "70", motivo: "Uso e consumo: em regra sem direito a crédito (confirmar se algum item se enquadra como insumo)." };
  }
  if (classificacao === "comércio" && NCM_BEBIDAS.includes((ncm || "").slice(0, 4))) {
    return { cst: "70", motivo: "Bebida (NCM 22xx): possível regime monofásico, revenda sem crédito — confirmar com o contador." };
  }
  if (cstOrigem === "04") {
    return { cst: "70", motivo: "Fornecedor informou monofásico (04): revenda sem direito a crédito." };
  }
  return { cst: "50", motivo: "Regime não cumulativo: compra com direito a crédito vinculado a receita tributada." };
}

// ---------- 4) Cadastro de produtos ----------
// ID do documento na coleção "produtos": fornecedor + código do produto
export function chaveProduto(cnpj, codigoProduto) {
  return `${cnpj}_${codigoProduto}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 150);
}
