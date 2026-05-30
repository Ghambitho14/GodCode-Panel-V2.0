import React, { useCallback, useEffect, useId, useRef, useState } from "react";

import { searchPlaces } from "../services/placesService";

const DEBOUNCE_MS = 380;

/**
 * Input de nombre de zona con sugerencias (Photon / OpenStreetMap, llamada directa).
 * Antes pasaba por el endpoint Next.js `/api/places-autocomplete` del proyecto viejo;
 * ahora consume `placesService.searchPlaces` que llama a Photon directamente desde el
 * navegador (CORS abierto, sin API key). Permite texto libre; las sugerencias son opcionales.
 */
export default function DeliveryPlaceSuggestInput({
	id: idProp,
	value,
	onChange,
	placeholder,
	biasLat,
	biasLng,
	region = "cl",
	disabled,
}) {
	const genId = useId();
	const id = idProp || genId;
	const wrapRef = useRef(null);
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const [fetchError, setFetchError] = useState(null);
	const [items, setItems] = useState([]);
	const [highlight, setHighlight] = useState(-1);
	const debounceRef = useRef(null);
	const abortRef = useRef(null);

	const runSearch = useCallback(
		(q) => {
			const trimmed = String(q ?? "").trim();
			if (trimmed.length < 2) {
				setItems([]);
				setFetchError(null);
				setLoading(false);
				return;
			}
			if (abortRef.current) abortRef.current.abort();
			const ac = new AbortController();
			abortRef.current = ac;
			setLoading(true);
			setFetchError(null);
			searchPlaces({
				q: trimmed,
				region,
				lat: biasLat,
				lng: biasLng,
				signal: ac.signal,
			})
				.then((suggestions) => {
					if (ac.signal.aborted) return;
					setFetchError(null);
					setItems(suggestions);
				})
				.catch((err) => {
					if (ac.signal.aborted) return;
					if (err?.name === "AbortError") return;
					setItems([]);
					setFetchError(
						typeof err?.message === "string" && err.message
							? err.message
							: "Error de red al buscar lugares",
					);
				})
				.finally(() => {
					if (!ac.signal.aborted) setLoading(false);
				});
		},
		[biasLat, biasLng, region],
	);

	useEffect(() => {
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
			if (abortRef.current) abortRef.current.abort();
		};
	}, []);

	useEffect(() => {
		const onDoc = (e) => {
			if (wrapRef.current && !wrapRef.current.contains(e.target)) {
				setOpen(false);
				setHighlight(-1);
			}
		};
		document.addEventListener("mousedown", onDoc);
		return () => document.removeEventListener("mousedown", onDoc);
	}, []);

	const scheduleSearch = useCallback(
		(q) => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
			debounceRef.current = setTimeout(() => runSearch(q), DEBOUNCE_MS);
		},
		[runSearch],
	);

	const pick = useCallback(
		(label) => {
			onChange(label);
			setOpen(false);
			setItems([]);
			setHighlight(-1);
		},
		[onChange],
	);

	return (
		<div ref={wrapRef} className="admin-delivery-place-suggest-wrap">
			<input
				id={id}
				type="text"
				className="form-input"
				placeholder={placeholder}
				value={value}
				disabled={disabled}
				autoComplete="off"
				aria-autocomplete="list"
				aria-expanded={open && items.length > 0}
				onFocus={() => {
					setOpen(true);
					if (String(value).trim().length >= 2) runSearch(value);
				}}
				onChange={(ev) => {
					const v = ev.target.value;
					onChange(v);
					setOpen(true);
					setHighlight(-1);
					scheduleSearch(v);
				}}
				onKeyDown={(ev) => {
					if (!open || items.length === 0) return;
					if (ev.key === "ArrowDown") {
						ev.preventDefault();
						setHighlight((h) => Math.min(items.length - 1, h + 1));
					} else if (ev.key === "ArrowUp") {
						ev.preventDefault();
						setHighlight((h) => Math.max(0, h - 1));
					} else if (ev.key === "Enter" && highlight >= 0) {
						ev.preventDefault();
						pick(items[highlight].label);
					} else if (ev.key === "Escape") {
						setOpen(false);
						setHighlight(-1);
					}
				}}
			/>
			{loading ? (
				<span className="admin-delivery-place-suggest-hint">Buscando en mapa…</span>
			) : null}
			{!loading && fetchError ? (
				<span className="admin-delivery-place-suggest-hint admin-delivery-place-suggest-error">
					{fetchError}
				</span>
			) : null}
			{open && items.length > 0 ? (
				<ul className="admin-delivery-place-suggest-list" role="listbox">
					{items.map((it, i) => (
						<li key={`${it.label}-${i}`} role="option" aria-selected={highlight === i}>
							<button
								type="button"
								className={
									highlight === i
										? "admin-delivery-place-suggest-item is-active"
										: "admin-delivery-place-suggest-item"
								}
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => pick(it.label)}
							>
								{it.label}
							</button>
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}
