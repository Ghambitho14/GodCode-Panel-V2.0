import React from "react";

/**
 * Lucide dentro de contenedor redondo, mismo lenguaje visual que la sidebar (nav-icon-slot).
 */
export default function AdminIconSlot({
	Icon,
	size,
	slotSize = "md",
	tone = "neutral",
	className = "",
	style,
	...iconProps
}) {
	const toneClass = tone !== "neutral" ? `admin-lucide-slot--${tone}` : "";
	const cls = ["admin-lucide-slot", `admin-lucide-slot--${slotSize}`, toneClass, className]
		.filter(Boolean)
		.join(" ");

	const iconPx =
		size ??
		({
			xxs: 11,
			xs: 13,
			sm: 15,
			md: 17,
			lg: 19,
		}[slotSize] ?? 17);

	return (
		<span className={cls} style={style}>
			<Icon size={iconPx} strokeWidth={1.65} aria-hidden {...iconProps} />
		</span>
	);
}
