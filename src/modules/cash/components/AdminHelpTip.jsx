import React from "react";
import { HelpCircle } from "lucide-react";

/**
 * Icono de ayuda con burbuja al hover/focus (sustituye tooltips nativos feos).
 */
export default function AdminHelpTip({ text, className = "" }) {
	if (!text) return null;
	return (
		<span
			className={`admin-help-tip ${className}`.trim()}
			tabIndex={0}
			aria-label={text}
		>
			<HelpCircle size={15} strokeWidth={1.75} className="admin-help-tip__glyph" aria-hidden />
			<span className="admin-help-tip__bubble" aria-hidden="true">
				{text}
			</span>
		</span>
	);
}
