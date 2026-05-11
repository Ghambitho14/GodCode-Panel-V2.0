/**
 * Contenedores con scroll en la jerarquía DOM (p. ej. main.admin-content):
 * el evento scroll no sube a window.
 * @param {Element | null | undefined} element
 * @returns {Element[]}
 */
export function getScrollableAncestors(element) {
	if (!element || typeof element.parentElement === "undefined") return [];
	const list = [];
	let node = element.parentElement;
	while (node && node !== document.documentElement) {
		const st = window.getComputedStyle(node);
		const oy = st.overflowY;
		const ox = st.overflowX;
		if (
			oy === "auto" ||
			oy === "scroll" ||
			oy === "overlay" ||
			ox === "auto" ||
			ox === "scroll" ||
			ox === "overlay"
		) {
			list.push(node);
		}
		node = node.parentElement;
	}
	return list;
}
