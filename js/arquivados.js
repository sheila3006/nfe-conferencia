// arquivados.js — todas as notas da empresa, agrupadas por competência (mês/ano).
import { gerarPdf, gerarZipXmls } from "./exportacao.js";
import { criarLista } from "./notas-ui.js";
import { estado, $, esc, competenciaDe, rotuloCompetencia, formatarCnpj, unidadesDe, passaBusca } from "./estado.js";

let lista;

export function iniciarArquivados() {
  lista = criarLista({
    raiz: $("arq-lista"),
    paginacao: $("arq-paginacao"),
    agrupar: true,
    porFornecedor: true,
    fornecedoresAbertos: false,
    vazio: "Nenhuma nota encontrada para este filtro.",
    obter: () => {
      const comp = $("arq-competencia").value;
      const st = $("arq-status").value;
      const uni = $("arq-unidade").value;
      return estado.notas
        .filter((n) => (!comp || competenciaDe(n) === comp) && (st === "todas" || n.status === st) &&
          (!uni || n.destCnpj === uni) && passaBusca(n))
        .sort((a, b) =>
          competenciaDe(b).localeCompare(competenciaDe(a)) ||
          (a.emitenteNome || "").localeCompare(b.emitenteNome || "", "pt-BR") ||
          (Number(a.numero) || 0) - (Number(b.numero) || 0));
    },
  });
  $("arq-competencia").addEventListener("change", () => lista.render(true));
  $("arq-status").addEventListener("change", () => lista.render(true));
  $("arq-unidade").addEventListener("change", () => lista.render(true));
  $("btn-pdf-arq").addEventListener("click", () => {
    const v = lista.visiveis();
    if (!v.length) return alert("Não há notas na página para gerar o PDF.");
    gerarPdf(v, "analise-nfe-arquivados.pdf", `Análise de NF-e - ${estado.empresa.nome}`);
  });
  $("btn-zip-arq").addEventListener("click", async () => {
    const v = lista.visiveis();
    if (!v.length) return alert("Não há notas na página para baixar.");
    const btn = $("btn-zip-arq");
    const textoOriginal = btn.textContent;
    btn.disabled = true;
    try {
      await gerarZipXmls(v, "xmls-nfe-arquivados.zip", (feito, total) => { btn.textContent = `Baixando ${feito}/${total}...`; });
    } catch (err) {
      alert("Não foi possível gerar o arquivo .zip: " + err.message);
    } finally {
      btn.textContent = textoOriginal;
      btn.disabled = false;
    }
  });
}

export function renderArquivados(zerar) {
  const sel = $("arq-competencia");
  const comps = [...new Set(estado.notas.map(competenciaDe))].sort().reverse();
  const atual = comps.includes(sel.value) ? sel.value : "";
  sel.innerHTML = '<option value="">Todas as competências</option>' +
    comps.map((c) => `<option value="${c}">${rotuloCompetencia(c)}</option>`).join("");
  sel.value = atual;

  const selU = $("arq-unidade");
  const unidades = unidadesDe(estado.notas);
  const atualU = unidades.some((u) => u.cnpj === selU.value) ? selU.value : "";
  selU.innerHTML = '<option value="">Todas as unidades</option>' +
    unidades.map((u) => `<option value="${esc(u.cnpj)}">${esc(u.nome || formatarCnpj(u.cnpj))} (${esc(formatarCnpj(u.cnpj))})</option>`).join("");
  selU.value = atualU;

  lista.render(zerar);
}
