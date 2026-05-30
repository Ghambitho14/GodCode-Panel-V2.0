import React, { useCallback, useEffect, useState } from 'react';
import {
	Loader2, Trash2, ChevronUp, ChevronDown, ImagePlus, Star, MoreVertical,
	MonitorSmartphone, Calendar, GripVertical, ExternalLink, Sparkles, WandSparkles,
} from 'lucide-react';
import { uploadImage } from '@/shared/utils/cloudinary';
import {
	listMenuCarousel,
	createBanner,
	reorderBanners,
	saveCarouselSettings,
	patchBanner as patchBannerService,
	deleteBanner,
} from '../services/menuCarouselService';
import AdminIconSlot from './AdminIconSlot';
import '../styles/AdminMenuCarousel.css';

const shortUrlSnippet = (url) => {
	if (!url) return '—';
	try {
		if (url.startsWith('http://') || url.startsWith('https://')) {
			const u = new URL(url);
			const parts = u.pathname.split('/').filter(Boolean);
			const last = parts[parts.length - 1] || u.hostname;
			return last.length > 40 ? `${last.slice(0, 38)}…` : last;
		}
	} catch {
		/* ignore */
	}
	const t = url.replace(/^https?:\/\//, '');
	return t.length > 44 ? `${t.slice(0, 42)}…` : t;
};

const isCloudinaryUrl = (url) => typeof url === 'string' && url.includes('res.cloudinary.com');
const TARGET_RATIO = 2.35;
const MIN_WIDTH = 1920;
const MIN_HEIGHT = 817;
const RATIO_TOLERANCE = 0.03;

const humanSize = (n) => `${Math.round(n).toLocaleString('es-CL')}px`;

const readImageDimensions = (file) => new Promise((resolve, reject) => {
	const objectUrl = URL.createObjectURL(file);
	const img = new Image();
	img.onload = () => {
		const dims = { width: img.naturalWidth, height: img.naturalHeight };
		URL.revokeObjectURL(objectUrl);
		resolve(dims);
	};
	img.onerror = () => {
		URL.revokeObjectURL(objectUrl);
		reject(new Error('No se pudieron leer las dimensiones de la imagen.'));
	};
	img.src = objectUrl;
});

const analyzeImage = ({ width, height }) => {
	const ratio = width / Math.max(1, height);
	const ratioDiff = Math.abs(ratio - TARGET_RATIO);
	const ratioOk = ratioDiff <= RATIO_TOLERANCE;
	const minOk = width >= MIN_WIDTH && height >= MIN_HEIGHT;
	const valid = ratioOk && minOk;
	return { ratio, ratioOk, minOk, valid };
};

const fitCropRect = (dims, crop) => {
	const maxX = Math.max(0, dims.width - crop.width);
	const maxY = Math.max(0, dims.height - crop.height);
	return {
		x: Math.min(Math.max(0, crop.x), maxX),
		y: Math.min(Math.max(0, crop.y), maxY),
		width: crop.width,
		height: crop.height,
	};
};

const buildInitialCrop = ({ width, height }) => {
	const srcRatio = width / Math.max(1, height);
	let cropWidth = width;
	let cropHeight = Math.round(width / TARGET_RATIO);
	if (srcRatio < TARGET_RATIO) {
		cropHeight = height;
		cropWidth = Math.round(height * TARGET_RATIO);
	}
	const x = Math.max(0, Math.round((width - cropWidth) / 2));
	const y = Math.max(0, Math.round((height - cropHeight) / 2));
	return { x, y, width: cropWidth, height: cropHeight };
};

const canvasFromCrop = async (previewUrl, crop) => {
	const img = new Image();
	img.crossOrigin = 'anonymous';
	const loaded = new Promise((resolve, reject) => {
		img.onload = resolve;
		img.onerror = reject;
	});
	img.src = previewUrl;
	await loaded;
	const out = document.createElement('canvas');
	out.width = Math.max(MIN_WIDTH, Math.round(crop.width));
	out.height = Math.max(MIN_HEIGHT, Math.round(crop.height));
	const ctx = out.getContext('2d');
	if (!ctx) throw new Error('No se pudo preparar el editor.');
	ctx.imageSmoothingQuality = 'high';
	ctx.drawImage(
		img,
		crop.x,
		crop.y,
		crop.width,
		crop.height,
		0,
		0,
		out.width,
		out.height,
	);
	return out;
};

const filenameFromUrl = (url) => {
	try {
		const u = new URL(url);
		const out = u.pathname.split('/').filter(Boolean).pop();
		return out || `carousel-${Date.now()}.jpg`;
	} catch {
		return `carousel-${Date.now()}.jpg`;
	}
};

export default function AdminMenuCarousel({
	showNotify,
	selectedBranch,
	companyId,
}) {
	const [loading, setLoading] = useState(true);
	const [savingSettings, setSavingSettings] = useState(false);
	const [uploading, setUploading] = useState(false);
	const [banners, setBanners] = useState([]);
	const [intervalSec, setIntervalSec] = useState(5);
	const [maxSlides, setMaxSlides] = useState(10);
	const [menuOpenId, setMenuOpenId] = useState(null);
	const [pendingUpload, setPendingUpload] = useState(null);
	const [editorZoom, setEditorZoom] = useState(1);
	const [editorOffsetX, setEditorOffsetX] = useState(0.5);
	const [editorOffsetY, setEditorOffsetY] = useState(0.5);
	const [editorMode, setEditorMode] = useState('cover');
	const [editing, setEditing] = useState(false);

	const branchId = selectedBranch?.id && selectedBranch.id !== 'all' ? selectedBranch.id : null;
	const cloudinaryFolder = companyId && branchId
		? `menu_carousel/${companyId}/${branchId}`
		: 'menu_carousel';

	const load = useCallback(async () => {
		if (!branchId) {
			setBanners([]);
			setLoading(false);
			return;
		}
		if (!companyId) {
			setBanners([]);
			setLoading(false);
			return;
		}
		setLoading(true);
		try {
			const { banners: list, settings } = await listMenuCarousel({ branchId, companyId });
			setBanners(Array.isArray(list) ? list : []);
			const s = settings || {};
			setIntervalSec(Math.max(2, Math.round((s.intervalMs ?? 5000) / 1000)));
			setMaxSlides(s.maxSlides ?? 10);
		} catch (e) {
			setBanners([]);
			showNotify(e instanceof Error ? e.message : 'Error al cargar', 'error');
		} finally {
			setLoading(false);
		}
	}, [branchId, companyId, showNotify]);

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		if (!menuOpenId) return undefined;
		const onKey = (e) => {
			if (e.key === 'Escape') setMenuOpenId(null);
		};
		document.addEventListener('keydown', onKey);
		/** Evita que el mismo clic que abre el menú dispare el cierre en fase burbuja. */
		const onDoc = (e) => {
			if (e.target instanceof Element && e.target.closest('.menu-carousel-kebab-wrap')) return;
			setMenuOpenId(null);
		};
		const t = window.setTimeout(() => {
			document.addEventListener('click', onDoc);
		}, 0);
		return () => {
			window.clearTimeout(t);
			document.removeEventListener('click', onDoc);
			document.removeEventListener('keydown', onKey);
		};
	}, [menuOpenId]);

	const persistReorder = async (nextList) => {
		if (!branchId || !companyId) return;
		const orderedIds = nextList.map((b) => b.id);
		await reorderBanners({ branchId, companyId, orderedIds });
	};

	const move = async (index, dir) => {
		const j = index + dir;
		if (j < 0 || j >= banners.length) return;
		const next = [...banners];
		[next[index], next[j]] = [next[j], next[index]];
		setBanners(next);
		try {
			await persistReorder(next);
		} catch (e) {
			showNotify(e instanceof Error ? e.message : 'Error al reordenar', 'error');
			void load();
		}
	};

	const saveSettings = async () => {
		if (!companyId) {
			showNotify('Falta identificar la empresa', 'error');
			return;
		}
		setSavingSettings(true);
		try {
			const intervalMs = Math.min(60, Math.max(2, Number(intervalSec) || 5)) * 1000;
			const clampedMaxSlides = Math.min(20, Math.max(1, Number(maxSlides) || 10));
			const out = await saveCarouselSettings({
				companyId,
				intervalMs,
				maxSlides: clampedMaxSlides,
			});
			setIntervalSec(Math.round((out.intervalMs ?? intervalMs) / 1000));
			setMaxSlides(out.maxSlides ?? clampedMaxSlides);
			showNotify('Ajustes del carrusel guardados.');
		} catch (e) {
			showNotify(e instanceof Error ? e.message : 'Error al guardar', 'error');
		} finally {
			setSavingSettings(false);
		}
	};

	const patchBanner = async (bannerId, payload) => {
		if (!companyId) {
			throw new Error('Falta identificar la empresa');
		}
		return await patchBannerService({ bannerId, companyId, patches: payload });
	};

	const mergeBanner = (bannerId, updated) => {
		if (!updated) return;
		setBanners((prev) => prev.map((b) => (b.id === bannerId ? { ...b, ...updated } : b)));
	};

	const bannerPromoOn = (b) => b.promotion_duration_enabled === true;

	const toggleBannerPromo = async (banner) => {
		const next = !bannerPromoOn(banner);
		const days = Math.min(90, Math.max(1, Number(banner.promotion_duration_days) || 7));
		try {
			const updated = await patchBanner(banner.id, {
				promotion_duration_enabled: next,
				promotion_duration_days: days,
			});
			mergeBanner(banner.id, updated);
			showNotify(next ? 'Duración de promoción activada para esta imagen.' : 'Sin límite de días para esta imagen.');
		} catch (e) {
			showNotify(e instanceof Error ? e.message : 'Error', 'error');
			void load();
		}
	};

	const saveBannerPromoDays = async (banner, raw) => {
		if (!bannerPromoOn(banner)) return;
		const d = Math.min(90, Math.max(1, Math.round(Number(raw)) || 7));
		const prev = Math.min(90, Math.max(1, Number(banner.promotion_duration_days) || 7));
		if (d === prev) return;
		try {
			const updated = await patchBanner(banner.id, {
				promotion_duration_enabled: true,
				promotion_duration_days: d,
			});
			mergeBanner(banner.id, updated);
			showNotify('Días de promoción actualizados.');
		} catch (e) {
			showNotify(e instanceof Error ? e.message : 'Error', 'error');
			void load();
		}
	};

	const toggleActive = async (banner) => {
		try {
			const updated = await patchBanner(banner.id, { is_active: !banner.is_active });
			mergeBanner(banner.id, updated);
			if (!updated) {
				setBanners((prev) => prev.map((b) => (
					b.id === banner.id ? { ...b, is_active: !b.is_active } : b
				)));
			}
			showNotify(banner.is_active ? 'Diapositiva oculta en el menú.' : 'Diapositiva activa.');
		} catch (e) {
			showNotify(e instanceof Error ? e.message : 'Error', 'error');
		}
	};

	const removeBanner = async (banner) => {
		if (!window.confirm('¿Eliminar esta imagen del carrusel?')) return;
		if (!companyId) {
			showNotify('Falta identificar la empresa', 'error');
			return;
		}
		setMenuOpenId(null);
		try {
			await deleteBanner({ bannerId: banner.id, companyId });
			setBanners((prev) => prev.filter((b) => b.id !== banner.id));
			showNotify('Imagen eliminada.');
		} catch (e) {
			showNotify(e instanceof Error ? e.message : 'Error', 'error');
		}
	};

	const uploadAndCreateBanner = async (fileToUpload) => {
		if (!branchId) return;
		if (!companyId) {
			throw new Error('Falta identificar la empresa');
		}
		const url = await uploadImage(fileToUpload, cloudinaryFolder);
		const banner = await createBanner({ branchId, companyId, imageUrl: url });
		if (banner) {
			setBanners((prev) => [...prev, banner].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)));
		}
	};

	const uploadAndReplaceBannerImage = async (bannerId, fileToUpload) => {
		const url = await uploadImage(fileToUpload, cloudinaryFolder);
		const updated = await patchBanner(bannerId, { image_url: url });
		mergeBanner(bannerId, updated);
	};

	const dismissPendingUpload = () => {
		setPendingUpload((prev) => {
			if (prev?.previewUrl && prev?.previewSource === 'file') URL.revokeObjectURL(prev.previewUrl);
			return null;
		});
		setEditorZoom(1);
		setEditorOffsetX(0.5);
		setEditorOffsetY(0.5);
		setEditorMode('cover');
		setEditing(false);
	};

	const continueWithoutEditing = async () => {
		if (!pendingUpload?.file) return;
		if (pendingUpload.mode !== 'create') {
			dismissPendingUpload();
			return;
		}
		setUploading(true);
		try {
			await uploadAndCreateBanner(pendingUpload.file);
			showNotify('Imagen subida al carrusel.');
			dismissPendingUpload();
		} catch (err) {
			showNotify(err instanceof Error ? err.message : 'Error al subir', 'error');
		} finally {
			setUploading(false);
		}
	};

	const saveEditedImage = async () => {
		if (!pendingUpload?.file || !pendingUpload?.dimensions) return;
		setEditing(true);
		setUploading(true);
		try {
			const dims = pendingUpload.dimensions;
			let canvas;
			if (editorMode === 'contain') {
				const img = new Image();
				img.crossOrigin = 'anonymous';
				const loaded = new Promise((resolve, reject) => {
					img.onload = resolve;
					img.onerror = reject;
				});
				img.src = pendingUpload.previewUrl;
				await loaded;
				const out = document.createElement('canvas');
				out.width = MIN_WIDTH;
				out.height = MIN_HEIGHT;
				const ctx = out.getContext('2d');
				if (!ctx) throw new Error('No se pudo preparar el editor.');
				const baseScale = Math.max(out.width / img.naturalWidth, out.height / img.naturalHeight);
				const scale = baseScale * Math.min(2.2, Math.max(1, Number(editorZoom) || 1));
				const drawW = img.naturalWidth * scale;
				const drawH = img.naturalHeight * scale;
				const ox = (out.width - drawW) * Math.min(Math.max(editorOffsetX, 0), 1);
				const oy = (out.height - drawH) * Math.min(Math.max(editorOffsetY, 0), 1);
				ctx.imageSmoothingQuality = 'high';
				ctx.drawImage(img, ox, oy, drawW, drawH);
				canvas = out;
			} else {
				const minZoom = Math.max(TARGET_RATIO / (dims.width / Math.max(1, dims.height)), 1);
				const zoom = Math.max(minZoom, Number(editorZoom) || 1);
				const cropWidth = dims.width / zoom;
				const cropHeight = cropWidth / TARGET_RATIO;
				const x = (dims.width - cropWidth) * Math.min(Math.max(editorOffsetX, 0), 1);
				const y = (dims.height - cropHeight) * Math.min(Math.max(editorOffsetY, 0), 1);
				const crop = fitCropRect(dims, { x, y, width: cropWidth, height: cropHeight });
				canvas = await canvasFromCrop(pendingUpload.previewUrl, crop);
			}
			const blob = await new Promise((resolve, reject) => {
				canvas.toBlob((out) => {
					if (!out) {
						reject(new Error('No se pudo exportar la imagen editada.'));
						return;
					}
					resolve(out);
				}, pendingUpload.file.type || 'image/jpeg', 0.92);
			});
			const ext = (pendingUpload.file.name.split('.').pop() || 'jpg').replace(/[^a-zA-Z0-9]/g, '') || 'jpg';
			const edited = new File([blob], `carousel-edited-${Date.now()}.${ext}`, {
				type: blob.type || pendingUpload.file.type || 'image/jpeg',
			});
			if (pendingUpload.mode === 'replace' && pendingUpload.bannerId) {
				await uploadAndReplaceBannerImage(pendingUpload.bannerId, edited);
				showNotify('Imagen ajustada y actualizada.');
			} else {
				await uploadAndCreateBanner(edited);
				showNotify('Imagen editada y subida al carrusel.');
			}
			dismissPendingUpload();
		} catch (err) {
			showNotify(err instanceof Error ? err.message : 'Error al editar/subir', 'error');
		} finally {
			setEditing(false);
			setUploading(false);
		}
	};

	const openEditorForBanner = async (banner) => {
		if (!banner?.image_url) return;
		setMenuOpenId(null);
		setEditing(true);
		try {
			const res = await fetch(banner.image_url, { mode: 'cors' });
			if (!res.ok) throw new Error('No se pudo cargar la imagen para editar.');
			const blob = await res.blob();
			const fallbackType = blob.type || 'image/jpeg';
			const file = new File([blob], filenameFromUrl(banner.image_url), { type: fallbackType });
			const dimensions = await readImageDimensions(file);
			const analysis = analyzeImage(dimensions);
			const initialCrop = buildInitialCrop(dimensions);
			const previewUrl = URL.createObjectURL(file);
			setPendingUpload({
				mode: 'replace',
				bannerId: banner.id,
				file,
				dimensions,
				previewUrl,
				previewSource: 'file',
				result: analysis,
			});
			const ratio = dimensions.width / Math.max(1, dimensions.height);
			const minZoom = Math.max(TARGET_RATIO / ratio, 1);
			setEditorZoom(Number(minZoom.toFixed(2)));
			setEditorMode('cover');
			setEditorOffsetX((initialCrop.x / Math.max(1, dimensions.width - initialCrop.width)) || 0.5);
			setEditorOffsetY((initialCrop.y / Math.max(1, dimensions.height - initialCrop.height)) || 0.5);
		} catch (err) {
			showNotify(err instanceof Error ? err.message : 'No se pudo abrir el editor', 'error');
		} finally {
			setEditing(false);
		}
	};

	const onPickFile = async (e) => {
		const file = e.target.files?.[0];
		e.target.value = '';
		if (!file || !branchId) return;
		try {
			const dimensions = await readImageDimensions(file);
			const result = analyzeImage(dimensions);
			if (result.valid) {
				setUploading(true);
				await uploadAndCreateBanner(file);
				showNotify('Imagen subida al carrusel.');
				return;
			}
			const ratioTxt = `${result.ratio.toFixed(2)}:1`;
			const reasonRatio = result.ratioOk ? null : `proporción actual ${ratioTxt}, objetivo 2.35:1`;
			const reasonMin = result.minOk ? null : `mínimo ${MIN_WIDTH}x${MIN_HEIGHT}, actual ${dimensions.width}x${dimensions.height}`;
			const reasons = [reasonRatio, reasonMin].filter(Boolean).join(' · ');
			showNotify(`La imagen no calza: ${reasons}. Puedes editarla o subirla igual.`, 'error');
			const previewUrl = URL.createObjectURL(file);
			setPendingUpload({
				mode: 'create',
				file,
				dimensions,
				previewUrl,
				previewSource: 'file',
				result,
			});
			const minZoom = Math.max(TARGET_RATIO / result.ratio, 1);
			setEditorZoom(Number(minZoom.toFixed(2)));
			setEditorMode('cover');
			setEditorOffsetX(0.5);
			setEditorOffsetY(0.5);
		} catch (err) {
			showNotify(err instanceof Error ? err.message : 'Error al subir', 'error');
		} finally {
			setUploading(false);
		}
	};

	const editorView = pendingUpload && (() => {
		const dims = pendingUpload.dimensions;
		const ratio = dims.width / Math.max(1, dims.height);
		const minZoom = Math.max(TARGET_RATIO / ratio, 1);
		const maxZoom = editorMode === 'contain' ? 2.2 : 4;
		const currentZoom = Math.min(maxZoom, Math.max(minZoom, Number(editorZoom) || minZoom));
		const cropWidth = dims.width / currentZoom;
		const cropHeight = cropWidth / TARGET_RATIO;
		const safeX = Math.min(Math.max(editorOffsetX, 0), 1);
		const safeY = Math.min(Math.max(editorOffsetY, 0), 1);
		const x = (dims.width - cropWidth) * safeX;
		const y = (dims.height - cropHeight) * safeY;
		const crop = fitCropRect(dims, { x, y, width: cropWidth, height: cropHeight });
		return { minZoom, maxZoom, currentZoom, crop };
	})();

	if (!branchId) {
		return (
			<div className="glass animate-fade menu-carousel-panel menu-carousel-panel-inner">
				<div className="menu-carousel-branch-hint">
					<p className="menu-carousel-hint">
						Selecciona una <strong className="text-accent">sucursal</strong> en el encabezado para editar el carrusel del menú (cada local tiene su propia lista de imágenes).
					</p>
				</div>
			</div>
		);
	}

	if (loading) {
		return (
			<div className="glass animate-fade menu-carousel-panel menu-carousel-panel-inner menu-carousel-loading">
				<AdminIconSlot Icon={Loader2} slotSize="lg" className="animate-spin" />
			</div>
		);
	}

	const branchLabel = selectedBranch?.name ? ` · ${selectedBranch.name}` : '';

	return (
		<div className="glass animate-fade menu-carousel-panel menu-carousel-panel-inner">
			<header className="menu-carousel-header">
				<p className="menu-carousel-eyebrow">Menú público · Carrusel</p>
				<h2 className="menu-carousel-title">
					Imágenes del carrusel{branchLabel}
				</h2>
				<p className="menu-carousel-sub">
					Configura el orden y la visibilidad de cada diapositiva. El intervalo entre fotos y cuántas rotan a la vez se aplican a toda la empresa en el menú público.
				</p>
			</header>

			<section className="menu-carousel-settings-block" aria-labelledby="carousel-settings-heading">
				<h3 id="carousel-settings-heading">Comportamiento en el menú</h3>
				<div className="menu-carousel-settings">
					<div className="form-group">
						<label htmlFor="carousel-interval">Segundos entre fotos</label>
						<input
							id="carousel-interval"
							type="number"
							min={2}
							max={60}
							value={intervalSec}
							onChange={(ev) => setIntervalSec(ev.target.value)}
							className="form-input"
						/>
					</div>
					<div className="form-group">
						<label htmlFor="carousel-max">Máximo en rotación</label>
						<input
							id="carousel-max"
							type="number"
							min={1}
							max={20}
							value={maxSlides}
							onChange={(ev) => setMaxSlides(ev.target.value)}
							className="form-input"
						/>
					</div>
					<div className="form-group menu-carousel-save-wrap">
						<button
							type="button"
							className="btn btn-primary menu-carousel-settings-save-btn"
							onClick={() => void saveSettings()}
							disabled={savingSettings}
						>
							{savingSettings ? 'Guardando…' : 'Guardar ajustes'}
						</button>
					</div>
				</div>
			</section>

			<div className="menu-carousel-toolbar">
				<h3>
					Lista de diapositivas
					<span className="menu-carousel-count">{banners.length === 0 ? '(vacía)' : `(${banners.length})`}</span>
				</h3>
				<div>
					<label className="btn btn-secondary menu-carousel-upload-inline" style={{ cursor: uploading ? 'wait' : 'pointer' }}>
						{uploading ? (
							<AdminIconSlot Icon={Loader2} slotSize="sm" className="animate-spin" />
						) : (
							<AdminIconSlot Icon={ImagePlus} slotSize="sm" tone="accent" />
						)}
						{uploading ? 'Subiendo…' : 'Añadir imagen'}
						<input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={uploading} onChange={(ev) => void onPickFile(ev)} />
					</label>
					<span className="menu-carousel-upload-hint"> · JPG, PNG o WebP, máx. 20 MB</span>
				</div>
			</div>

			{banners.length === 0 ? (
				<div className="menu-carousel-empty">
					<p>Aún no hay diapositivas para esta sucursal. Sube imágenes promocionales o del menú; aparecerán en el carrusel del menú público cuando estén activas.</p>
					<label className="btn btn-primary" style={{ cursor: uploading ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
						{uploading ? (
							<Loader2 size={18} color="#fff" className="animate-spin" aria-hidden />
						) : (
							<ImagePlus size={18} color="#fff" aria-hidden />
						)}
						{uploading ? 'Subiendo…' : 'Subir primera imagen'}
						<input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={uploading} onChange={(ev) => void onPickFile(ev)} />
					</label>
				</div>
			) : (
				<div className="menu-carousel-table-outer">
					<ul className="menu-carousel-slide-list" aria-label="Diapositivas del carrusel">
						{banners.map((b, idx) => {
							const created = b.created_at ? new Date(b.created_at) : null;
							const dateStr = created && Number.isFinite(created.getTime())
								? created.toLocaleDateString('es-CL')
								: '—';
							return (
								<li
									key={b.id}
									className={`menu-carousel-slide-card ${b.is_active ? 'is-active' : 'is-muted'}`}
								>
									<a
										href={b.image_url}
										target="_blank"
										rel="noopener noreferrer"
										className="menu-carousel-slide-card-thumb"
										aria-label={`Abrir imagen de la diapositiva ${idx + 1} en nueva pestaña`}
									>
										<img src={b.image_url} alt="" className="menu-carousel-slide-thumb" loading="lazy" />
										<span className="menu-carousel-thumb-open">
											<AdminIconSlot Icon={ExternalLink} slotSize="xxs" />
										</span>
									</a>
									<div className="menu-carousel-slide-card-main">
										<div className="menu-carousel-slide-card-head">
											<div className="menu-carousel-slide-titles">
												<p className="menu-carousel-slide-eyebrow">
													<AdminIconSlot Icon={GripVertical} slotSize="xxs" className="menu-carousel-slide-eyebrow-slot" />
													Diapositiva {idx + 1}
												</p>
												<h4 className="menu-carousel-slide-filename" title={b.image_url}>
													{shortUrlSnippet(b.image_url)}
												</h4>
											</div>
											<span
												className={`menu-carousel-chip menu-carousel-chip--status ${b.is_active ? 'menu-carousel-chip--on' : ''}`}
											>
												<span className="menu-carousel-chip-dot" aria-hidden />
												{b.is_active ? 'Visible en menú' : 'Oculta'}
											</span>
										</div>
										<div className="menu-carousel-slide-meta">
											<span className="menu-carousel-chip menu-carousel-chip--neutral">
												<AdminIconSlot Icon={Star} slotSize="xxs" />
												Orden {b.sort_order ?? idx}
											</span>
											<span className={`menu-carousel-chip ${isCloudinaryUrl(b.image_url) ? 'menu-carousel-chip--accent' : 'menu-carousel-chip--neutral'}`}>
												{isCloudinaryUrl(b.image_url) ? 'Cloudinary' : 'URL externa'}
											</span>
											<span className="menu-carousel-chip menu-carousel-chip--neutral">
												<AdminIconSlot Icon={Calendar} slotSize="xxs" />
												{dateStr}
											</span>
											<span className="menu-carousel-chip menu-carousel-chip--neutral menu-carousel-chip--hide-sm">
												<AdminIconSlot Icon={MonitorSmartphone} slotSize="xxs" />
												Menú digital
											</span>
										</div>
										<div className="menu-carousel-slide-promo-block">
											<div className="menu-carousel-slide-promo-label">
												<AdminIconSlot Icon={Sparkles} slotSize="xs" tone="accent" className="menu-carousel-promo-icon-slot" />
												<span>Promo con duración</span>
											</div>
											<div className="menu-carousel-row-promo menu-carousel-row-promo--card">
												<button
													type="button"
													className={`menu-carousel-switch menu-carousel-switch--sm ${bannerPromoOn(b) ? 'is-on' : ''}`}
													role="switch"
													aria-checked={bannerPromoOn(b)}
													aria-label={bannerPromoOn(b) ? 'Quitar duración de promoción en esta imagen' : 'Activar duración de promoción en esta imagen'}
													onClick={() => void toggleBannerPromo(b)}
												>
													<span className="menu-carousel-switch-knob" />
												</button>
												{bannerPromoOn(b) ? (
													<div className="menu-carousel-promo-days-wrap">
														<label className="menu-carousel-promo-days-label" htmlFor={`promo-days-${b.id}`}>Días</label>
														<input
															id={`promo-days-${b.id}`}
															type="number"
															min={1}
															max={90}
															className="form-input menu-carousel-promo-days-input"
															defaultValue={Math.min(90, Math.max(1, Number(b.promotion_duration_days) || 7))}
															key={`${b.id}-pd-${b.promotion_duration_days}-${b.expires_at}`}
															aria-label="Días visibles en el menú"
															onBlur={(ev) => void saveBannerPromoDays(b, ev.target.value)}
														/>
													</div>
												) : (
													<span className="menu-carousel-promo-off-hint">Sin caducidad automática</span>
												)}
											</div>
										</div>
									</div>
									<div className="menu-carousel-slide-card-actions">
										<button
											type="button"
											className="menu-carousel-btn-delete"
											aria-label="Eliminar imagen del carrusel"
											onClick={(e) => {
												e.stopPropagation();
												void removeBanner(b);
											}}
										>
											<Trash2 size={18} aria-hidden />
											<span className="menu-carousel-delete-label">Eliminar</span>
										</button>
										<div className="menu-carousel-kebab-wrap">
											<button
												type="button"
												className="admin-icon-btn admin-icon-btn--sm menu-carousel-kebab-trigger"
												aria-expanded={menuOpenId === b.id}
												aria-haspopup="menu"
												aria-label="Más opciones"
												onClick={(e) => {
													e.stopPropagation();
													setMenuOpenId((prev) => (prev === b.id ? null : b.id));
												}}
											>
												<MoreVertical size={18} aria-hidden />
											</button>
											{menuOpenId === b.id ? (
												<div
													className="menu-carousel-kebab-menu"
													role="menu"
													tabIndex={-1}
													onClick={(e) => e.stopPropagation()}
													onKeyDown={(e) => {
														if (e.key === 'Escape') setMenuOpenId(null);
													}}
												>
													<button
														type="button"
														role="menuitem"
														onClick={() => { void openEditorForBanner(b); }}
													>
														<AdminIconSlot Icon={WandSparkles} slotSize="xxs" className="menu-carousel-kebab-item-icon" />
														Ajustar diseño
													</button>
													{idx > 0 ? (
														<button
															type="button"
															role="menuitem"
															onClick={() => { void move(idx, -1); setMenuOpenId(null); }}
														>
															<AdminIconSlot Icon={ChevronUp} slotSize="xxs" className="menu-carousel-kebab-item-icon" />
															Subir
														</button>
													) : null}
													{idx < banners.length - 1 ? (
														<button
															type="button"
															role="menuitem"
															onClick={() => { void move(idx, 1); setMenuOpenId(null); }}
														>
															<AdminIconSlot Icon={ChevronDown} slotSize="xxs" className="menu-carousel-kebab-item-icon" />
															Bajar
														</button>
													) : null}
													<button
														type="button"
														role="menuitem"
														onClick={() => { void toggleActive(b); setMenuOpenId(null); }}
													>
														{b.is_active ? 'Ocultar en menú' : 'Mostrar en menú'}
													</button>
												</div>
											) : null}
										</div>
									</div>
								</li>
							);
						})}
					</ul>
				</div>
			)}
			{pendingUpload ? (
				<div className="menu-carousel-editor-overlay" role="dialog" aria-modal="true" aria-label="Editor de imagen carrusel">
					<div className="menu-carousel-editor-modal">
						<div className="menu-carousel-editor-head">
							<h4>Editor opcional de imagen</h4>
							<p>
								Objetivo: 2.35:1, mínimo {MIN_WIDTH}x{MIN_HEIGHT}.
								Actual: {humanSize(pendingUpload.dimensions.width)} x {humanSize(pendingUpload.dimensions.height)}.
							</p>
						</div>
						<div className="menu-carousel-editor-preview-wrap">
							<div className="menu-carousel-editor-preview">
								<img
									src={pendingUpload.previewUrl}
									alt="Vista previa para edición"
									className={`menu-carousel-editor-preview-image ${editorMode === 'contain' ? 'is-contain' : 'is-cover'}`}
									style={{
										objectPosition: `${Math.round(Math.min(Math.max(editorOffsetX, 0), 1) * 100)}% ${Math.round(Math.min(Math.max(editorOffsetY, 0), 1) * 100)}%`,
										transform: `scale(${editorView.currentZoom})`,
									}}
								/>
							</div>
						</div>
						<div className="menu-carousel-editor-controls">
							<div className="menu-carousel-editor-mode-toggle" role="radiogroup" aria-label="Modo de ajuste">
								<button
									type="button"
									className={`btn btn-secondary ${editorMode === 'cover' ? 'is-active' : ''}`}
									onClick={() => setEditorMode('cover')}
								>
									Recortar
								</button>
								<button
									type="button"
									className={`btn btn-secondary ${editorMode === 'contain' ? 'is-active' : ''}`}
									onClick={() => setEditorMode('contain')}
								>
									Ajustar completa
								</button>
							</div>
							<button
								type="button"
								className="btn btn-ghost menu-carousel-editor-reset-btn"
								onClick={() => {
									setEditorZoom(editorView.minZoom);
									setEditorOffsetX(0.5);
									setEditorOffsetY(0.5);
								}}
							>
								Reset vista
							</button>
							<label htmlFor="menu-carousel-editor-zoom">
								{editorMode === 'contain' ? 'Escala' : 'Zoom'}
								<input
									id="menu-carousel-editor-zoom"
									type="range"
									min={editorView.minZoom}
									max={editorView.maxZoom}
									step={0.01}
									value={editorView.currentZoom}
									onChange={(ev) => setEditorZoom(Number(ev.target.value))}
								/>
							</label>
							<label htmlFor="menu-carousel-editor-x">
								Horizontal
								<input
									id="menu-carousel-editor-x"
									type="range"
									min={0}
									max={1}
									step={0.01}
									value={editorOffsetX}
									onChange={(ev) => setEditorOffsetX(Number(ev.target.value))}
								/>
							</label>
							<label htmlFor="menu-carousel-editor-y">
								Vertical
								<input
									id="menu-carousel-editor-y"
									type="range"
									min={0}
									max={1}
									step={0.01}
									value={editorOffsetY}
									onChange={(ev) => setEditorOffsetY(Number(ev.target.value))}
								/>
							</label>
						</div>
						{editorMode === 'contain' ? (
							<p className="menu-carousel-editor-contain-hint">
								Modo ajustar completa: evita franjas y rellena todo el formato (puede recortar un poco los bordes).
							</p>
						) : null}
						<div className="menu-carousel-editor-actions">
							<button type="button" className="btn btn-ghost" onClick={dismissPendingUpload} disabled={uploading || editing}>
								Cancelar
							</button>
							{pendingUpload.mode === 'create' ? (
								<button type="button" className="btn btn-secondary" onClick={() => void continueWithoutEditing()} disabled={uploading || editing}>
									Continuar sin editar
								</button>
							) : null}
							<button type="button" className="btn btn-primary" onClick={() => void saveEditedImage()} disabled={uploading || editing}>
								{editing ? 'Aplicando…' : pendingUpload.mode === 'replace' ? 'Guardar ajustes' : 'Editar y subir'}
							</button>
						</div>
					</div>
				</div>
			) : null}
		</div>
	);
}
