"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, API } from "@/lib/api";
import { formatPrice } from "@/lib/currency-context";
import styles from "./page.module.css";

export default function PurchaseDetailPage() {
    const { id } = useParams();
    const router = useRouter();

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [purchase, setPurchase] = useState(null);

    const modalRef = useRef(null);
    const modalImgRef = useRef(null);
    const scaleRef = useRef(1);

    useEffect(() => {
        loadPurchaseData();
    }, [id]);

    function loadPurchaseData() {
        setLoading(true);
        setError(null);

        apiFetch(`/api/purchases/${id}/detail-data`)
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
                return res.json();
            })
            .then((data) => {
                if (data.success) {
                    setPurchase(data.data);
                } else {
                    throw new Error(data.message || "Failed to load data");
                }
            })
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));
    }


    function formatNumber(number, decimals = 2) {
        return parseFloat(number).toLocaleString("en-US", {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
        });
    }

    function formatDate(dateString) {
        if (!dateString) return "N/A";
        const date = new Date(dateString);
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        return `${date.getDate()}-${months[date.getMonth()]}-${date.getFullYear()}`;
    }

    function openImageModal(src) {
        if (!modalRef.current || !modalImgRef.current) return;
        modalRef.current.style.display = "flex";
        modalImgRef.current.src = src;
        scaleRef.current = 1;
        modalImgRef.current.style.transform = "scale(1)";
    }

    function closeImageModal(e) {
        if (e.target === modalRef.current || e.target.id === "closeModal") {
            modalRef.current.style.display = "none";
        }
    }

    function handleWheelZoom(e) {
        e.preventDefault();
        if (e.deltaY < 0) {
            scaleRef.current += 0.1;
        } else if (scaleRef.current > 0.5) {
            scaleRef.current -= 0.1;
        }
        modalImgRef.current.style.transform = `scale(${scaleRef.current})`;
    }

    return (
<div className={`${styles.page} container`}>
<div className={styles.topBar}>
    <div>
        <h1 className="main-text">Products in the store</h1>
        <p className="sub-text">
    <span>
        Detail of: <strong>{purchase ? purchase.product_name : "Loading..."} </strong>
        {purchase && <span className={styles.typeBadge}>{purchase.type}</span>}
    </span>
</p>
    </div>
    <Link href="/purchase/list" className="boton-elegante">← Back</Link>
</div>

            {loading && (
                <div className={styles.loadingState}>
                    <div className={styles.spinner}></div>
                    <p>Loading purchase details…</p>
                </div>
            )}

            {!loading && error && (
                <div className={styles.errorState}>
                    <h3>Couldn't load this purchase</h3>
                    <p>{error}</p>
                    <button onClick={loadPurchaseData} className={styles.retryButton}>
                        Retry
                    </button>
                </div>
            )}

            {!loading && !error && purchase && (
                <PurchaseDetail
                    purchase={purchase}
                    formatPrice={formatPrice}
                    formatNumber={formatNumber}
                    formatDate={formatDate}
                    onImageClick={openImageModal}
                />
            )}

            {/* Full Image Modal */}
            <div className={styles.imageModal} ref={modalRef} onClick={closeImageModal}>
                <span id="closeModal" className={styles.closeBtn}>&times;</span>
                <img ref={modalImgRef} alt="" onWheel={handleWheelZoom} />
            </div>
        </div>
    );
}

function PurchaseDetail({ purchase, formatPrice, formatNumber, formatDate, onImageClick }) {
    const isService = purchase.type === "service";
    const isMedicine = purchase.type === "medicine";
    const hasImage = purchase.image && purchase.has_image;
    const imageUrl = hasImage ? `${API}/public/${purchase.image}` : null;
    const hasTax = purchase.tax > 0;
    const hasDiscount = purchase.discount > 0;
    const hasPricingConfig = hasTax || hasDiscount;

    const profitOrLoss = purchase.profit_or_loss;
    const isProfit = profitOrLoss >= 0;

    return (
        <div className={styles.contentGrid}>
            {/* Product Details */}
            <div className={styles.detailsCard}>
                <div className={styles.cardTitle}>{isService ? "Service Details" : "Product Details"}</div>

                <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Name</span>
                    <span className={styles.detailValue}>{purchase.product_name}</span>
                </div>

                {!isService && !isMedicine && (
                    <div className={styles.detailRow}>
                        <span className={styles.detailLabel}>Product Code / Model</span>
                        <span className={styles.detailValue}>{purchase.product_code ?? "N/A"}</span>
                    </div>
                )}

                <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Category</span>
                    <span className={styles.detailValue}>{purchase.category_name}</span>
                </div>

                {isMedicine && (
                    <div className={styles.detailRow}>
                        <span className={styles.detailLabel}>Purchased Price / Item</span>
                        <span className={styles.detailValue}>{formatPrice(purchase.purchased_price)}</span>
                    </div>
                )}

                {!isService && !isMedicine && (
                    <div className={styles.detailRow}>
                        <span className={styles.detailLabel}>Purchased Price</span>
                        <span className={styles.detailValue}>{formatPrice(purchase.purchased_price)}</span>
                    </div>
                )}

                {purchase.previous_sold_price && (
                    <div className={styles.detailRow}>
                        <span className={styles.detailLabel}>Previous Sold Price</span>
                        <span className={styles.detailValue}>{formatPrice(purchase.previous_sold_price)}</span>
                    </div>
                )}

                <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Sold Price</span>
                    <span className={styles.detailValue}>
                        {formatPrice(purchase.sold_price)}
                        {purchase.fix_sold_price && <span className={`${styles.badge} ${styles.badgeFixed}`}>FIXED</span>}
                    </span>
                </div>

                {!isService && (
                    <div className={styles.detailRow}>
                        <span className={styles.detailLabel}>{isMedicine ? "Total Items" : "Total Stock"}</span>
                        <span className={styles.detailValue}>{formatNumber(purchase.quantity, 0)}</span>
                    </div>
                )}

                <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Unit</span>
                    <span className={styles.detailValue}>{purchase.unit}</span>
                </div>

                {!isService && !isMedicine && (
                    <div className={styles.detailRow}>
                        <span className={styles.detailLabel}>Total Price</span>
                        <span className={styles.detailValue}>{formatPrice(purchase.total_price)}</span>
                    </div>
                )}

                {!isService && (
                    <div className={styles.detailRow}>
                        <span className={styles.detailLabel}>{isMedicine ? "Sold Items" : "Sold Quantity"}</span>
                        <span className={styles.detailValue}>{purchase.sold_quantity}</span>
                    </div>
                )}

                {!isService && (
                    <div className={styles.detailRow}>
                        <span className={styles.detailLabel}>{isMedicine ? "Remaining Items" : "Remaining Quantity"}</span>
                        <span className={styles.detailValue}>{purchase.remaining_quantity}</span>
                    </div>
                )}

<div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Purchase Date</span>
                    <span className={styles.detailValue}>{formatDate(purchase.purchase_date)}</span>
                </div>

                <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Purchase Added</span>
                    <span className={styles.detailValue}>{formatDate(purchase.created_at)}</span>
                </div>

                {!isService && purchase.expiry_date && (
                    <div className={styles.detailRow}>
                        <span className={styles.detailLabel}>Expiry Date</span>
                        <span className={styles.detailValue}>{formatDate(purchase.expiry_date)}</span>
                    </div>
                )}

                {hasPricingConfig && (
                    <div className={styles.subSection}>
                        <div className={styles.subSectionLabel}>Pricing Configuration</div>

                        {hasTax && (
                            <div className={styles.detailRow}>
                                <span className={styles.detailLabel}>Tax</span>
                                <span className={styles.detailValue}>
                                    {purchase.tax_type === "percentage" ? `${formatNumber(purchase.tax)}%` : formatPrice(purchase.tax)}
                                    <span className={`${styles.badge} ${purchase.fix_tax ? styles.badgeFixed : styles.badgeVariable}`}>
                                        {purchase.fix_tax ? "FIXED" : "VARIABLE"}
                                    </span>
                                </span>
                            </div>
                        )}

                        {hasDiscount && (
                            <div className={styles.detailRow}>
                                <span className={styles.detailLabel}>Discount</span>
                                <span className={styles.detailValue}>
                                    {purchase.discount_type === "percentage" ? `${formatNumber(purchase.discount)}%` : formatPrice(purchase.discount)}
                                    <span className={`${styles.badge} ${purchase.fix_discount ? styles.badgeFixed : styles.badgeVariable}`}>
                                        {purchase.fix_discount ? "FIXED" : "VARIABLE"}
                                    </span>
                                </span>
                            </div>
                        )}
                    </div>
                )}
            </div>

           {/* Supplier Details */}
           {!isService && (
                <div className={styles.supplierCard}>
                    <div className={styles.cardTitle}>Supplier Details</div>
                    <div className={styles.detailRow}>
                        <span className={styles.detailLabel}>Supplier Name</span>
                        <span className={styles.detailValue}>{purchase.supplier_name || "N/A"}</span>
                    </div>
                    <div className={styles.detailRow}>
                        <span className={styles.detailLabel}>Company</span>
                        <span className={styles.detailValue}>{purchase.supplier_company || "N/A"}</span>
                    </div>
                    <div className={styles.detailRow}>
                        <span className={styles.detailLabel}>Address</span>
                        <span className={styles.detailValue}>{purchase.supplier_address || "N/A"}</span>
                    </div>
                    <div className={styles.detailRow}>
                        <span className={styles.detailLabel}>Contact Info</span>
                        <span className={styles.detailValue}>{purchase.supplier_contact || "N/A"}</span>
                    </div>
                </div>
            )}

            {/* Product Image */}
            {hasImage && (
                <div className={styles.imageCard}>
                    <div className={styles.cardTitle}>Product Image</div>
                    <div className={styles.imageFrame} onClick={() => onImageClick(imageUrl)}>
                        <img src={imageUrl} alt={purchase.product_name} />
                    </div>
                </div>
            )}

            {/* Performance Overview */}
            <div className={styles.performanceCard}>
                <div className={styles.cardTitle}>
                    {isService ? "Service Performance Overview" : "Product Performance Overview"}
                </div>

                <div className={styles.statGrid}>
                    <div className={styles.statCell}>
                        <div className={styles.statLabel}>Total Revenue</div>
                        <div className={styles.statValue}>{formatPrice(purchase.total_revenue)}</div>
                    </div>

                    {!isService && (
                        <>
                            <div className={styles.statCell}>
                                <div className={styles.statLabel}>Sold Inventory Cost (Paid)</div>
                                <div className={styles.statValue}>{formatPrice(purchase.total_cost)}</div>
                            </div>
                            <div className={styles.statCell}>
                                <div className={styles.statLabel}>Available Inventory Cost</div>
                                <div className={`${styles.statValue} ${purchase.available_inventory_cost <= 0 ? styles.statValueNegative : ""}`}>
                                    {formatPrice(purchase.available_inventory_cost)}
                                </div>
                            </div>
                            <div className={styles.statCell}>
                                <div className={styles.statLabel}>{isProfit ? "Profit" : "Loss"}</div>
                                <div className={`${styles.statValue} ${isProfit ? styles.statValuePositive : styles.statValueNegative}`}>
                                    <span className={styles.statTrend}>{isProfit ? "▲" : "▼"}</span>
                                    {formatPrice(Math.abs(profitOrLoss))}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}