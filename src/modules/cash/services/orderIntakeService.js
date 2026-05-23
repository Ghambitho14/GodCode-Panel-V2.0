import { supabase, TABLES } from '@/integrations/supabase';
import { isValidBranchId } from '@/shared/utils/safeIds';

export const DEFAULT_ORDER_INTAKE_PAUSE_MESSAGE =
	'Tenemos mucha demanda por el momento. Vuelve a intentar en unos minutos.';

const PAUSE_SELECT =
	'order_intake_paused, order_intake_pause_message, order_intake_paused_at, order_intake_paused_by';

/**
 * @param {unknown} row
 */
export function mapOrderIntakeFromBranch(row) {
	if (!row) {
		return {
			paused: false,
			message: null,
			pausedAt: null,
			pausedBy: null,
			displayMessage: DEFAULT_ORDER_INTAKE_PAUSE_MESSAGE,
		};
	}
	const paused = Boolean(row.order_intake_paused);
	const rawMsg = row.order_intake_pause_message;
	const message =
		typeof rawMsg === 'string' && rawMsg.trim() !== '' ? rawMsg.trim() : null;
	return {
		paused,
		message,
		pausedAt: row.order_intake_paused_at ?? null,
		pausedBy: row.order_intake_paused_by ?? null,
		displayMessage: message || DEFAULT_ORDER_INTAKE_PAUSE_MESSAGE,
	};
}

/**
 * @param {string} branchId
 */
export async function getOrderIntakeStatus(branchId) {
	if (!isValidBranchId(branchId)) {
		return mapOrderIntakeFromBranch(null);
	}
	const { data, error } = await supabase
		.from(TABLES.branches)
		.select(PAUSE_SELECT)
		.eq('id', branchId)
		.maybeSingle();
	if (error) throw error;
	return mapOrderIntakeFromBranch(data);
}

/**
 * @param {string} branchId
 * @param {{ paused: boolean; message?: string | null; userId?: string | null }} opts
 */
export async function setOrderIntakePaused(branchId, { paused, message = null, userId = null }) {
	if (!isValidBranchId(branchId)) {
		throw new Error('Sucursal inválida.');
	}
	const patch = {
		order_intake_paused: Boolean(paused),
		order_intake_pause_message:
			paused && typeof message === 'string' && message.trim() !== ''
				? message.trim()
				: null,
		order_intake_paused_at: paused ? new Date().toISOString() : null,
		order_intake_paused_by: paused && userId ? userId : null,
	};
	const { data, error } = await supabase
		.from(TABLES.branches)
		.update(patch)
		.eq('id', branchId)
		.select(PAUSE_SELECT)
		.single();
	if (error) throw error;
	return mapOrderIntakeFromBranch(data);
}

export const orderIntakeService = {
	DEFAULT_ORDER_INTAKE_PAUSE_MESSAGE,
	mapOrderIntakeFromBranch,
	getOrderIntakeStatus,
	setOrderIntakePaused,
};
