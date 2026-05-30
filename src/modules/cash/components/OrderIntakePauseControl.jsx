import React, { useCallback, useEffect, useState } from 'react';
import { PauseCircle, PlayCircle, AlertTriangle } from 'lucide-react';
import { supabase, TABLES, getCurrentUser } from '@/integrations/supabase';
import {
	DEFAULT_ORDER_INTAKE_PAUSE_MESSAGE,
	getOrderIntakeStatus,
	setOrderIntakePaused,
} from '../services/orderIntakeService';
import { isValidBranchId } from '@/shared/utils/safeIds';

/**
 * Control de pausa de pedidos online (menú público) por sucursal.
 */
export default function OrderIntakePauseControl({
	branchId,
	showNotify,
	disabled = false,
	disabledReason = '',
}) {
	const [status, setStatus] = useState({
		paused: false,
		message: null,
		displayMessage: DEFAULT_ORDER_INTAKE_PAUSE_MESSAGE,
	});
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [messageDraft, setMessageDraft] = useState('');
	const [confirmPauseOpen, setConfirmPauseOpen] = useState(false);

	const branchValid = isValidBranchId(branchId);
	const isDisabled = disabled || !branchValid || loading || saving;

	const loadStatus = useCallback(async () => {
		if (!branchValid) {
			setStatus({
				paused: false,
				message: null,
				displayMessage: DEFAULT_ORDER_INTAKE_PAUSE_MESSAGE,
			});
			return;
		}
		setLoading(true);
		try {
			const next = await getOrderIntakeStatus(branchId);
			setStatus(next);
			setMessageDraft(next.message || '');
		} catch {
			if (showNotify) showNotify('No se pudo cargar el estado de pedidos online', 'error');
		} finally {
			setLoading(false);
		}
	}, [branchId, branchValid, showNotify]);

	useEffect(() => {
		void loadStatus();
	}, [loadStatus]);

	const resolvePanelUserId = async () => {
		const authId = getCurrentUser()?.id;
		if (!authId) return null;
		const { data: row } = await supabase
			.from(TABLES.users)
			.select('id')
			.eq('auth_user_id', authId)
			.maybeSingle();
		return row?.id ?? null;
	};

	const applyPaused = async (paused) => {
		if (!branchValid) return;
		setSaving(true);
		try {
			const userId = paused ? await resolvePanelUserId() : null;
			const next = await setOrderIntakePaused(branchId, {
				paused,
				message: paused ? messageDraft : null,
				userId,
			});
			setStatus(next);
			setMessageDraft(next.message || '');
			setConfirmPauseOpen(false);
			if (showNotify) {
				showNotify(
					paused
						? 'Pedidos online pausados para esta sucursal'
						: 'Pedidos online reactivados',
					'info',
				);
			}
		} catch (err) {
			if (showNotify) {
				showNotify(err?.message || 'Error al actualizar la pausa', 'error');
			}
		} finally {
			setSaving(false);
		}
	};

	const handleToggleClick = () => {
		if (isDisabled) return;
		if (status.paused) {
			void applyPaused(false);
			return;
		}
		setConfirmPauseOpen(true);
	};

	const title =
		disabledReason ||
		(!branchValid ? 'Selecciona una sucursal concreta' : undefined);

	return (
		<div
			className={`order-intake-pause${status.paused ? ' order-intake-pause--active' : ''}`}
			title={title}
		>
			<span
				className={`order-intake-pause__badge${status.paused ? ' order-intake-pause__badge--paused' : ''}`}
			>
				{status.paused ? (
					<>
						<PauseCircle size={14} aria-hidden />
						Pedidos online: Pausados
					</>
				) : (
					<>
						<PlayCircle size={14} aria-hidden />
						Pedidos online: Activos
					</>
				)}
			</span>

			<button
				type="button"
				className={`btn btn-sm ${status.paused ? 'btn-primary' : 'btn-secondary'} order-intake-pause__btn`}
				onClick={handleToggleClick}
				disabled={isDisabled}
				aria-busy={saving}
			>
				{status.paused ? (
					<>
						<PlayCircle size={16} aria-hidden /> Reanudar
					</>
				) : (
					<>
						<PauseCircle size={16} aria-hidden /> Pausar
					</>
				)}
			</button>

			{confirmPauseOpen ? (
				<div
					className="order-intake-pause__confirm glass"
					role="dialog"
					aria-label="Confirmar pausa de pedidos online"
				>
					<div className="order-intake-pause__confirm-head">
						<AlertTriangle size={18} aria-hidden />
						<strong>Pausar pedidos online</strong>
					</div>
					<p className="order-intake-pause__confirm-lead">
						Los clientes verán un aviso en el menú público y no podrán completar pedidos. Los
						pedidos manuales del panel siguen disponibles.
					</p>
					<label className="order-intake-pause__label" htmlFor="order-intake-pause-message">
						Mensaje para clientes (opcional)
					</label>
					<textarea
						id="order-intake-pause-message"
						className="form-input order-intake-pause__textarea"
						rows={3}
						value={messageDraft}
						onChange={(e) => setMessageDraft(e.target.value)}
						placeholder={DEFAULT_ORDER_INTAKE_PAUSE_MESSAGE}
					/>
					<p className="order-intake-pause__preview-label">Vista previa</p>
					<p className="order-intake-pause__preview">
						{messageDraft.trim() || DEFAULT_ORDER_INTAKE_PAUSE_MESSAGE}
					</p>
					<div className="order-intake-pause__confirm-actions">
						<button
							type="button"
							className="btn btn-secondary"
							onClick={() => setConfirmPauseOpen(false)}
							disabled={saving}
						>
							Cancelar
						</button>
						<button
							type="button"
							className="btn btn-danger"
							onClick={() => void applyPaused(true)}
							disabled={saving}
						>
							{saving ? 'Guardando…' : 'Confirmar pausa'}
						</button>
					</div>
				</div>
			) : null}
		</div>
	);
}
