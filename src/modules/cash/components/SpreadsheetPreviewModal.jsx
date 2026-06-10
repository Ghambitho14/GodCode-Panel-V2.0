import React, { useMemo } from 'react';
import { X, Download } from 'lucide-react';
import { useLockBodyScroll } from '@/shared/hooks/useLockBodyScroll';
import { downloadExcel } from '@/shared/utils/exportUtils';

const SpreadsheetPreviewModal = ({ isOpen, onClose, title, rows = [], filename }) => {
    useLockBodyScroll(isOpen);

    const headers = useMemo(() => {
        if (!rows.length) return [];
        return Object.keys(rows[0]);
    }, [rows]);

    if (!isOpen) return null;

    const handleDownload = () => {
        if (!rows.length) return;
        downloadExcel(rows, filename);
    };

    return (
        <div
            className="modal-overlay rpt-spreadsheet-preview-overlay"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-labelledby="rpt-spreadsheet-preview-title"
        >
            <div
                className="modal-content glass rpt-spreadsheet-preview-modal"
                onClick={(e) => e.stopPropagation()}
            >
                <header className="modal-header rpt-spreadsheet-preview-modal__header">
                    <h3 id="rpt-spreadsheet-preview-title" className="rpt-spreadsheet-preview-modal__title">
                        {title}
                    </h3>
                    <button type="button" onClick={onClose} className="btn-close" aria-label="Cerrar">
                        <X size={22} strokeWidth={2} />
                    </button>
                </header>

                <div className="rpt-spreadsheet-preview-modal__body">
                    {rows.length === 0 ? (
                        <p className="rpt-spreadsheet-preview-empty">No hay datos para mostrar.</p>
                    ) : (
                        <div className="rpt-spreadsheet-preview-scroll">
                            <table className="rpt-spreadsheet-preview-table">
                                <thead>
                                    <tr>
                                        {headers.map((header) => (
                                            <th key={header}>{header}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((row, rowIndex) => (
                                        <tr key={rowIndex}>
                                            {headers.map((header) => (
                                                <td key={header}>{row[header] ?? ''}</td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                <footer className="modal-footer rpt-spreadsheet-preview-modal__footer">
                    <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={onClose}
                    >
                        Cerrar
                    </button>
                    <button
                        type="button"
                        className="btn btn-primary"
                        onClick={handleDownload}
                        disabled={!rows.length}
                    >
                        <Download size={16} aria-hidden />
                        Descargar
                    </button>
                </footer>
            </div>
        </div>
    );
};

export default SpreadsheetPreviewModal;
