/**
 * @param {unknown} n
 * @param {number} [fallback=0]
 * @returns {number}
 */
export function safeNumber(n, fallback = 0) {
	const x = Number(n);
	return Number.isFinite(x) ? x : fallback;
}

/**
 * Entero/formateo CLP sin símbolo (solo separadores miles), para tablas.
 * @param {unknown} value
 * @returns {string}
 */
export function formatMoneyCl(value) {
	return safeNumber(value, 0).toLocaleString("es-CL");
}
