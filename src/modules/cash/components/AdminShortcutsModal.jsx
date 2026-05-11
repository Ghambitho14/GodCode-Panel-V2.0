import React from 'react';
import { Keyboard } from 'lucide-react';

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {{ keys: string; description: string; group?: string }[]} props.rows
 */
export function AdminShortcutsModal({ open, onClose, rows }) {
	if (!open) return null;

	const grouped = rows.reduce((acc, row) => {
		const g = row.group || 'General';
		if (!acc[g]) acc[g] = [];
		acc[g].push(row);
		return acc;
	}, /** @type {Record<string, typeof rows>} */ ({}));

	return (
		<div
			className="admin-modal-overlay admin-shortcuts-modal-overlay"
			role="dialog"
			aria-modal="true"
			aria-label="Atajos de teclado"
			onClick={onClose}
		>
			<div
				className="glass admin-shortcuts-modal-panel"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="admin-shortcuts-modal-head">
					<Keyboard size={22} className="admin-shortcuts-modal-icon" />
					<h2 className="admin-shortcuts-modal-title">Atajos de teclado</h2>
				</div>
				{Object.entries(grouped).map(([group, list]) => (
					<div key={group} className="admin-shortcuts-modal-group">
						<p className="admin-shortcuts-modal-group-label">{group}</p>
						<table className="admin-shortcuts-modal-table">
							<tbody>
								{list.map((row, i) => (
									<tr key={`${group}-${i}`} className="admin-shortcuts-modal-row">
										<td className="admin-shortcuts-modal-keys">
											<code className="admin-shortcuts-modal-kbd">{row.keys}</code>
										</td>
										<td className="admin-shortcuts-modal-desc">{row.description}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				))}
				<button type="button" className="admin-btn secondary admin-shortcuts-modal-close" onClick={onClose}>
					Cerrar
				</button>
			</div>
		</div>
	);
}

export default AdminShortcutsModal;
