import { useEffect } from 'react';

export function usePurchaseKeyboard({ formRef, productNameRef, quantityRef, supplierRef, lowInventoryRef, supplierDropdownOpenRef }) {
    useEffect(() => {
        function getVisibleInputs() {
            return Array.from(document.querySelectorAll(
                'input:not([type="hidden"]), select, textarea, button[type="submit"]'
            )).filter(el => el.offsetParent !== null && !el.disabled);
        }

        function handleKeyDown(e) {
            const active = document.activeElement;
            const isDateInput = active?.type === 'date';
            const isScanInput = active?.closest('.scan-input-wrapper') !== null;

            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                if (supplierDropdownOpenRef?.current) return; // let supplier autocomplete handle navigation
                e.preventDefault();
                const visibleInputs = getVisibleInputs();
                const currentIndex = visibleInputs.indexOf(active);
                if (currentIndex === -1) return;
                if (e.key === 'ArrowDown') {
                    visibleInputs[(currentIndex + 1) % visibleInputs.length].focus();
                } else {
                    visibleInputs[(currentIndex - 1 + visibleInputs.length) % visibleInputs.length].focus();
                }
                return;
            }

            // Tab trap
            if (e.key === 'Tab') {
                const visibleInputs = getVisibleInputs();
                const first = visibleInputs[0];
                const last  = visibleInputs[visibleInputs.length - 1];
                if (e.shiftKey) {
                    if (active === first || !visibleInputs.includes(active)) {
                        e.preventDefault(); last.focus();
                    }
                } else {
                    if (active === last) { e.preventDefault(); first.focus(); }
                }
            }

            // Alt + letter shortcuts
            if (e.altKey && !e.shiftKey && !e.ctrlKey) {
                const key = e.key.toUpperCase();
                if (key === 'P') { e.preventDefault(); productNameRef?.current?.focus(); }
                if (key === 'T') { e.preventDefault(); quantityRef?.current?.focus(); }
                if (key === 'S') { e.preventDefault(); supplierRef?.current?.focus(); }
                if (key === 'L') { e.preventDefault(); lowInventoryRef?.current?.focus(); }
                if (key === 'A') { e.preventDefault(); formRef?.current?.requestSubmit(); }
            }

            // Alt + Enter = submit
            if (e.altKey && e.key === 'Enter') {
                e.preventDefault();
                formRef?.current?.requestSubmit();
            }

            // Enter — prevent submit, toggle checkbox
            if (e.key === 'Enter' && !e.altKey) {
                if (active?.tagName === 'SELECT') return;
                e.preventDefault();
                if (active?.type === 'checkbox') {
                    active.checked = !active.checked;
                    active.dispatchEvent(new Event('change'));
                }
            }
        }

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [formRef, productNameRef, quantityRef, supplierRef, lowInventoryRef, supplierDropdownOpenRef]);
}