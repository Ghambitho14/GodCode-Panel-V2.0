/** Unidades de entrada permitidas para recetas según unidad nativa del insumo. */
export function getInputUnitOptions(nativeUnit: string): string[] {
  const u = String(nativeUnit || "un").toLowerCase();
  const map: Record<string, string[]> = {
    un: ["un", "docena"],
    docena: ["docena", "un"],
    kg: ["kg", "g"],
    g: ["g", "kg"],
    l: ["l", "ml"],
    ml: ["ml", "l"],
  };
  return map[u] ?? ["un"];
}

const UNIT_LABELS: Record<string, string> = {
  un: "Unidad(es)",
  docena: "Docena(s)",
  kg: "Kilogramo(s)",
  g: "Gramo(s)",
  l: "Litro(s)",
  ml: "Mililitro(s)",
};

export function recipeUnitSelectLabel(unit: string): string {
  const k = String(unit || "").toLowerCase();
  return UNIT_LABELS[k] ?? unit;
}

/** Convierte cantidad en unidad de entrada a cantidad en unidad nativa del insumo. */
export function toNativeQty(qty: number, inputUnit: string, nativeUnit: string): number {
  const q = Number(qty) || 0;
  const i = String(inputUnit || "").toLowerCase();
  const n = String(nativeUnit || "").toLowerCase();
  if (i === n) return q;
  if (n === "kg" && i === "g") return q / 1000;
  if (n === "g" && i === "kg") return q * 1000;
  if (n === "l" && i === "ml") return q / 1000;
  if (n === "ml" && i === "l") return q * 1000;
  if (n === "un" && i === "docena") return q * 12;
  if (n === "docena" && i === "un") return q / 12;
  return q;
}
