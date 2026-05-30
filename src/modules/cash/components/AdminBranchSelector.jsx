import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MapPin, ChevronDown, Check } from "lucide-react";

/**
 * Selector de sucursal para la cabecera: mismo lenguaje visual que el sidebar (Lucide + tarjeta),
 * sin el desplegable nativo del navegador.
 */
export default function AdminBranchSelector({
	branches = [],
	selectedBranch = null,
	onSelectBranch,
	disabled = false,
	allowAllOption = false,
	lockTitle = undefined,
	className = "",
}) {
	const uid = React.useId();
	const [open, setOpen] = useState(false);
	const [menuPos, setMenuPos] = useState(null);
	const triggerRef = useRef(null);
	const listId = `${uid}-branch-list`;
	const triggerId = `${uid}-branch-trigger`;

	const selectedId = selectedBranch?.id ?? "";
	const displayName = selectedBranch?.name || "Sucursal";

	const options = React.useMemo(() => {
		const list = Array.isArray(branches) ? [...branches] : [];
		if (allowAllOption) {
			list.push({ id: "all", name: "Todas las sucursales" });
		}
		return list;
	}, [branches, allowAllOption]);

	const updateMenuPos = useCallback(() => {
		const el = triggerRef.current;
		if (!el || typeof el.getBoundingClientRect !== "function") return;
		const r = el.getBoundingClientRect();
		setMenuPos({
			top: r.bottom + 6,
			right: window.innerWidth - r.right,
			minWidth: Math.max(r.width, 220),
		});
	}, []);

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
			if (e.target.closest("[data-admin-branch-select-trigger]")) return;
			setOpen(false);
		};
		const t = window.setTimeout(() => document.addEventListener("click", onDoc), 0);
		return () => {
			window.clearTimeout(t);
			document.removeEventListener("click", onDoc);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	const pick = (id) => {
		if (id === "all") {
			onSelectBranch({ id: "all", name: "Todas las sucursales" });
		} else {
			const b = branches.find((x) => x.id === id);
			if (b) onSelectBranch(b);
		}
		setOpen(false);
	};

	const portalParent = open && menuPos ? getBranchMenuPortalParent() : null;

	const wrapClass = ["branch-selector-wrapper", "admin-branch-select", className].filter(Boolean).join(" ");
	return (
		<div className={wrapClass}>
			<button
				ref={triggerRef}
				type="button"
				id={triggerId}
				data-admin-branch-select-trigger
				className="admin-branch-select__trigger"
				onClick={() => !disabled && setOpen((v) => !v)}
				disabled={disabled}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={open ? listId : undefined}
				title={disabled ? lockTitle : displayName}
			>
				<span className="nav-icon-slot admin-branch-select__pin" aria-hidden>
					<MapPin size={18} strokeWidth={1.65} className="text-accent" />
				</span>
				<span className="admin-branch-select__trigger-text">{displayName}</span>
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
								const isActive = String(opt.id) === String(selectedId);
								return (
									<li key={opt.id} role="presentation">
										<button
											type="button"
											role="option"
											aria-selected={isActive}
											className={`admin-branch-select__item${isActive ? " admin-branch-select__item--active" : ""}`}
											onClick={() => pick(opt.id)}
										>
											<span className="admin-branch-select__item-label">{opt.name}</span>
											{isActive ? <Check size={16} strokeWidth={2.25} className="admin-branch-select__check" aria-hidden /> : null}
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

function getBranchMenuPortalParent() {
	if (typeof document === "undefined") return null;
	return document.querySelector(".admin-layout") || document.body;
}
