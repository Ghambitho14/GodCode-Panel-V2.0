import React, { createContext, useState, useEffect, useMemo } from 'react';
import { normalizeDeliverySettings } from '@/lib/delivery-settings';
import { supabase, TABLES } from '@/integrations/supabase';

export const LocationContext = createContext(null);

/** @param {string} storageKey */
function getInitialBranch(storageKey) {
    if (typeof window === 'undefined') {
        return { branch: null, hasValidBranch: false };
    }
    try {
        const saved = window.localStorage.getItem(storageKey);
        if (!saved) return { branch: null, hasValidBranch: false };
        const parsed = JSON.parse(saved);
        const hasValid = !!(parsed && parsed.id && String(parsed.id).length > 0);
        return { branch: hasValid ? parsed : null, hasValidBranch: hasValid };
    } catch {
        return { branch: null, hasValidBranch: false };
    }
}

/** No exponer al cliente público (menú/checkout) el WhatsApp del repartidor de confianza. */
function stripStaffOnlyDeliverySettings(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
    const next = { ...raw };
    delete next.trustedDriverWhatsApp;
    delete next.trusted_driver_whatsapp;
    return next;
}

/**
 * @param {{ children: React.ReactNode, companyId: string }} props
 */
export const LocationProvider = ({ children, companyId }) => {
    const storageKey = useMemo(
        () => (companyId ? `godcode-selectedBranch:${companyId}` : 'godcode-selectedBranch:pending'),
        [companyId],
    );

    const initial = useMemo(() => getInitialBranch(storageKey), [storageKey]);

    const [selectedBranch, setSelectedBranch] = useState(initial.branch);
    const [allBranches, setAllBranches] = useState([]);
    const [loadingBranches, setLoadingBranches] = useState(true);
    const [isLocationModalOpen, setIsLocationModalOpen] = useState(!initial.hasValidBranch);

    useEffect(() => {
        const next = getInitialBranch(storageKey);
        setSelectedBranch(next.branch);
        setIsLocationModalOpen(!next.hasValidBranch);
    }, [storageKey]);

    useEffect(() => {
        let alive = true;

        const fetchBranches = async () => {
            try {
                if (!companyId) {
                    if (!alive) return;
                    setAllBranches([]);
                    setLoadingBranches(false);
                    return;
                }

                const { data, error } = await supabase
                    .from(TABLES.branches)
                    .select('*')
                    .eq('company_id', companyId)
                    .order('name');

                if (error) throw error;

                const mappedBranches = (data || []).map((b) => {
                    const rawDel = b.delivery_settings ?? b.deliverySettings;
                    const publicDel = stripStaffOnlyDeliverySettings(rawDel);
                    return {
                        ...b,
                        delivery_settings: publicDel,
                        whatsappUrl: b.whatsapp_url,
                        instagramUrl: b.instagram_url,
                        mapUrl: b.map_url,
                        deliverySettings: normalizeDeliverySettings(publicDel),
                    };
                });

                if (!alive) return;
                setAllBranches(mappedBranches);

                setSelectedBranch((prev) => {
                    if (!prev?.id) return prev;
                    const fresh = mappedBranches.find((b) => b.id === prev.id);
                    if (!fresh) {
                        try { window.localStorage.removeItem(storageKey); } catch {}
                        return null;
                    }
                    return fresh;
                });
            } catch {
                /* ignore */
            } finally {
                if (!alive) return;
                setLoadingBranches(false);
            }
        };

        setLoadingBranches(true);
        fetchBranches();

        const channel = companyId
            ? supabase
                .channel(`branches-realtime-${companyId}`)
                .on(
                    'postgres_changes',
                    { event: '*', schema: 'public', table: TABLES.branches },
                    () => {
                        void fetchBranches();
                    }
                )
                .subscribe()
            : null;

        return () => {
            alive = false;
            try {
                if (channel) supabase.removeChannel(channel);
            } catch {}
        };
    }, [companyId, storageKey]);

    useEffect(() => {
        if (!selectedBranch) {
            setIsLocationModalOpen(true);
        }
    }, [selectedBranch]);

    const selectBranch = (branch) => {
        setSelectedBranch(branch);
        try { window.localStorage.setItem(storageKey, JSON.stringify(branch)); } catch {}
        setIsLocationModalOpen(false);
    };

    const clearBranch = () => {
        setSelectedBranch(null);
        try { window.localStorage.removeItem(storageKey); } catch {}
        setIsLocationModalOpen(true);
    };

    return (
        <LocationContext.Provider value={{
            selectedBranch,
            selectBranch,
            clearBranch,
            isLocationModalOpen,
            setIsLocationModalOpen,
            allBranches,
            loadingBranches
        }}>
            {children}
        </LocationContext.Provider>
    );
};
