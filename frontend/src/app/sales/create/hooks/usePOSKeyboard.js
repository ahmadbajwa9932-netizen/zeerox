'use client';
import { useEffect, useRef } from 'react';

export function usePOSKeyboard({
  productSearchRef,
  rows,
  setProductSearch,
  setProductDropdownOpen,
  productDropdownOpen,
  customerDropdownOpen,
  cityDropdownOpen,
  contactDropdownOpen,
  shopDropdownOpen,
}) {
  const rowNavMode    = useRef(null); // 'price'|'qty'|'discount'|'tax'|'delete'
  const rowNavIndex   = useRef(0);
  const altRPressed   = useRef(false);
  const altRTimer     = useRef(null);

  useEffect(() => {
    /* ── helpers ── */
    const getTableRows = () =>
      Array.from(document.querySelectorAll('#itemsTable tbody tr'));

    const getFocusable = () =>
      Array.from(document.querySelectorAll(
        'input:not([readonly]):not([disabled])' +
        ':not(#subtotal):not(#grand_total):not(#change_amount)' +
        ':not(#voucher_no):not(#final_amount):not(#remaining_amount)' +
        ':not(#advance_total_payable),' +
        'select:not([disabled]),' +
        'button:not([disabled])'
      )).filter(el => {
        const s = window.getComputedStyle(el);
        return (
          s.display !== 'none' &&
          s.visibility !== 'hidden' &&
          el.offsetParent !== null &&
          !el.closest('.product-autocomplete-list') &&
          !el.closest('[id$="AutocompleteList"]') &&
          !el.closest('nav') &&
          !el.closest('header')
        );
      });

    const isAnyAutocompleteOpen = () => {
      const ids = [
        'autocompleteList',
        'customerAutocompleteList',
        'cityAutocompleteList',
        'contactAutocompleteList',
        'shopAutocompleteList',
        'categoryAutocompleteList',
      ];
      return ids.some(id => {
        const el = document.getElementById(id);
        return el && el.style.display === 'block';
      });
    };

    const focusRowField = (mode, index) => {
      const rows = getTableRows();
      if (!rows.length) return;
      const clampedIndex = Math.max(0, Math.min(index, rows.length - 1));
      rowNavIndex.current = clampedIndex;
      const row = rows[clampedIndex];
      if (!row) return;

      const map = {
        qty:      '.pos-qty',
        price:    '.pos-price',
        discount: '.pos-discount',
        tax:      '.pos-tax',
        delete:   '.pos-delete',
      };

      const el = row.querySelector(map[mode]);
      el?.focus();
    };

    /* ── open autocomplete lists keyboard nav helper ── */
    const navigateOpenAutocomplete = (direction) => {
      const listIds = [
        'customerAutocompleteList',
        'cityAutocompleteList',
        'contactAutocompleteList',
        'shopAutocompleteList',
        'autocompleteList',
        'categoryAutocompleteList',
      ];

      for (const id of listIds) {
        const list = document.getElementById(id);
        if (!list || list.style.display !== 'block') continue;

        const items = Array.from(list.querySelectorAll('.autocomplete-item'));
        if (!items.length) continue;

        const currentIdx = items.findIndex(i => i.classList.contains('keyboard-active'));
        let nextIdx;

        if (direction === 'down') {
          nextIdx = currentIdx === -1 ? 0 : (currentIdx + 1) % items.length;
        } else {
          nextIdx = currentIdx <= 0 ? items.length - 1 : currentIdx - 1;
        }

        items.forEach((item, i) => {
          if (i === nextIdx) {
            item.classList.add('keyboard-active');
            item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          } else {
            item.classList.remove('keyboard-active');
          }
        });
        return true; // handled
      }
      return false; // no open list found
    };

    /* ── select active autocomplete item on Enter ── */
    const selectActiveAutocompleteItem = () => {
      const listIds = [
        'customerAutocompleteList',
        'cityAutocompleteList',
        'contactAutocompleteList',
        'shopAutocompleteList',
        'autocompleteList',
        'categoryAutocompleteList',
      ];

      for (const id of listIds) {
        const list = document.getElementById(id);
        if (!list || list.style.display !== 'block') continue;

        const active = list.querySelector('.keyboard-active');
        if (active) {
          active.click();
          return true;
        }
      }
      return false;
    };

    /* ══════════════════════════════════════
       MAIN KEYDOWN HANDLER
    ══════════════════════════════════════ */
    const onKeyDown = (e) => {
      const active = document.activeElement;
      const tag    = active?.tagName;

/* ── Arrow Up / Down ── */
if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
  const dir = e.key === 'ArrowDown' ? 'down' : 'up';
  const inTable = active?.closest('#itemsTable tbody tr');

  // If in row navigation mode AND focus is actually still inside the table
  if (rowNavMode.current && inTable) {
    e.preventDefault();
    const tableRows = getTableRows();
    if (!tableRows.length) { rowNavMode.current = null; return; }

    let nextIndex = rowNavIndex.current;
    if (dir === 'down') nextIndex = Math.min(nextIndex + 1, tableRows.length - 1);
    else                nextIndex = Math.max(nextIndex - 1, 0);

    focusRowField(rowNavMode.current, nextIndex);
    return;
  }

  // Focus left the table (e.g. user clicked/tabbed to another field) —
  // row-nav mode is stale, clear it so it can't hijack future arrow presses
  if (rowNavMode.current && !inTable) {
    rowNavMode.current = null;
  }

        // If any autocomplete is open — navigate it
        if (isAnyAutocompleteOpen()) {
          e.preventDefault();
          navigateOpenAutocomplete(dir);
          return;
        }

        // Global focusable navigation
        e.preventDefault();
        const focusable = getFocusable();
        if (!focusable.length) return;
        let idx = focusable.indexOf(active);
        if (dir === 'down') idx = (idx + 1) % focusable.length;
        else                idx = idx <= 0 ? focusable.length - 1 : idx - 1;
        focusable[idx]?.focus();
        return;
      }

      /* ── Arrow Left / Right (within same row) ── */
      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        const inRow = active?.closest('#itemsTable tbody tr');
        if (!inRow) return;
        e.preventDefault();

        const fieldClasses = ['.pos-qty', '.pos-price', '.pos-discount', '.pos-tax', '.pos-delete'];
        const fields = fieldClasses
          .map(cls => inRow.querySelector(cls))
          .filter(Boolean);

        const currentIdx = fields.indexOf(active);
        if (currentIdx === -1) return;

        if (e.key === 'ArrowRight') {
          fields[(currentIdx + 1) % fields.length]?.focus();
        } else {
          fields[currentIdx <= 0 ? fields.length - 1 : currentIdx - 1]?.focus();
        }
        return;
      }

      /* ── Escape ── */
      if (e.key === 'Escape') {
        if (rowNavMode.current) {
          e.preventDefault();
          rowNavMode.current = null;
          rowNavIndex.current = 0;
          return;
        }
        // Close any open autocomplete (React handles via state in parent,
        // but we can also dispatch blur to trigger onBlur handlers)
      }

      /* ── Enter ── */
      if (e.key === 'Enter') {
        if (tag === 'BUTTON' || tag === 'SELECT') return;

        // If any autocomplete open — select active item
        if (isAnyAutocompleteOpen()) {
          const selected = selectActiveAutocompleteItem();
          if (selected) {
            e.preventDefault();
            return;
          }
          return;
        }

        // In a text/number input — move focus to Save button
        if (tag === 'INPUT') {
          e.preventDefault();
          document.querySelector('.btn-submit')?.focus();
        }
        return;
      }

      /* ── F2 → product search ── */
      if (e.key === 'F2') {
        e.preventDefault();
        productSearchRef.current?.focus();
        return;
      }

      /* ── Delete → remove first row ── */
      if (e.key === 'Delete' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        document.querySelector('#itemsTable tbody tr .pos-delete')?.click();
        return;
      }

      /* ── Tab (loop) ── */
      if (e.key === 'Tab') {
        const focusable = getFocusable();
        if (!focusable.length) return;
        const idx = focusable.indexOf(active);

        if (e.shiftKey) {
          if (idx <= 0) {
            e.preventDefault();
            focusable[focusable.length - 1]?.focus();
          }
        } else {
          if (idx >= focusable.length - 1) {
            e.preventDefault();
            focusable[0]?.focus();
          }
        }
        return;
      }

      /* ── Alt + key shortcuts ── */
      if (e.altKey) {
        const key = e.key.toLowerCase();

        /* Alt + R → price of first row, enable row nav */
        if (key === 'r') {
          e.preventDefault();
          altRPressed.current = true;
          clearTimeout(altRTimer.current);
          altRTimer.current = setTimeout(() => { altRPressed.current = false; }, 500);

          rowNavMode.current  = 'price';
          rowNavIndex.current = 0;
          focusRowField('price', 0);
          return;
        }

        /* Alt + A (after Alt+R) → received amount */
        if (key === 'a' && altRPressed.current) {
          e.preventDefault();
          altRPressed.current = false;
          clearTimeout(altRTimer.current);
          rowNavMode.current = null;
          document.getElementById('received_amount')?.focus();
          return;
        }

        /* Alt + Q → qty of first row */
        if (key === 'q') {
          e.preventDefault();
          rowNavMode.current  = 'qty';
          rowNavIndex.current = 0;
          focusRowField('qty', 0);
          return;
        }

        /* Alt + D → discount of first row */
        if (key === 'd') {
          e.preventDefault();
          rowNavMode.current = null;
          const firstRow = getTableRows()[0];
          firstRow?.querySelector('.pos-discount')?.focus();
          return;
        }

        /* Alt + T → tax of first row */
        if (key === 't') {
          e.preventDefault();
          rowNavMode.current = null;
          const firstRow = getTableRows()[0];
          firstRow?.querySelector('.pos-tax')?.focus();
          return;
        }

        /* Alt + X → delete button of first row */
        if (key === 'x') {
          e.preventDefault();
          rowNavMode.current  = 'delete';
          rowNavIndex.current = 0;
          focusRowField('delete', 0);
          return;
        }

        /* Alt + C → customer name */
        if (key === 'c') {
          e.preventDefault();
          rowNavMode.current = null;
          document.getElementById('customer_name')?.focus();
          return;
        }
      }

      // Reset Alt+R if non-alt key pressed
      if (!e.altKey && altRPressed.current) {
        altRPressed.current = false;
        clearTimeout(altRTimer.current);
      }

      /* ── Ctrl + S → Save ── */
      if (e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        document.getElementById('action_type_hidden')?.setAttribute('value', 'generate');
        document.querySelector('.btn-submit')?.click();
        return;
      }

      /* ── Ctrl + P → Save & Print ── */
      if (e.ctrlKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        document.getElementById('action_type_hidden')?.setAttribute('value', 'print');
        document.querySelector('.btn-print')?.click();
        return;
      }
    };

    const onFocusIn = (e) => {
      if (!e.target.closest?.('#itemsTable tbody tr')) {
        rowNavMode.current = null;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('focusin', onFocusIn);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('focusin', onFocusIn);
      clearTimeout(altRTimer.current);
    };
  }, [productSearchRef, rows]);
}