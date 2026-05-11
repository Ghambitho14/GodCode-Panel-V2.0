import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {{ id: string; label: string; group?: string }[]} props.items
 * @param {(id: string) => void} props.onSelect
 */
export function AdminCommandPalette({ open, onClose, items, onSelect }) {
	const [q, setQ] = useState("");
	const inputRef = useRef(null);

	const filtered = useMemo(() => {
		const s = q.trim().toLowerCase();
		if (!s) return items;
		return items.filter(
			(it) =>
				it.label.toLowerCase().includes(s) ||
				it.id.toLowerCase().includes(s) ||
				(it.group && it.group.toLowerCase().includes(s)),
		);
	}, [items, q]);

	useEffect(() => {
		if (!open) return undefined;
		// eslint-disable-next-line react-hooks/set-state-in-effect -- sincronizar UI al abrir
		setQ("");
		const t = setTimeout(() => {
			inputRef.current?.focus();
		}, 10);
		return () => clearTimeout(t);
	}, [open]);

	if (!open) return null;

	return (
		<div
			className="admin-modal-overlay admin-command-palette-overlay"
			role="dialog"
			aria-modal="true"
			aria-label="Ir a sección"
			data-admin-command-palette="true"
			onClick={onClose}
		>
			<div
				className="glass admin-command-palette"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="admin-command-palette-search">
					<Search size={18} className="admin-command-palette-search-icon" />
					<input
						ref={inputRef}
						value={q}
						onChange={(e) => setQ(e.target.value)}
						placeholder="Buscar sección…"
						className="admin-command-palette-input"
					/>
				</div>
				<ul className="admin-command-palette-list">
					{filtered.length === 0 ? (
						<li className="admin-command-palette-empty">Sin coincidencias</li>
					) : (
						filtered.map((it) => (
							<li key={it.id}>
								<button
									type="button"
									className="admin-command-palette-item"
									onClick={() => {
										onSelect(it.id);
										onClose();
									}}
								>
									<span className="admin-command-palette-item-label">{it.label}</span>
									{it.group ? (
										<span className="admin-command-palette-item-group">{it.group}</span>
									) : null}
								</button>
							</li>
						))
					)}
				</ul>
				<p className="admin-command-palette-hint">Esc para cerrar</p>
			</div>
		</div>
	);
}

export default AdminCommandPalette;
