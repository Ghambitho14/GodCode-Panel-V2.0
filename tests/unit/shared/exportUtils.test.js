import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSpreadsheetHtml, openSpreadsheetInNewTab } from '@/shared/utils/exportUtils';

describe('exportUtils', () => {
	describe('buildSpreadsheetHtml', () => {
		it('returns empty string when data is empty', () => {
			expect(buildSpreadsheetHtml([])).toBe('');
			expect(buildSpreadsheetHtml(null)).toBe('');
		});

		it('generates table headers and rows', () => {
			const html = buildSpreadsheetHtml([
				{ Fecha: '10-06-26', Monto: 5000 },
				{ Fecha: '11-06-26', Monto: 1200 },
			]);

			expect(html).toContain('<th');
			expect(html).toContain('Fecha');
			expect(html).toContain('Monto');
			expect(html).toContain('10-06-26');
			expect(html).toContain('1200');
		});

		it('escapes HTML in cell values', () => {
			const html = buildSpreadsheetHtml([{ Descripcion: '<script>alert(1)</script>' }]);

			expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
			expect(html).not.toContain('<script>alert(1)</script>');
		});

		it('prefixes formula-like values for spreadsheet safety', () => {
			const html = buildSpreadsheetHtml([{ Nota: '=1+1' }]);

			expect(html).toContain('&#39;=1+1');
		});
	});

	describe('openSpreadsheetInNewTab', () => {
		beforeEach(() => {
			vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
			vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		});

		afterEach(() => {
			vi.restoreAllMocks();
			vi.unstubAllGlobals();
		});

		it('returns false when data is empty', () => {
			expect(openSpreadsheetInNewTab([])).toBe(false);
			expect(openSpreadsheetInNewTab(null)).toBe(false);
		});

		it('opens a new tab with HTML blob URL', () => {
			const openSpy = vi.spyOn(window, 'open').mockReturnValue({});

			const result = openSpreadsheetInNewTab([{ Fecha: '10-06-26', Monto: 100 }]);

			expect(result).toBe(true);
			expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
			const blobArg = URL.createObjectURL.mock.calls[0][0];
			expect(blobArg).toBeInstanceOf(Blob);
			expect(blobArg.type).toBe('text/html;charset=utf-8');
			expect(openSpy).toHaveBeenCalledWith('blob:mock-url', '_blank', 'noopener,noreferrer');
		});

		it('revokes URL when popup is blocked', () => {
			vi.spyOn(window, 'open').mockReturnValue(null);

			const result = openSpreadsheetInNewTab([{ Fecha: '10-06-26' }]);

			expect(result).toBe(false);
			expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
		});
	});
});
