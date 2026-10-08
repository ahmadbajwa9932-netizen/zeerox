// src/lib/api.js
export const API = 'http://localhost:4000';

export function apiFetch(path, options = {}) {
    return fetch(`${API}${path}`, { credentials: 'include', ...options });
}