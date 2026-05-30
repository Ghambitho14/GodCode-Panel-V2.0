import { supabase } from '@/integrations/supabase';

/**
 * Servicio de tickets de soporte (tenant -> super-admin del SaaS).
 *
 * Reemplaza a los endpoints Next.js legacy:
 *   - /api/tenant-tickets                  (panel-viejo)
 *   - /api/tenant-tickets/:id/messages     (panel-viejo)
 *
 * Habla con la Edge Function `tenant-tickets` deployada en el mismo proyecto
 * Supabase compartido. La function usa siempre POST con `{ action, ... }`
 * porque `supabase.functions.invoke` no transmite query-params.
 *
 * Tablas internas (NO accesibles desde el cliente por RLS):
 *   - saas_tickets
 *   - saas_ticket_messages
 *   - users
 */

const FN_NAME = 'tenant-tickets';

/**
 * @param {{ data: any, error: any }} response
 * @param {string} fallbackMessage
 * @returns {Error}
 */
function buildFnError(response, fallbackMessage) {
	const dataMsg =
		response?.data && typeof response.data === 'object' && response.data !== null
			? response.data.error
			: null;
	const ctxMsg = response?.error?.message;
	return new Error(String(dataMsg || ctxMsg || fallbackMessage));
}

async function callFn(action, payload, fallback) {
	const response = await supabase.functions.invoke(FN_NAME, {
		body: { action, ...(payload || {}) },
	});
	if (response.error) {
		throw buildFnError(response, fallback);
	}
	return response.data ?? {};
}

/**
 * Lista los tickets de soporte de la company del usuario logueado.
 *
 * @returns {Promise<Array<{
 *   id: string,
 *   companyId: string,
 *   createdByEmail: string,
 *   source: 'tenant' | 'saas',
 *   subject: string,
 *   description: string,
 *   category: string,
 *   priority: string,
 *   status: string,
 *   assignedTo: string | null,
 *   firstResponseAt: string | null,
 *   resolvedAt: string | null,
 *   firstResponseDueAt: string | null,
 *   resolutionDueAt: string | null,
 *   lastMessageAt: string,
 *   createdAt: string,
 *   updatedAt: string,
 * }>>}
 */
export async function listTickets() {
	const data = await callFn('list-tickets', null, 'Error al cargar tickets');
	return Array.isArray(data?.tickets) ? data.tickets : [];
}

/**
 * Crea un ticket nuevo y registra el primer mensaje (igual al `description`).
 *
 * @param {{
 *   subject: string,
 *   description: string,
 *   category?: string,
 *   priority?: string,
 * }} payload
 * @returns {Promise<{ success: true, ticket: any }>}
 */
export async function createTicket(payload) {
	const subject = String(payload?.subject ?? '').trim();
	const description = String(payload?.description ?? '').trim();
	if (!subject) throw new Error('Falta subject');
	if (!description) throw new Error('Falta description');

	const data = await callFn(
		'create-ticket',
		{
			subject,
			description,
			category: payload?.category || 'general',
			priority: payload?.priority || 'medium',
		},
		'No se pudo crear el ticket',
	);
	return { success: true, ticket: data?.ticket ?? null };
}

/**
 * Lista los mensajes publicos (no internos) de un ticket de la company.
 *
 * @param {string} ticketId
 * @returns {Promise<Array<{
 *   id: string,
 *   ticket_id: string,
 *   author_type: 'tenant' | 'super_admin' | 'system',
 *   author_email: string | null,
 *   is_internal: boolean,
 *   message: string,
 *   created_at: string,
 * }>>}
 */
export async function listMessages(ticketId) {
	const id = String(ticketId ?? '').trim();
	if (!id) throw new Error('Falta ticketId');

	const data = await callFn(
		'list-messages',
		{ ticketId: id },
		'Error al cargar mensajes',
	);
	return Array.isArray(data?.messages) ? data.messages : [];
}

/**
 * Agrega una respuesta del tenant al ticket (mensaje publico).
 * Tambien reabre el ticket (status=open, resolved_at=null).
 *
 * @param {string} ticketId
 * @param {string} message
 * @returns {Promise<{ success: true }>}
 */
export async function sendMessage(ticketId, message) {
	const id = String(ticketId ?? '').trim();
	const text = String(message ?? '').trim();
	if (!id) throw new Error('Falta ticketId');
	if (!text) throw new Error('Falta message');

	await callFn(
		'send-message',
		{ ticketId: id, message: text },
		'No se pudo enviar la respuesta',
	);
	return { success: true };
}
