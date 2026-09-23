// arquivados.js — todas as notas da empresa, agrupadas por competência (mês/ano).
import { gerarPdf } from "./exportacao.js";
import { criarLista } from "./notas-ui.js";
import { estado, $, competenciaDe, rotuloCompetencia, passaBusca } from "./estado.js";

let lista;

export function iniciarArquivados() {
  lista = criarLista({
    raiz: $("arq-lista"),
    paginacao: $("arq-paginacao"),
    agrupar: true,
    vazio: "Nenhuma nota encontrada para este filtro.",
    obter: () => {
      const comp = $("arq-competencia").value;
      const st = $("arq-status").value;
      return estado.notas
        .filter((n) => (!comp || competenciaDe(n) === comp) && (st === "todas" || n.status === st) && passaBusca(n))
        .sort((a, b) => competenciaDe(b).localeCompare(competenciaDe(a)));
    },
  });
  $("arq-competencia").addEventListener("change", () => lista.render(true));
  $("arq-status").addEventListener("change", () => lista.render(true));
  $("btn-pdf-arq").addEventListener("click", () => {
    const v = lista.visiveis();
    if (!v.length) return alert("Não há notas na página para gerar o PDF.");
    gerarPdf(v, "analise-nfe-arquivados.pdf", `Análise de NF-e - ${estado.empresa.nome}`);
  });
}

export function renderArquivados(zerar) {
  const sel = $("arq-competencia");
  const comps = [...new Set(estado.notas.map(competenciaDe))].sort().reverse();
  const atual = comps.includes(sel.value) ? sel.value : "";
  sel.innerHTML = '<option value="">Todas as competências</option>' +
    comps.map((c) => `<option value="${c}">${rotuloCompetencia(c)}</option>`).join("");
  sel.value = atual;
  lista.render(zerar);
}
