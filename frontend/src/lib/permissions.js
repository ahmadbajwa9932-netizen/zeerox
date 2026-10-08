// src/lib/permissions.js
'use client';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

// Module-level cache so every component sharing the same page load
// reuses one network request instead of firing one each.
let cache = null;
let inflight = null;

async function fetchPermissions() {
    if (cache) return cache;
    if (inflight) return inflight;

    inflight = apiFetch('/api/users/my-permissions')
        .then(res => res.json())
        .then(data => { cache = data.success ? (data.blocked_pages ?? []) : []; return cache; })
        .catch(() => { cache = []; return cache; })
        .finally(() => { inflight = null; });

    return inflight;
}

// Call this on logout/login so the next user doesn't inherit stale permissions.
export function clearPermissionsCache() {
    cache = null;
}

export function usePermissions() {
    const [blocked, setBlocked] = useState(cache ?? []);
    const [loading, setLoading] = useState(!cache);

    useEffect(() => {
        let active = true;
        fetchPermissions().then(list => {
            if (active) { setBlocked(list); setLoading(false); }
        });
        return () => { active = false; };
    }, []);

    const isBlocked = (key) => blocked.includes(key);
    const can = (key) => !isBlocked(key);

    return { blocked, loading, isBlocked, can };
}

// Optional inline-JSX helper for simple cases:
// <Can action="purchase.list.act.edit"><button>Edit</button></Can>
export function Can({ action, children, fallback = null }) {
    const { isBlocked, loading } = usePermissions();
    if (loading) return null;
    return isBlocked(action) ? fallback : children;
}