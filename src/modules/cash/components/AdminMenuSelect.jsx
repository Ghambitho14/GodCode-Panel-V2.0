import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";

/**
 * Desplegable custom con el mismo aspecto que AdminBranchSelector (cabecera),
 * sin lista nativa del navegador.
 */
export default function AdminMenuSelect({
	options = [],
	value,
	onChange,
	icon = null,
	disabled = false,
	className = "",
	menuMinWidth = 200,
	"aria-label": ariaLabel,
}) {
	const uid = React.useId();
	const [open, setOpen] = useState(false);
	const [menuPos, setMenuPos] = useState(null);
	const triggerRef = useRef(null);
	const listId = `${uid}-menu-list`;
	const triggerId = `${uid}-menu-trigger`;

	const selected = options.find((o) => String(o.value) === String(value));
	const displayLabel = selected?.label ?? "—";

	const updateMenuPos = useCallback(() => {
		const el = triggerRef.current;
		if (!el || typeof el.getBoundingClientRect !== "function") return;
		const r = el.getBoundingClientRect();
		setMenuPos({
			top: r.bottom + 6,
			right: window.innerWidth - r.right,
			minWidth: Math.max(r.width, menuMinWidth),
		});
	}, [menuMinWidth]);

	useLayoutEffect(() => {
		if (!open) return undefined;
		updateMenuPos();
		const onReposition = () => updateMenuPos();
		window.addEventListener("scroll", onReposition, true);
		window.addEventListener("resize", onReposition);
		return () => {
			window.removeEventListener("scroll", onReposition, true);
			window.removeEventListener("resize", onReposition);
		};
	}, [open, updateMenuPos]);

	useEffect(() => {
		if (!open) return undefined;
		const onKey = (e) => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("keydown", onKey);
		const onDoc = (e) => {
			if (!(e.target instanceof Element)) {
				setOpen(false);
				return;
			}
			if (e.target.closest(".admin-branch-select__menu-portal")) return;
			if (e.target.closest("[data-admin-menu-select-trigger]")) return;
			setOpen(false);
		};
		const t = window.setTimeout(() => document.addEventListener("click", onDoc), 0);
		return () => {
			window.clearTimeout(t);
			document.removeEventListener("click", onDoc);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	const pick = (v) => {
		onChange(String(v));
		setOpen(false);
	};

	const portalParent = open && menuPos ? getMenuSelectPortalParent() : null;

	const wrapClass = ["admin-branch-select", className].filter(Boolean).join(" ");

	return (
		<div className={wrapClass}>
			<button
				ref={triggerRef}
				type="button"
				id={triggerId}
				data-admin-menu-select-trigger
				className="admin-branch-select__trigger"
				onClick={() => !disabled && setOpen((v) => !v)}
				disabled={disabled}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={open ? listId : undefined}
				aria-label={ariaLabel}
			>
				{icon ? (
					<span className="nav-icon-slot admin-branch-select__pin" aria-hidden>
						{icon}
					</span>
				) : null}
				<span className="admin-branch-select__trigger-text">{displayLabel}</span>
				<ChevronDown
					size={18}
					strokeWidth={1.65}
					className={`admin-branch-select__chevron${open ? " is-open" : ""}`}
					aria-hidden
				/>
			</button>
			{portalParent
				? createPortal(
						<ul
							id={listId}
							role="listbox"
							aria-labelledby={triggerId}
							className="admin-branch-select__menu-portal"
							style={{
								top: menuPos.top,
								right: menuPos.right,
								minWidth: menuPos.minWidth,
							}}
						>
							{options.map((opt) => {
								const isActive = String(opt.value) === String(value);
								return (
									<li key={String(opt.value)} role="presentation">
										<button
											type="button"
											role="option"
											aria-selected={isActive}
											className={`admin-branch-select__item${isActive ? " admin-branch-select__item--active" : ""}`}
											onClick={() => pick(opt.value)}
										>
											<span className="admin-branch-select__item-label">{opt.label}</span>
											{isActive ? (
												<Check size={16} strokeWidth={2.25} className="admin-branch-select__check" aria-hidden />
											) : null}
										</button>
									</li>
								);
							})}
						</ul>,
						portalParent,
				  )
				: null}
		</div>
	);
}

function getMenuSelectPortalParent() {
	if (typeof document === "undefined") return null;
	return document.querySelector(".admin-layout") || document.body;
}
