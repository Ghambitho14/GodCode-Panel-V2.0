/** Catálogo central de unidades para insumos y recetas. */

export type InventoryUnitGroupId =
	| "quantity"
	| "packaging"
	| "weight"
	| "volume"
	| "length";

export type InventoryUnitDef = {
	id: string;
	label: string;
	shortLabel: string;
	group: InventoryUnitGroupId;
};

export const INVENTORY_UNIT_GROUPS: { id: InventoryUnitGroupId; label: string }[] = [
	{ id: "quantity", label: "Cantidad" },
	{ id: "packaging", label: "Empaque / mayorista" },
	{ id: "weight", label: "Peso" },
	{ id: "volume", label: "Volumen" },
	{ id: "length", label: "Longitud" },
];

export const INVENTORY_UNITS: InventoryUnitDef[] = [
	{ id: "un", label: "Unidad(es)", shortLabel: "un", group: "quantity" },
	{ id: "par", label: "Par(es)", shortLabel: "par", group: "quantity" },
	{ id: "docena", label: "Docena(s)", shortLabel: "docena", group: "quantity" },
	{ id: "caja", label: "Caja(s)", shortLabel: "caja", group: "packaging" },
	{ id: "pack", label: "Pack(s)", shortLabel: "pack", group: "packaging" },
	{ id: "bulto", label: "Bulto(s)", shortLabel: "bulto", group: "packaging" },
	{ id: "pallet", label: "Pallet(s)", shortLabel: "pallet", group: "packaging" },
	{ id: "kg", label: "Kilogramo(s)", shortLabel: "kg", group: "weight" },
	{ id: "g", label: "Gramo(s)", shortLabel: "g", group: "weight" },
	{ id: "l", label: "Litro(s)", shortLabel: "l", group: "volume" },
	{ id: "ml", label: "Mililitro(s)", shortLabel: "ml", group: "volume" },
	{ id: "m", label: "Metro(s)", shortLabel: "m", group: "length" },
	{ id: "cm", label: "Centímetro(s)", shortLabel: "cm", group: "length" },
];

const UNIT_BY_ID = new Map(INVENTORY_UNITS.map((u) => [u.id, u]));

/** Alias legacy → id canónico. */
const UNIT_ALIASES: Record<string, string> = {
	lt: "l",
	litro: "l",
	litros: "l",
	ltros: "l",
	unidad: "un",
	unidades: "un",
	u: "un",
	und: "un",
	kilo: "kg",
	kilos: "kg",
	gramo: "g",
	gramos: "g",
};

export function normalizeUnit(raw: unknown): string {
	const s = String(raw ?? "")
		.trim()
		.toLowerCase();
	if (!s) return "un";
	if (UNIT_BY_ID.has(s)) return s;
	if (UNIT_ALIASES[s]) return UNIT_ALIASES[s];
	return s.slice(0, 16);
}

export function getUnitDef(unitId: string): InventoryUnitDef | undefined {
	return UNIT_BY_ID.get(normalizeUnit(unitId));
}

export function getUnitLabel(unitId: string, opts?: { short?: boolean }): string {
	const id = normalizeUnit(unitId);
	const def = UNIT_BY_ID.get(id);
	if (def) return opts?.short ? def.shortLabel : def.label;
	return id;
}

/** Opciones agrupadas para &lt;select&gt; del modal de insumo. */
export function getInventoryUnitSelectGroups(): {
	groupLabel: string;
	options: { value: string; label: string }[];
}[] {
	return INVENTORY_UNIT_GROUPS.map((g) => ({
		groupLabel: g.label,
		options: INVENTORY_UNITS.filter((u) => u.group === g.id).map((u) => ({
			value: u.id,
			label: `${u.label} (${u.shortLabel})`,
		})),
	}));
}

/** Familias con conversión en recetas (pares de ids canónicos). */
export const CONVERTIBLE_UNIT_FAMILIES: string[][] = [
	["un", "docena"],
	["kg", "g"],
	["l", "ml"],
	["m", "cm"],
];

export function getConvertibleUnitOptions(nativeUnit: string): string[] {
	const n = normalizeUnit(nativeUnit);
	for (const family of CONVERTIBLE_UNIT_FAMILIES) {
		if (family.includes(n)) return [...family];
	}
	return [n];
}
