// regras.js
// Classificação da compra e sugestão de CFOP / CST de PIS-COFINS de ENTRADA.
// Ponto de partida (Lucro Real, PIS/COFINS não cumulativo). Não substitui a
// validação do contador — ajuste as listas abaixo ao dia a dia da empresa.

export const CLASSIFICACOES = [
  "industrialização", "comércio", "uso e consumo", "ativo imobilizado",
  "cesta básica", "uniforme", "combustível c/ retenção", "combustível s/ retenção", "energia elétrica",
];

// Classificações com CFOP e CST de entrada FIXOS (não dependem do CFOP/CST do fornecedor).
const FIXAS = {
  "cesta básica":            { cfop: "1949", cst: "98", motivo: "Cesta básica: CFOP 1949 / CST 98." },
  "uniforme":                { cfop: "1949", cst: "98", motivo: "Uniforme: CFOP 1949 / CST 98." },
  "combustível c/ retenção": { cfop: "1407", cst: "98", motivo: "Combustível com retenção (ST): CFOP 1407 / CST 98." },
  "combustível s/ retenção": { cfop: "1653", cst: "98", motivo: "Combustível sem retenção: CFOP 1653 / CST 98." },
  "energia elétrica":        { cfop: "1252", cst: "50", motivo: "Energia elétrica: CFOP 1252 / CST 50." },
};

// CST de PIS/COFINS válidos para operações de ENTRADA (Tabela 4.3.4)
export const CST_ENTRADA = [
  "50","51","52","53","54","55","56",
  "60","61","62","63","64","65","66","67",
  "70","71","72","73","74","75","98","99",
];

const norm = (s) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// ---------- 0) Substituição Tributária (ICMS) ----------
// CST do ICMS (regime normal) que indicam cobrança por ST: 10, 30, 60, 70.
// CSOSN (Simples Nacional) equivalentes: 201, 202, 203, 500.
// Isso é bem mais confiável do que "chutar" pelo final do CFOP do fornecedor,
// porque muitos emitentes usam CFOP "normal" (5102) mesmo em item com ST.
const CST_ICMS_ST = ["10", "30", "60", "70"];
const CSOSN_ICMS_ST = ["201", "202", "203", "500"];
function temSubstituicaoTributaria(cstIcms, csosnIcms, cfopOrigem) {
  if (cstIcms && CST_ICMS_ST.includes(cstIcms)) return true;
  if (csosnIcms && CSOSN_ICMS_ST.includes(csosnIcms)) return true;
  // sem CST/CSOSN de ICMS disponível (XML antigo, ou item sem essa info):
  // cai de volta no critério antigo, só como último recurso.
  if (!cstIcms && !csosnIcms) return FINAL_ST.includes((cfopOrigem || "").slice(1));
  return false;
}

// ---------- 1) Classificação ----------
const USO_CONSUMO = /\b(container|conteiner|balde|lixeira|vassoura|rodo|detergente|desinfetante|sabao|esponja|pano de|luva|touca|papel toalha|limpeza|avental|toner|lampada)/;
const UNIFORME = /\b(uniforme|camisa polo|camiseta|bone|jaleco|dolma)/;
const ATIVO = /\b(fogao|fritadeira|chapeira|forno|freezer|geladeira|refrigerador|balanca|coifa|exaustor|maquina|equipamento|estufa|camara fria|moedor)/;

const NCM_REVENDA = ["2009", "2201", "2202", "2203", "2208"]; // sucos, água, refri, cerveja, destilados
// Embalagens (sacos, potes, garrafas). O uso real muda conforme a empresa:
// - Hamburgueria: embala o pedido pronto no delivery/balcão -> não compõe um
//   produto industrializado por ela -> uso e consumo.
// - Indústria alimentícia: embala o produto que ELA fabrica para vender ->
//   insumo de embalagem -> industrialização (com direito a crédito).
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

export function classificarItem({ descricao, ncm, cfop, empresaId }) {
  const d = norm(descricao);
  const n4 = (ncm || "").slice(0, 4);
  if (UNIFORME.test(d)) return { classificacao: "uniforme", motivo: "Descrição sugere uniforme." };
  if (USO_CONSUMO.test(d)) return { classificacao: "uso e consumo", motivo: "Descrição sugere material de uso e consumo." };
  if (ATIVO.test(d)) return { classificacao: "ativo imobilizado", motivo: "Descrição sugere equipamento/bem durável." };
  if (NCM_REVENDA.includes(n4)) return { classificacao: "comércio", motivo: "NCM de bebida pronta para revenda." };
  if (NCM_INSUMO.includes(n4)) return { classificacao: "industrialização", motivo: "NCM de matéria-prima/insumo de produção." };
  if (NCM_EMBALAGEM.includes(n4)) {
    // Hamburgueria embala o pedido pronto (delivery/balcão): uso e consumo. Indústria: insumo de embalagem.
    if (empresaUsaIcms({ id: empresaId })) {
      return { classificacao: "uso e consumo", motivo: "NCM de embalagem na hamburgueria: embala o pedido pronto — uso e consumo." };
    }
    return { classificacao: "industrialização", motivo: "NCM de embalagem — compõe o produto final entregue ao cliente." };
  }
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

export function cfopEntradaSugerido(cfopOrigem, classificacao, cstIcmsOrigem, csosnIcmsOrigem) {
  if (FIXAS[classificacao]) {
    // Classificações fixas: 1xxx para compra dentro do estado, 2xxx quando o CFOP do fornecedor é 6xxx (interestadual).
    const fixo = FIXAS[classificacao].cfop;
    return PREFIXO_ENTRADA[(cfopOrigem || "")[0]] === "2" ? "2" + fixo.slice(1) : fixo;
  }
  const base = CFOP_ENTRADA_BASE[classificacao];
  const prefixo = PREFIXO_ENTRADA[(cfopOrigem || "")[0]];
  if (!base || !prefixo || cfopOrigem.length !== 4) return "";
  const st = temSubstituicaoTributaria(cstIcmsOrigem, csosnIcmsOrigem, cfopOrigem);
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
  if (FIXAS[classificacao]) return { cst: FIXAS[classificacao].cst, motivo: FIXAS[classificacao].motivo };
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

// ---------- 3b) CST de IPI (conferência) ----------
// O crédito de IPI só cabe a estabelecimento industrial ou equiparado a
// industrial. Para a maioria das compras (hamburgueria e itens que não
// entram em processo industrial da indústria alimentícia), não há
// aproveitamento de crédito — isso aqui é uma CONFERÊNCIA do que o
// fornecedor informou, sugerindo o CST de entrada correspondente, e não
// deve ser lido como "sempre há direito a crédito".
export const CST_IPI_ENTRADA = ["00", "01", "02", "03", "04", "05", "49"];

// CST de IPI informado pelo fornecedor na SAÍDA (50-55, 99) -> CST de ENTRADA correspondente
const CORRESP_IPI_ORIGEM = {
  "50": ["00", "Fornecedor tributou o IPI (50): entrada com recuperação de crédito — só aplicável se a empresa for industrial/equiparada."],
  "51": ["01", "Fornecedor com alíquota zero (51): entrada tributada à alíquota zero."],
  "52": ["02", "Fornecedor com isenção (52): entrada isenta."],
  "53": ["03", "Fornecedor com não incidência (53): entrada não-tributada."],
  "54": ["04", "Fornecedor com imunidade (54): entrada imune."],
  "55": ["05", "Fornecedor com suspensão (55): entrada com suspensão."],
  "99": ["49", "Fornecedor informou outras saídas de IPI (99): entrada classificada como outras entradas."],
};

export function cstIpiEntradaSugerido(cstIpiOrigem) {
  if (!cstIpiOrigem) {
    return { cst: "49", motivo: "Nota sem tributação de IPI informada pelo fornecedor (comum quando ele não é contribuinte do IPI) — registrada como outras entradas." };
  }
  const corresp = CORRESP_IPI_ORIGEM[cstIpiOrigem];
  if (corresp) return { cst: corresp[0], motivo: corresp[1] };
  return { cst: "49", motivo: `CST de IPI do fornecedor (${cstIpiOrigem}) fora do padrão esperado — confirmar com o contador.` };
}

// ---------- 3c) ICMS de entrada (SOMENTE hamburgueria) ----------
// A indústria alimentícia não usa estas colunas/regras.
// Identifica pelo ramo cadastrado em estado.js (ex.: "Hamburgueria") ou pelo id da empresa (ex.: "just-burger").
const RAMOS_COM_ICMS = ["hamburguer"];
const IDS_COM_ICMS = ["just-burger"];
export function empresaUsaIcms(empresa) {
  if (!empresa) return false;
  if (IDS_COM_ICMS.includes(empresa.id)) return true;
  const ramo = norm(empresa.ramo);
  return RAMOS_COM_ICMS.some((p) => ramo.includes(p));
}

// CST de ICMS (Tabela B, 2 dígitos). O CST completo tem 3 posições: origem da mercadoria + CST.
export const CST_ICMS_BASE = ["00", "10", "20", "30", "40", "41", "50", "51", "60", "70", "90"];
export const cstIcmsValido = (v) => /^[0-8]\d{2}$/.test(v || "") && CST_ICMS_BASE.includes(v.slice(1));

// CFOP de entrada -> CST de ICMS (2 dígitos). Sem crédito de ICMS: vai em "valor contábil" e "outras".
const ICMS_POR_CFOP = {
  "1556": "90", "2556": "90",                 // uso e consumo
  "1407": "60", "2407": "60",                 // uso e consumo com ST
  "1551": "90", "2551": "90",                 // ativo imobilizado
  "1406": "60", "2406": "60",                 // ativo imobilizado com ST
  "1949": "90", "2949": "90",                 // uniforme / cesta básica
  "1401": "60", "2401": "60", "1403": "60", "2403": "60", // compra p/ industrialização/comércio com ST
};
// CFOP em que vale o ICMS DESTACADO na NF (há crédito): o CST de entrada espelha o do fornecedor (ex.: 00, 20).
const CFOP_ICMS_DESTACADO = ["1102", "2102", "2202"];

export function cstIcmsEntradaSugerido(cfopEntrada, origem, cstIcmsOrigem) {
  const o = /^[0-8]$/.test(origem || "") ? origem : "0";
  const fixo = ICMS_POR_CFOP[cfopEntrada];
  if (fixo) return { cst: o + fixo, motivo: `ICMS: CFOP ${cfopEntrada} → CST ${o}${fixo} (sem crédito; valor contábil e outras).` };
  if (CFOP_ICMS_DESTACADO.includes(cfopEntrada)) {
    if (CST_ICMS_BASE.includes(cstIcmsOrigem)) {
      return { cst: o + cstIcmsOrigem, motivo: `ICMS: CFOP ${cfopEntrada} considera o ICMS destacado na NF; CST ${o}${cstIcmsOrigem} conforme o fornecedor.` };
    }
    return { cst: "", motivo: `ICMS: CFOP ${cfopEntrada} usa o ICMS destacado, mas a NF não traz CST de ICMS — definir manualmente.` };
  }
  return { cst: "", motivo: "ICMS: CFOP de entrada sem regra cadastrada — definir manualmente." };
}

// ---------- 4) Cadastro de produtos ----------
// ID do documento na coleção "produtos": fornecedor + código do produto
export function chaveProduto(cnpj, codigoProduto) {
  return `${cnpj}_${codigoProduto}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 150);
}
