import { useCallback, useLayoutEffect, useState } from 'react';
import { getScrollableAncestors } from '@/shared/utils/scrollAncestors';

/**
 * Posición viewport para menús anclados a un botón (portal fixed).
 * Reposiciona en scroll/resize como el kebab de clientes.
 */
export function useAnchoredMenuPosition(anchorRef, isOpen, options = {}) {
	const [pos, setPos] = useState(null);

	const updatePos = useCallback(() => {
		const el = anchorRef?.current;
		if (!el || typeof el.getBoundingClientRect !== 'function') return;

		const r = el.getBoundingClientRect();
		const margin = 10;
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const menuW = Number(options.menuWidth) || 220;
		const menuH = Number(options.menuHeight) || 200;
		const gap = Number(options.gap) || 6;

		let left = options.align === 'left' ? r.left : r.right - menuW;
		left = Math.max(margin, Math.min(left, vw - menuW - margin));

		let top = r.bottom + gap;
		if (top + menuH > vh - margin) {
			top = Math.max(margin, r.top - menuH - gap);
		}

		setPos({ top, left });
	}, [anchorRef, options.align, options.gap, options.menuHeight, options.menuWidth]);

	useLayoutEffect(() => {
		if (!isOpen) {
			setPos(null);
			return undefined;
		}

		let rafId = null;
		const runReposition = () => updatePos();
		const scheduleReposition = () => {
			if (rafId != null) return;
			rafId = requestAnimationFrame(() => {
				rafId = null;
				runReposition();
			});
		};

		runReposition();

		const anchor = anchorRef?.current;
		const scrollRoots = anchor ? getScrollableAncestors(anchor) : [];
		const mainContent =
			typeof document !== 'undefined'
				? document.querySelector('.admin-layout main.admin-content')
				: null;
		const extraScrollRoots =
			mainContent && !scrollRoots.includes(mainContent) ? [mainContent] : [];

		scrollRoots.forEach((el) => {
			el.addEventListener('scroll', runReposition, { passive: true });
		});
		extraScrollRoots.forEach((el) => {
			el.addEventListener('scroll', runReposition, { passive: true });
		});
		window.addEventListener('scroll', runReposition, true);
		window.addEventListener('resize', scheduleReposition);

		const vv = typeof window !== 'undefined' ? window.visualViewport : null;
		if (vv) {
			vv.addEventListener('resize', scheduleReposition);
			vv.addEventListener('scroll', runReposition);
		}

		return () => {
			if (rafId != null) cancelAnimationFrame(rafId);
			scrollRoots.forEach((el) => {
				el.removeEventListener('scroll', runReposition);
			});
			extraScrollRoots.forEach((el) => {
				el.removeEventListener('scroll', runReposition);
			});
			window.removeEventListener('scroll', runReposition, true);
			window.removeEventListener('resize', scheduleReposition);
			if (vv) {
				vv.removeEventListener('resize', scheduleReposition);
				vv.removeEventListener('scroll', runReposition);
			}
		};
	}, [isOpen, anchorRef, updatePos]);

	return pos;
}
