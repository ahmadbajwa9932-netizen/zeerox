import pool from '../db.js';
import { logActivity, formatValue } from '../helpers/activityLogger.js';
// ════════════════════════════════════════════════════════════
// calculateItemRefund — exact port of the Laravel private method
// ════════════════════════════════════════════════════════════
function calculateItemRefund(saleItem, qtyToReturn, sale) {
    // IMPORTANT: total_after_tax contains "subtotal after item discount" (before item tax)
    // IMPORTANT: total_after_discount contains "final value after item discount AND item tax"

    // Unit price after item discount only (before item tax)
    const unitAfterItemDiscount = (saleItem.quantity > 0)
        ? (saleItem.total_after_discount / saleItem.quantity)
        : 0;

    // Unit final price after item discount AND item tax
    const unitNetAfterDiscountAndTax = (saleItem.quantity > 0)
        ? (saleItem.total_after_tax / saleItem.quantity)
        : 0;

    // Calculate sale-level adjustment ratio (for sale-level discount + sale-level tax)
    const actualPaymentRatio = (sale.subtotal > 0 && sale.grand_total > 0)
        ? (sale.grand_total / sale.subtotal)
        : 1;

    // ✅ FIXED CALCULATION:
    // Step 1: Get the base amount (after item discount + item tax)
    const itemTotalAfterItemLevelAdjustments = qtyToReturn * unitNetAfterDiscountAndTax;

    // Step 2: ✅ FIX - Apply sale-level adjustments to the amount AFTER item tax
    // The subtotal for sale-level calculations should be AFTER item tax
    const itemContributionToSubtotal = itemTotalAfterItemLevelAdjustments;

    // Step 3: Apply sale-level adjustments proportionally
    const saleLevelAdjustment = itemContributionToSubtotal * (actualPaymentRatio - 1);

    // Step 4: Final refund = item total (with item tax) + sale-level adjustments
    const finalRefundAmount = itemTotalAfterItemLevelAdjustments + saleLevelAdjustment;

    return {
        unit_net: unitNetAfterDiscountAndTax,
        refund_amount: finalRefundAmount
    };
}

export default async function saleReturnProcessRoutes(fastify) {

    // ════════════════════════════════════════════════════════════
    // GET /api/sales/:saleId/partial-return-data
    // -> mirrors showPartialReturn()
    // ════════════════════════════════════════════════════════════
    fastify.get('/api/sales/:saleId/partial-return-data', async (req, reply) => {
        const saleId = req.params.saleId;

        try {
            // Get sale with customer
            const [saleRows] = await pool.query(
                `SELECT sales.*, customers.name as customer_name, customers.contact as customer_contact,
                        customers.shop_name as customer_shop_name, customers.city as customer_city
                 FROM sales
                 LEFT JOIN customers ON sales.customer_id = customers.id
                 WHERE sales.id = ?
                 LIMIT 1`,
                [saleId]
            );

            if (!saleRows.length) {
                return reply.status(404).send({ success: false, message: 'Sale not found' });
            }

            const sale = saleRows[0];

            // ✅ FIXED: Use same calculation as working SaleReturnController
            // Calculate the actual payment ratio (what customer actually paid per subtotal unit)
            const actualPaymentRatio = (sale.subtotal > 0 && sale.grand_total > 0)
                ? (sale.grand_total / sale.subtotal)
                : 1;

            // Get sale items with remaining quantities
            const [itemRows] = await pool.query(
                `SELECT
                    sale_items.id,
                    sale_items.sale_id,
                    sale_items.purchase_id,
                    sale_items.quantity as original_quantity,
                    sale_items.price,
                    sale_items.total_after_discount,
                    sale_items.discount_type,
                    sale_items.discount_value,
                    sale_items.discount_amount,
                    sale_items.total_after_tax,
                    sale_items.tax_type,
                    sale_items.tax_value,
                    sale_items.tax_amount,
                    purchases.product_name,
                    COALESCE(returned_qty.total_returned, 0) as returned_quantity,
                    (sale_items.quantity - COALESCE(returned_qty.total_returned, 0)) as remaining_quantity
                 FROM sale_items
                 JOIN purchases ON sale_items.purchase_id = purchases.id
                 LEFT JOIN (
                     SELECT sale_item_id, SUM(quantity_returned) as total_returned
                     FROM sale_return_items
                     GROUP BY sale_item_id
                 ) as returned_qty ON sale_items.id = returned_qty.sale_item_id
                 WHERE purchases.type IN ('product','medicine')
                   AND sale_items.sale_id = ?
                 HAVING remaining_quantity > 0`,
                [saleId]
            );

            // mirrors the ->map() in Laravel: build per-unit calculations + nest purchase object
            const saleItems = itemRows.map((item) => {
                const originalQty = item.original_quantity;

                const unitItemDiscount = (originalQty > 0)
                    ? (item.discount_amount / originalQty)
                    : 0;

                    const unitAfterItemDiscount = (originalQty > 0)
                    ? (item.total_after_discount / originalQty)
                    : 0;

                const unitItemTax = (originalQty > 0)
                    ? (item.tax_amount / originalQty)
                    : 0;

                const unitFinalPrice = (originalQty > 0)
                    ? (item.total_after_tax / originalQty)
                    : 0;

                return {
                    id: item.id,
                    sale_id: item.sale_id,
                    purchase_id: item.purchase_id,
                    quantity: item.remaining_quantity,
                    original_quantity: item.original_quantity,
                    returned_quantity: item.returned_quantity,
                    price: item.price,
                    discount_amount: item.discount_amount,
                    total_after_tax: item.total_after_tax, // total after discount only
                    tax_amount: item.tax_amount,
                    total_after_discount: item.total_after_discount, // final total
                    discount_type: item.discount_type,
                    discount_value: item.discount_value,
                    tax_type: item.tax_type,
                    tax_value: item.tax_value,
                    unit_item_discount: unitItemDiscount,
                    unit_after_item_discount: unitAfterItemDiscount,
                    unit_item_tax: unitItemTax,
                    unit_final_price: unitFinalPrice,
                    purchase: {
                        product_name: item.product_name
                    }
                };
            });

            // Calculate already returned quantities for validation (legacy compatibility)
            const alreadyReturned = {};
            saleItems.forEach((item) => {
                alreadyReturned[item.id] = item.returned_quantity;
            });

            return reply.send({
                success: true,
                sale,
                saleItems,
                alreadyReturned,
                actualPaymentRatio
            });

        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ success: false, message: 'Failed to load partial return data: ' + err.message });
        }
    });

    // ════════════════════════════════════════════════════════════
    // POST /api/sales/:saleId/full-return
    // -> mirrors processFullReturn()
    // ════════════════════════════════════════════════════════════
    fastify.post('/api/sales/:saleId/full-return', async (req, reply) => {
        const saleId = req.params.saleId;
        const conn = await pool.getConnection();

        try {
            await conn.beginTransaction();

            // Get sale
            const [saleRows] = await conn.query(`SELECT * FROM sales WHERE id = ? LIMIT 1`, [saleId]);
            if (!saleRows.length) {
                throw new Error('Sale not found');
            }
            const sale = saleRows[0];
            // sale.customer_id already exists on the sales row — no extra join needed

            // Get sale items with purchase
            const [saleItemRows] = await conn.query(
                `SELECT sale_items.*, purchases.type as purchase_type, purchases.sold_quantity as purchase_sold_quantity,
                        purchases.product_name as product_name
                 FROM sale_items
                 JOIN purchases ON sale_items.purchase_id = purchases.id
                 WHERE sale_items.sale_id = ?`,
                [saleId]
            );

            // Get items that still have returnable quantities
            const returnableItems = [];

            for (const saleItem of saleItemRows) {
                // ❌ Skip services completely
                if (saleItem.purchase_type === 'service') {
                    continue;
                }

                // Check how much is already returned for this item
                const [sumRows] = await conn.query(
                    `SELECT COALESCE(SUM(quantity_returned), 0) as total_returned
                     FROM sale_return_items
                     WHERE sale_item_id = ?`,
                    [saleItem.id]
                );
                const alreadyReturned = sumRows[0].total_returned;

                const remainingQty = saleItem.quantity - alreadyReturned;

                // Only include items that have remaining quantity to return
                if (remainingQty > 0) {
                    returnableItems.push({ saleItem, remainingQty });
                }
            }

            // Check if there are any items that can be returned
            if (returnableItems.length === 0) {
                throw new Error('All items from this sale have already been fully returned.');
            }

                       // Name of the user performing this return (may differ from the original seller)
                       const returningUserId = req.user?.id || req.session?.userId;
                       const [[returningUserRow]] = await conn.query('SELECT name FROM users WHERE id = ?', [returningUserId]);
                       const returningUserName = returningUserRow?.name || null;
           
                       // Create return record (voucher_no stored so report still works after sale deletion)
                       const [insertReturn] = await conn.query(
                           `INSERT INTO sale_returns (
                               sale_id, voucher_no, user_id, seller_name, customer_id, payment_type, sale_date, total_return_amount, status, notes,
                               original_subtotal, updated_subtotal,
                               discount_type, original_discount_value, original_discount_amount, updated_discount_value, updated_discount_amount,
                               tax_type, original_tax_value, original_tax_amount, updated_tax_value, updated_tax_amount,
                               original_received_amount, updated_received_amount,
                               original_change_amount, updated_change_amount,
                               original_grand_total, updated_grand_total
                            )
                            VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'completed', 'Full return of remaining items processed',
                               ?, 0,
                               ?, ?, ?, 0, 0,
                               ?, ?, ?, 0, 0,
                               ?, ?,
                               ?, ?,
                               ?, 0)`,
                               [
                                   saleId, sale.voucher_no, returningUserId, returningUserName, sale.customer_id, sale.payment_type, sale.sale_date,
                                   sale.subtotal,
                               sale.discount_type, sale.discount, sale.discount_amount,
                               sale.tax_type, sale.tax, sale.tax_amount,
                               sale.received_amount, sale.received_amount,
                               sale.change_amount, sale.change_amount,
                               sale.grand_total
                           ]
                       );
                       const saleReturnId = insertReturn.insertId;

            let totalRefund = 0;
            let totalTaxAmount = 0;  

            // Process each returnable item with correct calculations
            for (const { saleItem, remainingQty } of returnableItems) {
                const qtyToReturn = remainingQty;

                // ✅ Use the corrected calculation method
                const refundData = calculateItemRefund(saleItem, qtyToReturn, sale);

                totalRefund += refundData.refund_amount;
                totalTaxAmount += parseFloat(saleItem.tax_amount) || 0;

                // Create return item (product_name denormalized so it survives sale_item deletion)
                await conn.query(
                    `INSERT INTO sale_return_items
                        (sale_return_id, sale_item_id, purchase_id, product_name, price, purchased_price, quantity_returned, unit_net_after_discount, amount_refunded,
                         original_quantity, discount_type, original_discount_value, original_discount_amount,
                         tax_type, original_tax_value, original_tax_amount)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        saleReturnId, saleItem.id, saleItem.purchase_id, saleItem.product_name, saleItem.price, saleItem.purchased_price, qtyToReturn, refundData.unit_net, refundData.refund_amount,
                        saleItem.quantity, saleItem.discount_type, saleItem.discount_value, saleItem.discount_amount,
                        saleItem.tax_type, saleItem.tax_value, saleItem.tax_amount
                    ]
                );

                // Update stock: reduce sold quantity on purchase
                const newSold = Math.max(0, parseInt(saleItem.purchase_sold_quantity) - qtyToReturn);
                await conn.query(`UPDATE purchases SET sold_quantity = ? WHERE id = ?`, [newSold, saleItem.purchase_id]);
            }

            // Update total return amount + net received amount.
            // The refund was handed back at return time, so the amount the shop actually
            // keeps from this sale drops by the refund total. change_amount is untouched —
            // that was already given to the customer at the original checkout.
            const updatedReceivedAmount = parseFloat(sale.received_amount) - totalRefund;
            const finalTotalTax = totalTaxAmount + (parseFloat(sale.tax_amount) || 0);   // ADD THIS
            
            await conn.query(
                `UPDATE sale_returns SET total_return_amount = ?, updated_received_amount = ?, total_tax = ? WHERE id = ?`,
                [totalRefund, updatedReceivedAmount, finalTotalTax, saleReturnId]   // add finalTotalTax
            );

           // Full return -> remove the sale completely (sale_items cascades via FK ON DELETE CASCADE
            // from sale_items.sale_id -> sales.id, which is already defined in your schema)
            await conn.query(`DELETE FROM sales WHERE id = ?`, [saleId]);

            await conn.commit();

            const itemsSummary = returnableItems
                .map(({ saleItem, remainingQty }) => `${saleItem.product_name} (Qty: ${formatValue(remainingQty)})`)
                .join(', ');

            await logActivity(req, {
                action_type: 'full return',
                description: `Processed full return for sale "${sale.voucher_no}" — Rs ${totalRefund.toFixed(2)} refunded — Items: ${itemsSummary}`,
                entity_type: 'sale_return',
                entity_id: saleReturnId,
                old_data: { voucher_no: sale.voucher_no, grand_total: sale.grand_total },
                new_data: { total_refund: totalRefund, items_returned: returnableItems.length },
            });

            return reply.send({ success: true, message: 'Full return of remaining items processed successfully.' });

        } catch (err) {
            await conn.rollback();
            fastify.log.error(err);
            return reply.status(400).send({ success: false, message: err.message });
        } finally {
            conn.release();
        }
    });

    // ════════════════════════════════════════════════════════════
    // POST /api/sales/:saleId/partial-return
    // -> mirrors processPartialReturn()
    // Body: { items: { [sale_item_id]: qtyToReturn, ... }, notes: '...' }
    // ════════════════════════════════════════════════════════════
    fastify.post('/api/sales/:saleId/partial-return', async (req, reply) => {
        const saleId = req.params.saleId;
        const { items, notes } = req.body || {};

        // validate: items required array/object, min 1 key
        if (!items || typeof items !== 'object' || Object.keys(items).length === 0) {
            return reply.status(422).send({ success: false, message: 'The items field is required.' });
        }

        const conn = await pool.getConnection();

        try {
            await conn.beginTransaction();

            // Get sale
            const [saleRows] = await conn.query(`SELECT * FROM sales WHERE id = ? LIMIT 1`, [saleId]);
            if (!saleRows.length) {
                throw new Error('Sale not found');
            }
            const sale = saleRows[0];
            const originalSale = { ...sale }; // preserve true pre-return values for audit columns

            // Check if there are items to return
            let hasItemsToReturn = false;
            for (const qty of Object.values(items)) {
                if (parseInt(qty) > 0) {
                    hasItemsToReturn = true;
                    break;
                }
            }

            if (!hasItemsToReturn) {
                throw new Error('Please select at least one item to return.');
            }

                       // Name of the user performing this return (may differ from the original seller)
                       const returningUserId = req.session?.userId || req.user?.id;
                       const [[returningUserRow]] = await conn.query('SELECT name FROM users WHERE id = ?', [returningUserId]);
                       const returningUserName = returningUserRow?.name || null;
           
                       // Create return record
                       const [insertReturn] = await conn.query(
                           `INSERT INTO sale_returns (sale_id, voucher_no, user_id, seller_name, customer_id, payment_type, sale_date, total_return_amount, status, notes)
                            VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'completed', ?)`,
                           [null, sale.voucher_no, returningUserId, returningUserName, sale.customer_id, sale.payment_type, sale.sale_date, notes || 'Partial return processed']
                       );
                       const saleReturnId = insertReturn.insertId;

            let totalRefund = 0;
            let totalItemsTaxAccum = 0;      
let totalAfterItemsTaxAccum = 0;
const returnedItemsSummary = [];

            for (const [saleItemId, rawQty] of Object.entries(items)) {
                const qtyToReturn = parseInt(rawQty);
                if (qtyToReturn <= 0) {
                    continue;
                }

                // Get sale item with purchase
                const [saleItemRows] = await conn.query(
                    `SELECT sale_items.*, purchases.sold_quantity as purchase_sold_quantity
                     FROM sale_items
                     JOIN purchases ON sale_items.purchase_id = purchases.id
                     WHERE sale_items.id = ?
                     LIMIT 1`,
                    [saleItemId]
                );

                if (!saleItemRows.length) {
                    throw new Error(`Sale item ${saleItemId} not found.`);
                }
                const saleItem = saleItemRows[0];

                // Ensure item belongs to this sale
                if (parseInt(saleItem.sale_id) !== parseInt(saleId)) {
                    throw new Error('Invalid item: does not belong to this sale.');
                }

                // Check how much is already returned
                const [sumRows] = await conn.query(
                    `SELECT COALESCE(SUM(quantity_returned), 0) as total_returned
                     FROM sale_return_items
                     WHERE sale_item_id = ?`,
                    [saleItem.id]
                );
                const alreadyReturned = sumRows[0].total_returned;
                const maxReturnable = saleItem.quantity - alreadyReturned;

                if (maxReturnable <= 0) {
                    throw new Error('Item already fully returned.');
                }
                if (qtyToReturn > maxReturnable) {
                    throw new Error(`Return quantity exceeds remaining returnable quantity (max ${maxReturnable}).`);
                }

                // ✅ Use the corrected calculation method
                const refundData = calculateItemRefund(saleItem, qtyToReturn, sale);

                totalRefund += refundData.refund_amount;
                // item-level tax portion for the qty being returned
const unitItemTax = saleItem.quantity > 0 ? (saleItem.tax_amount / saleItem.quantity) : 0;
totalItemsTaxAccum += qtyToReturn * unitItemTax;

// "after item tax" contribution, needed as the base for the sale-level tax ratio
const unitFinalPriceForTax = saleItem.quantity > 0 ? (saleItem.total_after_tax / saleItem.quantity) : 0;
totalAfterItemsTaxAccum += qtyToReturn * unitFinalPriceForTax;

                 // need product_name for denormalized record on sale_return_items
                 const [purchaseRow] = await conn.query(`SELECT product_name FROM purchases WHERE id = ?`, [saleItem.purchase_id]);
                 const productName = purchaseRow.length ? purchaseRow[0].product_name : null;
 
                 returnedItemsSummary.push(`${productName || 'Unknown item'} (Qty: ${formatValue(qtyToReturn)})`);

                // Save return item details
                await conn.query(
                    `INSERT INTO sale_return_items
                        (sale_return_id, sale_item_id, purchase_id, product_name, price, purchased_price, quantity_returned, unit_net_after_discount, amount_refunded,
                         original_quantity, discount_type, original_discount_value, original_discount_amount,
                         tax_type, original_tax_value, original_tax_amount)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        saleReturnId, null, saleItem.purchase_id, productName, saleItem.price, saleItem.purchased_price, qtyToReturn, refundData.unit_net, refundData.refund_amount,
                        saleItem.quantity, saleItem.discount_type, saleItem.discount_value, saleItem.discount_amount,
                        saleItem.tax_type, saleItem.tax_value, saleItem.tax_amount
                    ]
                );

                // Update stock: reduce sold quantity on purchase
                const newSold = Math.max(0, parseInt(saleItem.purchase_sold_quantity) - qtyToReturn);
                await conn.query(`UPDATE purchases SET sold_quantity = ? WHERE id = ?`, [newSold, saleItem.purchase_id]);

                // ── Adjust sale_items row for this item ──
                const remainingQtyOnItem = saleItem.quantity - qtyToReturn;

                if (remainingQtyOnItem <= 0) {
                    // Fully returned this item -> remove the row.
                    // sale_return_items.sale_item_id is ON DELETE SET NULL, so the report row survives.
                    await conn.query(`DELETE FROM sale_items WHERE id = ?`, [saleItem.id]);
                } else {
                    const unitDiscount = saleItem.discount_amount / saleItem.quantity;
                    const unitTax = saleItem.tax_amount / saleItem.quantity;
                    const unitTotal = saleItem.total / saleItem.quantity;
                    const unitTotalAfterTax = saleItem.total_after_tax / saleItem.quantity;
                    const unitTotalAfterDiscount = saleItem.total_after_discount / saleItem.quantity;

                    // discount_value / tax_value only get prorated when they represent an
                    // absolute amount for the row. When type is 'percentage' the value is a
                    // rate and is independent of quantity, so it must stay as-is.
                    const newDiscountValue = saleItem.discount_type === 'amount'
                        ? (saleItem.discount_value / saleItem.quantity) * remainingQtyOnItem
                        : saleItem.discount_value;

                    const newTaxValue = saleItem.tax_type === 'amount'
                        ? (saleItem.tax_value / saleItem.quantity) * remainingQtyOnItem
                        : saleItem.tax_value;

                    await conn.query(
                        `UPDATE sale_items SET
                            quantity = ?,
                            discount_value = ?,
                            discount_amount = ?,
                            tax_value = ?,
                            tax_amount = ?,
                            total = ?,
                            total_after_tax = ?,
                            total_after_discount = ?
                         WHERE id = ?`,
                        [
                            remainingQtyOnItem,
                            newDiscountValue,
                            unitDiscount * remainingQtyOnItem,
                            newTaxValue,
                            unitTax * remainingQtyOnItem,
                            unitTotal * remainingQtyOnItem,
                            unitTotalAfterTax * remainingQtyOnItem,
                            unitTotalAfterDiscount * remainingQtyOnItem,
                            saleItem.id
                        ]
                    );
                }

               // ── Adjust sale-level totals proportionally ──
                // itemTotalAfterItemLevelAdjustments is the item's contribution to sale.subtotal
                const itemSubtotalContribution = qtyToReturn * (saleItem.total_after_tax / saleItem.quantity);
                sale.subtotal = parseFloat(sale.subtotal) - itemSubtotalContribution;
                sale.grand_total = parseFloat(sale.grand_total) - refundData.refund_amount;
                // received_amount tracks grand_total 1:1 for these sale types (fully paid upfront),
                // so it shrinks by the same refund amount. change_amount stays untouched.
                sale.received_amount = parseFloat(sale.received_amount) - refundData.refund_amount;
            }

          // Check if ANY sale_items remain for this sale — if not, the "partial" return
            // has actually emptied the whole sale, so behave exactly like a full return.
            const [remainingItemsRows] = await conn.query(
                `SELECT COUNT(*) as remaining FROM sale_items WHERE sale_id = ?`,
                [saleId]
            );
            const noItemsLeft = remainingItemsRows[0].remaining === 0;

            let finalUpdatedSubtotal = sale.subtotal;
            let finalUpdatedDiscountAmount;
            let finalUpdatedTaxAmount;
            let finalUpdatedDiscountValue;
            let finalUpdatedTaxValue;
            let finalUpdatedGrandTotal = sale.grand_total;
            let finalUpdatedReceivedAmount = sale.received_amount;

            if (noItemsLeft) {
                // Sale is now fully emptied out — delete it just like processFullReturn() does.
                // sale_items is already empty; this also cascades any remaining child rows (payments, etc).
                await conn.query(`DELETE FROM sales WHERE id = ?`, [saleId]);

                finalUpdatedSubtotal = 0;
                finalUpdatedDiscountAmount = 0;
                finalUpdatedTaxAmount = 0;
                finalUpdatedDiscountValue = 0;
                finalUpdatedTaxValue = 0;
                finalUpdatedGrandTotal = 0;
                finalUpdatedReceivedAmount = 0;
            } else {
                // Recompute sale-level discount_amount/tax_amount proportionally to the new subtotal,
                // then persist the adjusted sale row.
                const oldSubtotalForRatio = originalSale.subtotal;
                const ratio = oldSubtotalForRatio > 0 ? (sale.subtotal / oldSubtotalForRatio) : 0;
                finalUpdatedDiscountAmount = originalSale.discount_amount * ratio;
                finalUpdatedTaxAmount = originalSale.tax_amount * ratio;

                // Same amount-vs-percentage rule as sale_items: only prorate the value
                // column when it's an absolute amount; percentage rates don't scale with subtotal.
                finalUpdatedDiscountValue = originalSale.discount_type === 'amount'
                    ? originalSale.discount * ratio
                    : originalSale.discount;

                finalUpdatedTaxValue = originalSale.tax_type === 'amount'
                    ? originalSale.tax * ratio
                    : originalSale.tax;

                await conn.query(
                    `UPDATE sales SET subtotal = ?, grand_total = ?, discount = ?, discount_amount = ?, tax = ?, tax_amount = ?, received_amount = ? WHERE id = ?`,
                    [sale.subtotal, sale.grand_total, finalUpdatedDiscountValue, finalUpdatedDiscountAmount, finalUpdatedTaxValue, finalUpdatedTaxAmount, finalUpdatedReceivedAmount, saleId]
                );
            }

            // sale-level tax portion, proportional — uses ORIGINAL (pre-mutation) sale values
const saleLevelTaxAdjustment = (parseFloat(originalSale.tax_amount) > 0 && parseFloat(originalSale.subtotal) > 0)
? (totalAfterItemsTaxAccum * (parseFloat(originalSale.tax_amount) / parseFloat(originalSale.subtotal)))
: 0;

const finalTotalTax = totalItemsTaxAccum + saleLevelTaxAdjustment;

            // Update total return amount + original/updated audit columns
            await conn.query(
                `UPDATE sale_returns SET
                    total_return_amount = ?,
                     total_tax = ?,
                    original_subtotal = ?, updated_subtotal = ?,
                    discount_type = ?, original_discount_value = ?, original_discount_amount = ?, updated_discount_value = ?, updated_discount_amount = ?,
                    tax_type = ?, original_tax_value = ?, original_tax_amount = ?, updated_tax_value = ?, updated_tax_amount = ?,
                    original_received_amount = ?, updated_received_amount = ?,
                    original_change_amount = ?, updated_change_amount = ?,
                    original_grand_total = ?, updated_grand_total = ?
                 WHERE id = ?`,
                 [
                    totalRefund,
                    finalTotalTax,
                    originalSale.subtotal, finalUpdatedSubtotal,
                    originalSale.discount_type, originalSale.discount, originalSale.discount_amount, finalUpdatedDiscountValue, finalUpdatedDiscountAmount,
                    originalSale.tax_type, originalSale.tax, originalSale.tax_amount, finalUpdatedTaxValue, finalUpdatedTaxAmount,
                    originalSale.received_amount, finalUpdatedReceivedAmount,
                    originalSale.change_amount, originalSale.change_amount,
                    originalSale.grand_total, finalUpdatedGrandTotal,
                    saleReturnId
                ]
            );

            await conn.commit();

            await logActivity(req, {
                action_type: 'partial return',
                description: noItemsLeft
                    ? `Processed partial return for sale "${sale.voucher_no}" — Rs ${totalRefund.toFixed(2)} refunded — Items: ${returnedItemsSummary.join(', ')} — sale emptied and removed`
                    : `Processed partial return for sale "${sale.voucher_no}" — Rs ${totalRefund.toFixed(2)} refunded — Items: ${returnedItemsSummary.join(', ')} — Grand Total: ${formatValue(originalSale.grand_total)} → ${formatValue(finalUpdatedGrandTotal)}`,
                entity_type: 'sale_return',
                entity_id: saleReturnId,
                old_data: { voucher_no: sale.voucher_no, grand_total: originalSale.grand_total },
                new_data: { total_refund: totalRefund, grand_total: finalUpdatedGrandTotal },
            });

            return reply.send({ success: true, message: 'Partial return processed successfully.' });

        } catch (err) {
            await conn.rollback();
            fastify.log.error(err);
            return reply.status(400).send({ success: false, message: err.message });
        } finally {
            conn.release();
        }
    });

    // ════════════════════════════════════════════════════════════
    // POST /api/sales/:saleId/return  (legacy alias -> store())
    // -> mirrors store() which just calls processPartialReturn()
    // ════════════════════════════════════════════════════════════
    fastify.post('/api/sales/:saleId/return', async (req, reply) => {
        return fastify.inject({
            method: 'POST',
            url: `/api/sales/${req.params.saleId}/partial-return`,
            payload: req.body,
            headers: req.headers
        }).then((res) => {
            reply.code(res.statusCode);
            return reply.send(res.json());
        });
    });
}