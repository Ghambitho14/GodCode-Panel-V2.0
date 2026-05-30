import React, { useEffect, useState } from "react";

function capWord(s) {
	const t = String(s || "")
		.replace(/\./g, "")
		.trim();
	if (!t) return "";
	return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

function formatClock(d) {
	const time = d.toLocaleTimeString("es-CL", {
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
	const wd = capWord(d.toLocaleDateString("es-CL", { weekday: "short" }));
	const mo = capWord(d.toLocaleDateString("es-CL", { month: "short" }));
	const day = d.getDate();
	const dateLine = `${wd}, ${day} ${mo}`;
	return { time, dateLine };
}

/**
 * Reloj digital en vivo (hora local del dispositivo) + fecha corta tipo "Dom, 29 Mar".
 * dataSyncedAtLabel: texto opcional para tooltip (última sync de datos del panel).
 */
export default function AdminHeaderClock({ dataSyncedAtLabel = null, className = "" }) {
	const [, setTick] = useState(0);

	useEffect(() => {
		const id = window.setInterval(() => setTick((n) => n + 1), 1000);
		return () => window.clearInterval(id);
	}, []);

	const { time, dateLine } = formatClock(new Date());

	const title = [
		"Hora local del dispositivo",
		dataSyncedAtLabel ? `Última actualización de datos: ${dataSyncedAtLabel}` : null,
	]
		.filter(Boolean)
		.join(" · ");

	const aria = dataSyncedAtLabel
		? `Reloj ${time}, ${dateLine}. Datos del panel actualizados: ${dataSyncedAtLabel}`
		: `Reloj ${time}, ${dateLine}`;

	const rootClass = ["admin-header-clock", className].filter(Boolean).join(" ");
	return (
		<div className={rootClass} title={title} aria-label={aria}>
			<span className="admin-header-clock__time" aria-hidden="true">
				{time}
			</span>
			<span className="admin-header-clock__date" aria-hidden="true">
				{dateLine}
			</span>
		</div>
	);
}
