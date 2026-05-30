/**
 * Sonido al recibir un pedido nuevo (realtime). Archivo en public/sounds;
 * si falla (autoplay, 404), usa un timbre corto con Web Audio API.
 */

const SOUND_URL = '/sounds/sonidonotificacion.mp3';

let cachedAudio;

function getAudio() {
	if (typeof window === 'undefined') return null;
	if (!cachedAudio) {
		try {
			cachedAudio = new Audio(SOUND_URL);
			cachedAudio.preload = 'auto';
		} catch {
			cachedAudio = null;
		}
	}
	return cachedAudio;
}

function playFallbackChime() {
	try {
		const AC = window.AudioContext || window.webkitAudioContext;
		if (!AC) return;
		const ctx = new AC();
		const now = ctx.currentTime;
		const master = ctx.createGain();
		master.connect(ctx.destination);
		master.gain.setValueAtTime(0.0001, now);
		master.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
		master.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);

		const freqs = [784, 1175];
		freqs.forEach((freq, i) => {
			const osc = ctx.createOscillator();
			osc.type = 'sine';
			osc.frequency.value = freq;
			osc.connect(master);
			const t0 = now + i * 0.1;
			osc.start(t0);
			osc.stop(t0 + 0.22);
		});

		setTimeout(() => {
			ctx.close().catch(() => {});
		}, 600);
	} catch {
		/* ignore */
	}
}

/**
 * Reproduce el aviso sonoro (no bloquea). Seguro de llamar solo en el cliente.
 */
export function playOrderNotificationSound() {
	if (typeof window === 'undefined') return;

	const el = getAudio();
	if (!el) {
		playFallbackChime();
		return;
	}

	try {
		el.currentTime = 0;
		const p = el.play();
		if (p !== undefined && typeof p.catch === 'function') {
			p.catch(() => playFallbackChime());
		}
	} catch {
		playFallbackChime();
	}
}

let primed = false;

/** Primera interacción en el panel: desbloquea audio para que suene con pedidos en tiempo real. */
export function primeOrderNotificationAudio() {
	if (typeof window === 'undefined' || primed) return;
	const el = getAudio();
	if (!el) return;
	primed = true;
	const prev = el.volume;
	el.volume = 0;
	el.play()
		.then(() => {
			el.pause();
			el.currentTime = 0;
			el.volume = prev;
		})
		.catch(() => {
			el.volume = prev;
			primed = false;
		});
}
