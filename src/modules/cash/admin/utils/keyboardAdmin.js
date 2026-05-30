/**
 * @param {KeyboardEvent} e
 * @returns {boolean}
 */
export function isModKey(e) {
	return Boolean(e.metaKey || e.ctrlKey);
}

/**
 * @param {EventTarget | null} target
 * @returns {boolean}
 */
export function isTypingContext(target) {
	if (!target || typeof target !== 'object') return false;
	const el = /** @type {HTMLElement} */ (target);
	const tag = (el.tagName || '').toUpperCase();
	if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
	if (el.isContentEditable) return true;
	return Boolean(el.closest?.('[data-admin-command-palette="true"]'));
}
