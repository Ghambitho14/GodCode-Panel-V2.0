import {
	getConvertibleUnitOptions,
	getUnitLabel,
	normalizeUnit,
} from "@/lib/inventory-units";

/** Unidades de entrada permitidas para recetas según unidad nativa del insumo. */
export function getInputUnitOptions(nativeUnit: string): string[] {
	return getConvertibleUnitOptions(nativeUnit);
}

export function recipeUnitSelectLabel(unit: string): string {
	return getUnitLabel(unit);
}

/** Convierte cantidad en unidad de entrada a cantidad en unidad nativa del insumo. */
export function toNativeQty(qty: number, inputUnit: string, nativeUnit: string): number {
	const q = Number(qty) || 0;
	const i = normalizeUnit(inputUnit);
	const n = normalizeUnit(nativeUnit);
	if (i === n) return q;
	if (n === "kg" && i === "g") return q / 1000;
	if (n === "g" && i === "kg") return q * 1000;
	if (n === "l" && i === "ml") return q / 1000;
	if (n === "ml" && i === "l") return q * 1000;
	if (n === "m" && i === "cm") return q / 100;
	if (n === "cm" && i === "m") return q * 100;
	if (n === "un" && i === "docena") return q * 12;
	if (n === "docena" && i === "un") return q / 12;
	return q;
}

export { getUnitLabel, normalizeUnit };
