import { useState, useEffect } from 'react';
import { validateImageFile } from '@/shared/utils/cloudinary';

/**
 * Hook especializado en gestionar el archivo del comprobante de pago,
 * validación de imagen, generación de preview URL y limpieza de memoria (URL.revokeObjectURL).
 */
export const useReceiptUpload = (showNotify) => {
    const [receiptFile, setReceiptFile] = useState(null);
    const [receiptPreview, setReceiptPreview] = useState(null);

    // Evitar fugas de memoria al desmontar
    useEffect(() => {
        return () => {
            if (receiptPreview) URL.revokeObjectURL(receiptPreview);
        };
    }, [receiptPreview]);

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            const { valid, error: validationError } = validateImageFile(file);
            if (!valid) {
                if (typeof showNotify === 'function') {
                    showNotify(validationError || 'Archivo no válido', 'error');
                }
                e.target.value = '';
                return;
            }
            if (receiptPreview) URL.revokeObjectURL(receiptPreview);
            setReceiptFile(file);
            setReceiptPreview(URL.createObjectURL(file));
        }
    };

    const removeReceipt = () => {
        setReceiptFile(null);
        setReceiptPreview(prev => {
            if (prev) URL.revokeObjectURL(prev);
            return null;
        });
    };

    const resetReceipt = () => {
        setReceiptFile(null);
        setReceiptPreview(prev => {
            if (prev) URL.revokeObjectURL(prev);
            return null;
        });
    };

    return {
        receiptFile,
        receiptPreview,
        handleFileChange,
        removeReceipt,
        resetReceipt
    };
};
