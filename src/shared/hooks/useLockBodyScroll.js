import { useEffect } from 'react';

const ADMIN_CONTENT_SELECTOR = '.admin-layout main.admin-content';

let lockCount = 0;
let savedScrollY = 0;
let savedAdminScrollTop = 0;

/** @type {HTMLElement | null} */
let adminContentEl = null;

/** @type {Record<string, string>} */
let prevBodyStyles = {};
/** @type {Record<string, string>} */
let prevAdminStyles = {};

function getAdminContent() {
    if (typeof document === 'undefined') return null;
    return document.querySelector(ADMIN_CONTENT_SELECTOR);
}

function applyLock() {
    adminContentEl = getAdminContent();
    savedScrollY = window.scrollY;
    savedAdminScrollTop = adminContentEl?.scrollTop ?? savedScrollY;

    prevBodyStyles = {
        overflow: document.body.style.overflow,
        position: document.body.style.position,
        top: document.body.style.top,
        width: document.body.style.width,
    };

    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${savedScrollY}px`;
    document.body.style.width = '100%';

    if (adminContentEl) {
        prevAdminStyles = {
            overflow: adminContentEl.style.overflow,
        };
        adminContentEl.style.overflow = 'hidden';
    }
}

function releaseLock() {
    document.body.style.overflow = prevBodyStyles.overflow ?? '';
    document.body.style.position = prevBodyStyles.position ?? '';
    document.body.style.top = prevBodyStyles.top ?? '';
    document.body.style.width = prevBodyStyles.width ?? '';

    if (adminContentEl) {
        adminContentEl.style.overflow = prevAdminStyles.overflow ?? '';
        adminContentEl.scrollTop = savedAdminScrollTop;
        adminContentEl = null;
    }

    window.scrollTo(0, savedScrollY);
    prevBodyStyles = {};
    prevAdminStyles = {};
}

/**
 * Bloquea el scroll de la página mientras un modal está abierto.
 * Soporta modales anidados mediante contador de referencias.
 * @param {boolean} isOpen
 */
export function useLockBodyScroll(isOpen) {
    useEffect(() => {
        if (!isOpen) return undefined;

        lockCount += 1;
        if (lockCount === 1) {
            applyLock();
        }

        return () => {
            lockCount = Math.max(0, lockCount - 1);
            if (lockCount === 0) {
                releaseLock();
            }
        };
    }, [isOpen]);
}
