'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Sidebar from './components/Sidebar';
import Navbar from './components/Navbar';
import { CurrencyProvider } from '@/lib/currency-context';

const API = 'http://localhost:4000';

export default function ClientShell({ children }) {
    const [collapsed, setCollapsed] = useState(false);
    const [mini, setMini] = useState(false);

    const router = useRouter();
    const pathname = usePathname();

    const isAuthPage = pathname?.startsWith('/auth') || pathname?.startsWith('/license');
    const isReceiptPage = pathname?.startsWith('/sales/receipt');
    const isBareLayout = isAuthPage || isReceiptPage;

    useEffect(() => {
        const saved = localStorage.getItem('sidebarCollapsed') === 'true';
        setCollapsed(saved);
        const savedMini = localStorage.getItem('sidebarMini') === 'true';
        setMini(savedMini);
    }, []);

        // ── responsive: drawer starts closed under 992px, rail mode is desktop-only
        useEffect(() => {
            const mq = window.matchMedia('(max-width: 991px)');
            const apply = () => {
                if (mq.matches) {
                    setCollapsed(true);
                    setMini(false);
                }
            };
            apply();
            mq.addEventListener('change', apply);
            return () => mq.removeEventListener('change', apply);
        }, []);
    
        // ── responsive: close the drawer after navigating on small screens
        useEffect(() => {
            if (window.matchMedia('(max-width: 991px)').matches) setCollapsed(true);
        }, [pathname]);  
        
            // ── responsive: tap outside the drawer to close it
    useEffect(() => {
        function onPointerDown(e) {
            if (!window.matchMedia('(max-width: 991px)').matches) return;
            if (collapsed) return;
            if (e.target.closest('.pos-sidebar-wrapper .sidebar')) return;
            if (e.target.closest('.menu-icon')) return; // let ☰ do its own toggle
            setCollapsed(true);
        }
        document.addEventListener('pointerdown', onPointerDown);
        return () => document.removeEventListener('pointerdown', onPointerDown);
    }, [collapsed]);


     // Auth guard — skip for auth pages and the receipt print view
     useEffect(() => {
        if (isBareLayout) return;

        fetch(`${API}/api/auth/me`, { credentials: 'include' })
            .then(r => r.json())
            .then(data => {
                if (!data.success) router.push('/auth/login');
            })
            .catch(() => router.push('/auth/login'));
    }, [pathname]);

    function toggleSidebar() {
        const next = !collapsed;
        setCollapsed(next);
        localStorage.setItem('sidebarCollapsed', next);
        if (next) {
            setMini(false);
            localStorage.setItem('sidebarMini', false);
        }
    }

    function toggleMini() {
        const next = !mini;
        setMini(next);
        localStorage.setItem('sidebarMini', next);
    }

    if (isBareLayout) return <CurrencyProvider>{children}</CurrencyProvider>; // auth pages + receipt print view render with no sidebar/navbar

    return (
        <CurrencyProvider>
            <Sidebar collapsed={collapsed} mini={mini} onToggleMini={toggleMini} />
<div className={`main-content${collapsed ? ' sidebar-collapsed' : ''}${mini ? ' sidebar-mini' : ''}`}>
    <Navbar onToggleSidebar={toggleSidebar} collapsed={collapsed} mini={mini} />
                <div className="layout-content">
                    {children}
                </div>
            </div>
        </CurrencyProvider>
    );
}