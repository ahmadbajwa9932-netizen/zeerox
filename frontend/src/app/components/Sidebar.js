'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { usePermissions } from '@/lib/permissions';
import './sidebar.css';

export default function Sidebar({ collapsed, mini, onToggleMini }) {

    const pathname = usePathname();
    const { blocked: blockedPages, loading: permissionsLoading } = usePermissions();
    const [user, setUser] = useState(null);
    
    useEffect(() => {
        fetch('http://localhost:4000/api/auth/me', { credentials: 'include' })
            .then(r => r.json())
            .then(data => { if (data.success) setUser(data.user); })
            .catch(() => {});
    }, []);
    
    async function handleLogout() {
        const confirmed = window.confirm('Are you sure you want to logout?');
        if (!confirmed) return;
        await fetch('http://localhost:4000/api/auth/logout', { method: 'POST', credentials: 'include' });
        window.location.href = '/auth/login';
    }

    const isBlocked = (key) => blockedPages.includes(key);
    const isAllChildrenBlocked = (keys) => keys.length > 0 && keys.every(k => blockedPages.includes(k));

function toggleMenu(menuId, element) {
    const menu = document.getElementById(menuId);
    const icon = element.querySelector('.icon');

    if (menu.style.maxHeight && menu.style.maxHeight !== '0px') {
        menu.style.transitionDuration = '0.3s';
        menu.style.maxHeight = menu.scrollHeight + 'px';
        requestAnimationFrame(() => {
            menu.style.maxHeight = '0px';
        });
        menu.style.padding = '0';
        icon.innerText = '+';
        icon.classList.remove('rotate');
    } else {
        const targetHeight = menu.scrollHeight;
        const duration = Math.min(0.3, Math.max(0.15, targetHeight / 700));
        menu.style.transitionDuration = `${duration}s`;
        menu.style.padding = '10px 0';
        menu.style.maxHeight = targetHeight + 'px';
        icon.innerText = '-';
        icon.classList.add('rotate');
    }
}

function handleSubmenuTransitionEnd(e) {
    if (e.propertyName !== 'max-height') return;
    const menu = e.currentTarget;
    if (menu.style.maxHeight !== '0px') {
        menu.style.maxHeight = 'none'; // let it grow freely, no more clipping
    }
}

    // Auto-open active submenu on load
    useEffect(() => {
        const submenus = {
            'produce-menu': ['/purchase'],
            'sales-menu': ['/sales/daily', '/sales/general', '/sales/credit', '/sales/returns'],
            'category-menu': ['/categories'],
            'expense-menu': ['/expenses'],
            'report-menu': ['/reports'],
            'customer-menu': ['/customers'],
        };

        Object.entries(submenus).forEach(([menuId, paths]) => {
            const isActive = paths.some(p => pathname.startsWith(p));
            if (isActive) {
                const menu = document.getElementById(menuId);
                const parentLi = menu?.previousElementSibling;
                if (menu && parentLi) {
                    menu.style.padding = '10px 0';
                    menu.style.maxHeight = 'none';
                    const icon = parentLi.querySelector('.icon');
                    if (icon) {
                        icon.innerText = '-';
                        icon.classList.add('rotate');
                    }
                }
            }
        });
    }, [pathname]);

    const isActive = (path) => pathname === path ? 'active' : '';
    const isParentActive = (paths) => paths.some(p => pathname.startsWith(p)) ? 'parent-active' : '';

    return (
        <div className="pos-sidebar-wrapper">
<div className={`sidebar${collapsed ? ' collapsed' : ''}${mini ? ' mini' : ''}`}>

<div className="sidebar-logo">
    <svg className="sidebar-logo-emblem" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <polygon points="20,2 36,11 36,29 20,38 4,29 4,11" fill="#22385c" stroke="#3ba7ff" strokeWidth="1.4"/>
        <path d="M13 14H27L13 26H27" stroke="#3ba7ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
    <div className="sidebar-logo-wordmark-group">
        <span className="sidebar-logo-text">ZEERO<span className="sidebar-logo-accent">X</span></span>
        <span className="sidebar-logo-sub">Retail Systems</span>
    </div>
</div>
<hr />
                <ul style={permissionsLoading ? { visibility: 'hidden' } : undefined}>
                    {/* Dashboard */}
{!isBlocked('dashboard') && (
<Link className="without-menu-item" href="/dashboard">
    <li className={`menu-item ${isActive('/dashboard')}`}>
    <span><i className="fa-solid fa-gauge"></i><span className="menu-text"> Dashboard</span></span>
    </li>
</Link>
)}

                    {/* Make a Sale */}
{!isBlocked('sales.create') && (
<Link className="without-menu-item" href="/sales/create">
    <li className={`menu-item ${isActive('/sales/create')}`}>
    <span><i className="fa fa-print"></i><span className="menu-text"> Make a sale</span></span>
    </li>
</Link>
)}

                    {/* Purchase Menu */}
{(!isBlocked('purchase') && !isAllChildrenBlocked(['purchase.add','purchase.supplier','purchase.low-inventory','purchase.list','purchase.stock-overview','purchase.expired'])) && (
<div className="menu-group"><li
    className={`menu-item ${isParentActive(['/purchase'])}`}
    onClick={(e) => toggleMenu('produce-menu', e.currentTarget)}
>
<span><i className="fa fa-shopping-cart"></i><span className="menu-text"> Purchase</span></span>
    <span className="icon">+</span>
</li>
<ul className="submenu" id="produce-menu" onTransitionEnd={handleSubmenuTransitionEnd}>
    {!isBlocked('purchase.add') && <li><Link href="/purchase/add" className={isActive('/purchase/add')}>Add</Link></li>}
    {!isBlocked('purchase.supplier') && <li><Link href="/purchase/supplier/list" className={isActive('/purchase/supplier/list')}>Supplier</Link></li>}
    {!isBlocked('purchase.low-inventory') && <li><Link href="/purchase/low-inventory" className={isActive('/purchase/low-inventory')}>Low Inventory</Link></li>}
    {!isBlocked('purchase.list') && <li><Link href="/purchase/list" className={isActive('/purchase/list')}>To See</Link></li>}
    {!isBlocked('purchase.stock-overview') && <li><Link href="/purchase/stock-overview" className={isActive('/purchase/stock-overview')}>Stock Overview</Link></li>}
    {!isBlocked('purchase.expired') && <li><Link href="/purchase/expired" className={isActive('/purchase/expired')}>Expired Products</Link></li>}
</ul>
</div>)}

                    {/* Sales Menu */}
{(!isBlocked('sales') && !isAllChildrenBlocked(['sales.daily','sales.general','sales.credit','sales.returns','sales.returns-without-invoice'])) && (
<div className="menu-group"><li
    className={`menu-item ${isParentActive(['/sales/daily', '/sales/general', '/sales/credit', '/sales/returns'])}`}
    onClick={(e) => toggleMenu('sales-menu', e.currentTarget)}
>
<span><i className="fa fa-money-bill"></i><span className="menu-text"> Sales</span></span>
    <span className="icon">+</span>
</li>
<ul className="submenu" id="sales-menu" onTransitionEnd={handleSubmenuTransitionEnd}>
    {!isBlocked('sales.daily') && <li><Link href="/sales/daily" className={isActive('/sales/daily')}>Daily Sale</Link></li>}
    {!isBlocked('sales.general') && <li><Link href="/sales/general" className={isActive('/sales/general')}>General Sale</Link></li>}
    {!isBlocked('sales.credit') && <li><Link href="/sales/credit" className={isActive('/sales/credit')}>Credit Sale</Link></li>}
    {!isBlocked('sales.returns') && <li><Link href="/sales/returns" className={isActive('/sales/returns')}>Returned Sale</Link></li>}
    {!isBlocked('sales.returns-without-invoice') && <li><Link href="/sales/returns-without-invoice" className={isActive('/sales/returns-without-invoice')}>Return Without Invoice</Link></li>}
</ul>
</div>)}

                    {/* Categories Menu */}
{(!isBlocked('categories') && !isAllChildrenBlocked(['categories.list'])) && (
<div className="menu-group"><li
    className={`menu-item ${isParentActive(['/categories'])}`}
    onClick={(e) => toggleMenu('category-menu', e.currentTarget)}
>
<span><i className="fa fa-book"></i><span className="menu-text"> Categories</span></span>
    <span className="icon">+</span>
</li>
<ul className="submenu" id="category-menu" onTransitionEnd={handleSubmenuTransitionEnd}>
    {!isBlocked('categories.list') && <li><Link href="/categories" className={isActive('/categories')}>To See</Link></li>}
</ul>
</div>)}

                    
                    
                    {/* Expense Menu */}
{(!isBlocked('expenses') && !isAllChildrenBlocked(['expenses.create','expenses.index'])) && (
<div className="menu-group"><li
    className={`menu-item ${isParentActive(['/expenses'])}`}
    onClick={(e) => toggleMenu('expense-menu', e.currentTarget)}
>
<span><i className="fa fa-file-invoice-dollar"></i><span className="menu-text"> Expense</span></span>
    <span className="icon">+</span>
</li>
<ul className="submenu" id="expense-menu" onTransitionEnd={handleSubmenuTransitionEnd}>
    {!isBlocked('expenses.create') && <li><Link href="/expenses/add" className={isActive('/expenses/add')}>Add</Link></li>}
    {!isBlocked('expenses.index') && <li><Link href="/expenses" className={isActive('/expenses')}>To See</Link></li>}
</ul>
</div>)}

                    {/* Reports Menu */}
{(!isBlocked('reports') && !isAllChildrenBlocked(['reports.sales','reports.financial','reports.purchase'])) && (
<div className="menu-group"><li
    className={`menu-item ${isParentActive(['/reports'])}`}
    onClick={(e) => toggleMenu('report-menu', e.currentTarget)}
>
<span><i className="fa fa-chart-bar"></i><span className="menu-text"> Reports</span></span>
    <span className="icon">+</span>
</li>
<ul className="submenu" id="report-menu" onTransitionEnd={handleSubmenuTransitionEnd}>
    {!isBlocked('reports.sales') && <li><Link href="/reports/sales" className={isActive('/reports/sales')}>Sales Report</Link></li>}
    {!isBlocked('reports.financial') && <li><Link href="/reports/financial" className={isActive('/reports/financial')}>Financial Report</Link></li>}
    {!isBlocked('reports.purchase') && <li><Link href="/reports/purchase" className={isActive('/reports/purchase')}>Purchase Report</Link></li>}
</ul>
</div>)}

                    {/* Customers Menu */}
{(!isBlocked('customers') && !isAllChildrenBlocked(['customers.list','customers.credit','customers.advance'])) && (
<div className="menu-group"><li
    className={`menu-item ${isParentActive(['/customers'])}`}
    onClick={(e) => toggleMenu('customer-menu', e.currentTarget)}
>
<span><i className="fa fa-users"></i><span className="menu-text"> Customers</span></span>
    <span className="icon">+</span>
</li>
<ul className="submenu" id="customer-menu" onTransitionEnd={handleSubmenuTransitionEnd}>
    {!isBlocked('customers.list') && <li><Link href="/customers/customers" className={isActive('/customers/customers')}>Customers</Link></li>}
    {!isBlocked('customers.credit') && <li><Link href="/customers/credit" className={isActive('/customers/credit')}>Credit Customers</Link></li>}
    {!isBlocked('customers.advance') && <li><Link href="/customers/advance" className={isActive('/customers/advance')}>Advance Customers</Link></li>}
</ul>
</div>)}

                    {/* Notes */}
{!isBlocked('manual-notes') && (
<Link className="without-menu-item" href="/manual-notes">
    <li className={`menu-item ${isActive('/manual-notes')}`}>
    <span><i className="fa fa-sticky-note"></i><span className="menu-text"> Notes</span></span>
    </li>
</Link>
)}

                    {/* Barcode Generator */}
{!isBlocked('barcode') && (
<Link className="without-menu-item" href="/barcode">
    <li className={`menu-item ${isActive('/barcode')}`}>
    <span><i className="fa fa-barcode"></i><span className="menu-text"> Barcode Generator</span></span>
    </li>
</Link>
)}

{!isBlocked('payment-accounts') && (
<Link className="without-menu-item" href="/payment-accounts">
    <li className={`menu-item ${isActive('/payment-accounts')}`}>
    <span><i className="fa-solid fa-building-columns"></i><span className="menu-text"> Payment Accounts</span></span>
    </li>
</Link>
)}

                    {/* Admin Panel */}
{!isBlocked('admin') && (
<Link className="without-menu-item" href="/admin">
    <li className={`menu-item ${isActive('/admin')}`}>
    <span><i className="fa fa-shield-alt"></i><span className="menu-text"> Admin Panel</span></span>
    </li>
</Link>
)}

                    {/* Backup & Restore */}
{!isBlocked('backup') && (
<Link className="without-menu-item" href="/backup">
    <li className={`menu-item ${isActive('/backup')}`}>
    <span><i className="fa fa-database"></i><span className="menu-text"> Backup &amp; Restore</span></span>
    </li>
</Link>
)}

{!isBlocked('recycle-bin') && (
<Link className="without-menu-item" href="/recycle-bin">
    <li className={`menu-item ${isActive('/recycle-bin')}`}>
   <span><i className="fa fa-trash-can-arrow-up"></i><span className="menu-text"> Recycle Bin</span></span>
    </li>
</Link>
)}
                </ul>

                <div className="sidebar-footer">
                <div className="sidebar-support" title="Support: 0300-0000000 / 0300-1111111">
        <div className="sidebar-support-label">
            <i className="fa-solid fa-headset"></i>
            <span>Need help? Call support</span>
        </div>
        <div className="sidebar-support-numbers">
            <a href="tel:03000000000">0300-0000000</a>
            <span className="sidebar-support-sep">|</span>
            <a href="tel:03001111111">0300-1111111</a>
        </div>
    </div>

    <div className="sidebar-user-info">
        <span className='login-as'>Log in as: </span>
        <span>{user?.name || 'User'} <span style={{color:'white'}}>|</span> {user?.role || ''}</span>
    </div>
    <div className="sidebar-footer-actions">
    <button className="sidebar-mini-toggle" onClick={onToggleMini} title={mini ? 'Expand sidebar' : 'Collapse to icons'}>

            <i className={`fa-solid ${mini ? 'fa-angles-right' : 'fa-angles-left'}`}></i>
        </button>
        <button className="sidebar-signout-btn" onClick={handleLogout} title="Sign Out">
            <i className="fa-solid fa-right-from-bracket"></i>
            <span>Sign Out</span>
        </button>
    </div>
</div>
            </div>
        </div>
    );
}