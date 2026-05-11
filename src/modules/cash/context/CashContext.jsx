import { useState, useEffect, useCallback, useMemo } from 'react';
import { cashService } from '../services/cashService';
import { supabase, TABLES } from '@/integrations/supabase';
import { CashContext } from './CashContextInstance';
import { useLocation } from './useLocation';

const normId = (id) => (id != null ? String(id) : null);

export const CashProvider = ({ children }) => {
    const { selectedBranch } = useLocation();
    const selectedBranchId = normId(selectedBranch?.id);

    const [activeShift, setActiveShift] = useState(null);
    const [branchesWithOpenCaja, setBranchesWithOpenCaja] = useState([]);
    const [loading, setLoading] = useState(true);

    const refreshAll = useCallback(async () => {
        try {
            setLoading(true);
            const [shift, branchIds] = await Promise.all([
                selectedBranchId
                    ? cashService.getActiveShiftForBranch(selectedBranchId)
                    : Promise.resolve(null),
                cashService.getBranchesWithOpenCaja(),
            ]);
            setActiveShift(shift);
            setBranchesWithOpenCaja((branchIds || []).map(normId).filter(Boolean));
        } catch {
            setActiveShift(null);
            setBranchesWithOpenCaja([]);
        } finally {
            setLoading(false);
        }
    }, [selectedBranchId]);

    useEffect(() => {
        refreshAll();

        const channel = supabase
            .channel('cash_shifts_realtime')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: TABLES.cash_shifts },
                (payload) => {
                    const eventType = payload.eventType || payload.event;
                    const newRow = payload.new || payload.newRecord;
                    const oldRow = payload.old || payload.oldRecord;

                    setBranchesWithOpenCaja((prev) => {
                        const add = (id) => {
                            const n = normId(id);
                            if (n && !prev.includes(n)) return [...prev, n];
                            return prev;
                        };
                        const remove = (id) => {
                            const n = normId(id);
                            if (n) return prev.filter((b) => b !== n);
                            return prev;
                        };

                        if (eventType === 'INSERT' && newRow?.status === 'open') return add(newRow.branch_id);
                        if (eventType === 'UPDATE' && newRow) {
                            if (oldRow?.status === 'open' && newRow.status !== 'open') return remove(oldRow.branch_id);
                            if (newRow.status === 'open') return add(newRow.branch_id);
                        }
                        if (eventType === 'DELETE' && oldRow?.status === 'open') return remove(oldRow.branch_id);
                        return prev;
                    });

                    // Solo el shift de la sucursal seleccionada actualiza activeShift.
                    if (!selectedBranchId) return;
                    const newBranchId = normId(newRow?.branch_id);
                    const oldBranchId = normId(oldRow?.branch_id);

                    setActiveShift((prev) => {
                        if (eventType === 'INSERT' && newRow?.status === 'open' && newBranchId === selectedBranchId) {
                            return newRow;
                        }
                        if (eventType === 'UPDATE' && newRow) {
                            if (newBranchId === selectedBranchId && newRow.status === 'open') return newRow;
                            if (newBranchId === selectedBranchId && newRow.status !== 'open') return null;
                            if (oldBranchId === selectedBranchId && newBranchId !== selectedBranchId) return null;
                        }
                        if (eventType === 'DELETE' && oldBranchId === selectedBranchId) return null;
                        return prev;
                    });
                }
            )
            .subscribe();

        return () => {
            channel.unsubscribe();
        };
    }, [refreshAll, selectedBranchId]);

    const isShiftActiveForBranch = useCallback((branchId) => {
        if (!branchId) return false;
        return branchesWithOpenCaja.includes(normId(branchId));
    }, [branchesWithOpenCaja]);

    const value = useMemo(() => ({
        activeShift,
        branchesWithOpenCaja,
        isShiftLoading: loading,
        isShiftActive: !!activeShift,
        isShiftActiveForBranch,
        refreshShift: refreshAll,
    }), [activeShift, branchesWithOpenCaja, loading, isShiftActiveForBranch, refreshAll]);

    return <CashContext.Provider value={value}>{children}</CashContext.Provider>;
};
