-- ─────────────────────────────────────────────────────
-- POS SYSTEM - DATABASE SCHEMA
-- Run this file once to set up the database
-- ─────────────────────────────────────────────────────

CREATE DATABASE IF NOT EXISTS `pos-system1`;
USE `pos-system1`;


-- ─────────────────────────────────────────────────────
-- AUTH TABLES - Append to existing schema.sql
-- ─────────────────────────────────────────────────────

-- ─── ADMIN SETTINGS ───────────────────────────────────
CREATE TABLE IF NOT EXISTS `admin_settings` (
    `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `shop_name`  VARCHAR(255) NULL,
    `phone`      VARCHAR(50)  NULL,
    `address`    VARCHAR(500) NULL,
    `city`       VARCHAR(100) NULL,
    `logo`       VARCHAR(255) NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ─── USERS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `users` (
    `id`                       INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `name`                     VARCHAR(255) NOT NULL,
    `email`                    VARCHAR(255) NOT NULL UNIQUE,
    `profile_picture`          VARCHAR(255) NULL,
    `password`                 VARCHAR(255) NOT NULL,
    `plain_password`           TEXT NULL,
    `software_password`        VARCHAR(255) NOT NULL,
    `original_software_password` VARCHAR(500) NULL,
    `plain_software_password`  TEXT NULL,
    `role`                     ENUM('admin','user') NOT NULL DEFAULT 'admin',
    `shift_start`              TIME NULL,
    `shift_end`                TIME NULL,
    `blocked_pages`            JSON NULL,
    `security_questions`       JSON NULL,
    `recovery_attempts`        INT NOT NULL DEFAULT 0,
    `recovery_locked_until`    DATETIME NULL,
    `total_lockouts`           INT NOT NULL DEFAULT 0,
    `remember_token`           VARCHAR(100) NULL,
    `created_at`               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX `idx_users_email` (`email`),
    INDEX `idx_users_role`  (`role`)
);

-- ─── SESSIONS ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `sessions` (
    `id`          VARCHAR(128) NOT NULL PRIMARY KEY,
    `user_id`     INT UNSIGNED NULL,
    `ip_address`  VARCHAR(45)  NULL,
    `user_agent`  TEXT         NULL,
    `payload`     LONGTEXT     NOT NULL,
    `last_activity` INT        NOT NULL,
    `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX `idx_sessions_user_id`      (`user_id`),
    INDEX `idx_sessions_last_activity` (`last_activity`),
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);

-- ─── SUPPLIERS ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `suppliers` (
    `id`           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `name`         VARCHAR(255) NULL,
    `company`      VARCHAR(255) NULL,
    `address`      VARCHAR(255) NULL,
    `contact_info` VARCHAR(255) NULL,
    `deleted_at`   DATETIME NULL,
    `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX `idx_suppliers_name` (`name`)
);

-- ─── CATEGORIES ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS `categories` (
    `id`          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `name`        VARCHAR(255) NOT NULL,
    `description` TEXT NULL,
    `status`      TINYINT(1) NOT NULL DEFAULT 1,
    `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `deleted_at`   DATETIME NULL,
    `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ─── UNITS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `units` (
    `id`           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `name`         VARCHAR(50) NOT NULL UNIQUE,
    `display_name` VARCHAR(100) NOT NULL,
    `is_active`    TINYINT(1) NOT NULL DEFAULT 1,
    `is_default`   TINYINT(1) NOT NULL DEFAULT 0,
    `sort_order`   INT NOT NULL DEFAULT 0,
    `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT IGNORE INTO `units` (`name`, `display_name`, `is_active`, `is_default`, `sort_order`) VALUES
('pcs',   'Pieces',       1, 1, 1),
('dozen', 'Dozen',        1, 1, 2),
('meter', 'Meter',        1, 1, 3),
('feet',  'Feet',         1, 1, 4),
('liter', 'Liter',        1, 1, 5),
('ml',    'Milliliter',   1, 1, 6),
('gallon','Gallon',       1, 1, 7),
('bag',   'Bag',          1, 1, 8),
('kg',    'Kilogram',     1, 1, 9),
('ton',   'Ton',          1, 1, 10),
('roll',  'Roll',         1, 1, 11),
('sq.ft', 'Square Feet',  1, 1, 12),
('sq.m',  'Square Meter', 1, 1, 13),
('tube',  'Tube',         1, 1, 14),
('set',   'Set',          1, 1, 15),
('srv',   'Service',      1, 1, 16);

-- ─── PURCHASES ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `purchases` (
    `id`                       INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `type`                     ENUM('product', 'service', 'medicine') NOT NULL DEFAULT 'product',
    `product_name`             VARCHAR(255) NOT NULL,
    `barcode`                  VARCHAR(255) UNIQUE NULL,
    `qr_code`                  VARCHAR(500) UNIQUE NULL,
    `product_code`             VARCHAR(20) UNIQUE NULL,
    `image`                    VARCHAR(255) NULL,
    `purchased_price`          DECIMAL(10,2) NOT NULL,
    `sold_price`               DECIMAL(10,2) NULL DEFAULT 0,
    `fix_sold_price`           TINYINT(1) NOT NULL DEFAULT 0,
    `previous_sold_price`      DECIMAL(10,2) NULL,
    `quantity`                 DECIMAL(10,2) NOT NULL,
    `unit`                     VARCHAR(50) NOT NULL DEFAULT 'pcs',
    `sold_quantity`            INT NOT NULL DEFAULT 0,
    `low_inventory`            INT NULL,
    `purchase_date`            DATE NOT NULL,
    `expiry_date`              DATE NULL,
    `tax_type`                 VARCHAR(50) NOT NULL DEFAULT 'amount',
    `tax`                      DECIMAL(10,2) NOT NULL DEFAULT 0,
    `fix_tax`                  TINYINT(1) NOT NULL DEFAULT 0,
    `discount_type`            VARCHAR(50) NOT NULL DEFAULT 'amount',
    `discount`                 DECIMAL(10,2) NOT NULL DEFAULT 0,
    `fix_discount`             TINYINT(1) NOT NULL DEFAULT 0,
    -- Medicine fields (stored but not used in backend logic)
    `boxes`                    INT NULL,
    `strips_per_box`           INT NULL,
    `tablets_per_strip`        INT NULL,
    `opening_stock_deduction`  INT NOT NULL DEFAULT 0,
    `box_purchased_price`      DECIMAL(10,2) NULL,
    `supplier_id`              INT UNSIGNED NULL,
    `category_id`              INT UNSIGNED NULL,
    `deleted_at`               DATETIME NULL,
    `created_at`               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE CASCADE,
    FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE SET NULL,

    INDEX `idx_purchases_product_name`  (`product_name`),
    INDEX `idx_purchases_barcode`       (`barcode`),
    INDEX `idx_purchases_product_code`  (`product_code`),
    INDEX `idx_purchases_sold_price`    (`sold_price`),
    INDEX `idx_purchases_supplier_id`   (`supplier_id`),
    INDEX `idx_purchases_category_id`   (`category_id`),
    INDEX `idx_purchases_purchase_date` (`purchase_date`)
);

-- ─── DEFAULT CATEGORIES ───────────────────────────────
INSERT IGNORE INTO `categories` (`name`, `description`, `status`) VALUES
('Misc',     'Default miscellaneous category', 1),
('Services', 'Default services category',      1);



-- ─── EXPENSES ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `expenses` (
    `id`          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `category`    VARCHAR(255) NOT NULL,
    `description` VARCHAR(255) NULL,
    `amount`      DECIMAL(12,2) NOT NULL,
    `date`        DATE NOT NULL,
    `days`        INT NOT NULL DEFAULT 1,
    `deleted_at`  DATETIME NULL,
    `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX `idx_expenses_category` (`category`),
    INDEX `idx_expenses_date`     (`date`)
);

ALTER TABLE `expenses`
    ADD COLUMN `start_date` DATE NULL AFTER `date`,
    ADD COLUMN `end_date`   DATE NULL AFTER `start_date`;

-- ─── MANUAL NOTES ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS `manual_notes` (
    `id`              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `heading`         VARCHAR(255) NULL,
    `columns`         JSON NULL,
    `rows`            JSON NULL,
    `content_summary` TEXT NULL,
    `deleted_at`       DATETIME NULL,
    `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX `idx_manual_notes_heading` (`heading`),
    INDEX `idx_manual_notes_deleted_at` (`deleted_at`)
);

-- ─── LICENSES ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `licenses` (
    `id`               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `valid_days`       INT NOT NULL,
    `start_date`       DATE NOT NULL,
    `expiry_date`      DATE NOT NULL,
    `failed_attempts`  INT NOT NULL DEFAULT 0,
    `last_attempt_at`  DATETIME NULL,
    `last_renewed_at`  DATETIME NULL,
    `created_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `user_performance_logs` (
    `id`                      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `user_id`                 INT UNSIGNED NOT NULL,
    `login_time`              DATETIME NULL,
    `logout_time`             DATETIME NULL,
    `duty_minutes`            INT NOT NULL DEFAULT 0,
    `late_minutes`            INT NOT NULL DEFAULT 0,
    `early_minutes`           INT NOT NULL DEFAULT 0,
    `overtime_minutes`        INT NOT NULL DEFAULT 0,
    `early_departure_minutes` INT NOT NULL DEFAULT 0,
    `date`                    DATE NOT NULL,
    `created_at`              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
    INDEX `idx_perf_user_date` (`user_id`, `date`),
    INDEX `idx_perf_created_at` (`created_at`)
);

-- ─── CUSTOMERS ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `customers` (
    `id`               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `name`             VARCHAR(255) NOT NULL,
    `customer_type`    VARCHAR(255) NULL,
    `current_balance`  DECIMAL(15,2) NOT NULL DEFAULT 0,
    `advance_payment`  DECIMAL(15,2) NOT NULL DEFAULT 0,
    `shop_name`        VARCHAR(255) NULL,
    `city`             VARCHAR(255) NULL,
    `contact`          VARCHAR(255) NULL,
    `deleted_at`       DATETIME NULL,
    `created_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ─── INVOICE COUNTERS ─────────────────────────────────
CREATE TABLE IF NOT EXISTS `invoice_counters` (
    `id`          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `date`        VARCHAR(255) NOT NULL UNIQUE,
    `last_number` INT NOT NULL DEFAULT 0,
    `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ─── SALES ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `sales` (
    `id`               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `voucher_no`       VARCHAR(255) NOT NULL UNIQUE,
    `sale_date`        DATETIME NULL,
    `customer_id`      BIGINT UNSIGNED NULL,
    `seller_id`        INT UNSIGNED NULL,
    `payment_type`     ENUM('cash','credit','card','advance') NOT NULL,
    `subtotal`         DECIMAL(10,2) NOT NULL,
    `discount_type`    ENUM('amount','percentage') NOT NULL DEFAULT 'amount',
    `discount`         DECIMAL(10,2) NOT NULL DEFAULT 0,
    `discount_amount`  DECIMAL(10,2) NOT NULL DEFAULT 0,
    `tax_type`         ENUM('amount','percentage') NOT NULL DEFAULT 'amount',
    `tax`              DECIMAL(10,2) NOT NULL DEFAULT 0,
    `tax_amount`       DECIMAL(10,2) NOT NULL DEFAULT 0,
    `grand_total`      DECIMAL(10,2) NOT NULL,
    `received_amount`  DECIMAL(10,2) NOT NULL DEFAULT 0,
    `change_amount`    DECIMAL(10,2) NOT NULL DEFAULT 0,
    `remaining_balance` DECIMAL(10,2) NOT NULL DEFAULT 0,
    `due_date`         DATETIME NULL,
    `status`           VARCHAR(255) NOT NULL DEFAULT 'paid',
    `deleted_at`       DATETIME NULL,
    `created_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE CASCADE,
    FOREIGN KEY (`seller_id`)   REFERENCES `users`(`id`)     ON DELETE SET NULL,

    INDEX `idx_sales_voucher_no`              (`voucher_no`),
    INDEX `idx_sales_customer_id`             (`customer_id`),
    INDEX `idx_sales_payment_type`            (`payment_type`),
    INDEX `idx_sales_status`                  (`status`),
    INDEX `idx_sales_sale_date`               (`sale_date`),
    INDEX `idx_sales_created_at`              (`created_at`),
    INDEX `idx_sales_due_date`                (`due_date`),
    INDEX `idx_sales_deleted_at`              (`deleted_at`),
    INDEX `idx_sales_payment_type_status`     (`payment_type`, `status`),
    INDEX `idx_sales_created_at_payment_type` (`created_at`, `payment_type`)
);

ALTER TABLE `sales`
    ADD COLUMN `previous_balance_snapshot` DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER `remaining_balance`,
    ADD COLUMN `advance_deposit_amount`    DECIMAL(10,2) NULL AFTER `previous_balance_snapshot`;

ALTER TABLE `sales`
    ADD COLUMN `seller_name` VARCHAR(255) NULL AFTER `seller_id`;

CREATE TABLE IF NOT EXISTS `advance_deposits` (
    `id`                   BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `transaction_group_id` VARCHAR(255) NOT NULL,
    `customer_id`          BIGINT UNSIGNED NOT NULL,
    `amount_deposited`     DECIMAL(10,2) NOT NULL,
    `deleted_at`           DATETIME NULL,
    `created_at`           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE CASCADE,

    INDEX `idx_advance_deposits_group`    (`transaction_group_id`),
    INDEX `idx_advance_deposits_customer` (`customer_id`)
);

ALTER TABLE `sales` DROP COLUMN `advance_deposit_amount`;

-- ─── SALE ITEMS ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS `sale_items` (
    `id`                    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `sale_id`               BIGINT UNSIGNED NOT NULL,
    `purchase_id`           INT UNSIGNED NOT NULL,
    `quantity`              INT NOT NULL,
    `price`                 DECIMAL(10,2) NOT NULL,
    `discount_type`         ENUM('amount','percentage') NOT NULL DEFAULT 'amount',
    `discount_value`        DECIMAL(10,2) NOT NULL DEFAULT 0,
    `discount_amount`       DECIMAL(10,2) NOT NULL DEFAULT 0,
    `tax_type`              ENUM('amount','percentage') NOT NULL DEFAULT 'amount',
    `tax_value`             DECIMAL(10,2) NOT NULL DEFAULT 0,
    `tax_amount`            DECIMAL(10,2) NOT NULL DEFAULT 0,
    `total_after_tax`       DECIMAL(10,2) NOT NULL,
    `total`                 DECIMAL(10,2) NOT NULL,
    `total_after_discount`  DECIMAL(10,2) NOT NULL,
    `deleted_at`            DATETIME NULL,
    `created_at`            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (`sale_id`)     REFERENCES `sales`(`id`)     ON DELETE CASCADE,
    FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON DELETE CASCADE,

    INDEX `idx_sale_items_sale_id`              (`sale_id`),
    INDEX `idx_sale_items_purchase_id`          (`purchase_id`),
    INDEX `idx_sale_items_sale_id_purchase_id`  (`sale_id`, `purchase_id`)
);

ALTER TABLE `sale_items`
    ADD COLUMN `purchased_price` DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER `price`;

-- ─── PAYMENTS ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `payments` (
    `id`                   BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `sale_id`              BIGINT UNSIGNED NOT NULL,
    `amount`               DECIMAL(10,2) NOT NULL,
    `method`               VARCHAR(255) NOT NULL DEFAULT 'Cash',
    `payment_date`         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `transaction_group_id` VARCHAR(255) NULL,
    `deleted_at`           DATETIME NULL,
    `created_at`           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON DELETE CASCADE,

    INDEX `idx_payments_sale_id`              (`sale_id`),
    INDEX `idx_payments_payment_date`         (`payment_date`),
    INDEX `idx_payments_sale_id_payment_date` (`sale_id`, `payment_date`)
);

-- ─── SALE RETURNS ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS `sale_returns` (
    `id`                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `sale_id`             BIGINT UNSIGNED NOT NULL,
    `total_return_amount` DECIMAL(12,2) NOT NULL DEFAULT 0,
    `status`              ENUM('completed','pending') NOT NULL DEFAULT 'completed',
    `notes`               TEXT NULL,
    `deleted_at`          DATETIME NULL,
    `created_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON DELETE CASCADE,

    INDEX `idx_sale_returns_sale_id`            (`sale_id`),
    INDEX `idx_sale_returns_status`             (`status`),
    INDEX `idx_sale_returns_created_at`         (`created_at`),
    INDEX `idx_sale_returns_sale_id_created_at` (`sale_id`, `created_at`)
);

-- ─── SALE RETURN ITEMS ────────────────────────────────
CREATE TABLE IF NOT EXISTS `sale_return_items` (
    `id`                      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `sale_return_id`          BIGINT UNSIGNED NOT NULL,
    `sale_item_id`            BIGINT UNSIGNED NOT NULL,
    `purchase_id`             INT UNSIGNED NOT NULL,
    `quantity_returned`       INT NOT NULL,
    `unit_net_after_discount` DECIMAL(12,4) NOT NULL,
    `amount_refunded`         DECIMAL(12,2) NOT NULL,
    `deleted_at`              DATETIME NULL,
    `created_at`              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (`sale_return_id`) REFERENCES `sale_returns`(`id`) ON DELETE CASCADE,
    FOREIGN KEY (`sale_item_id`)   REFERENCES `sale_items`(`id`)   ON DELETE CASCADE,
    FOREIGN KEY (`purchase_id`)    REFERENCES `purchases`(`id`)    ON DELETE CASCADE,

    INDEX `idx_sri_sale_return_id`              (`sale_return_id`),
    INDEX `idx_sri_sale_item_id`               (`sale_item_id`),
    INDEX `idx_sri_purchase_id`                (`purchase_id`),
    INDEX `idx_sri_sale_item_id_sale_return_id` (`sale_item_id`, `sale_return_id`)
);

-- ─── CUSTOMER ADVANCE LOGS ────────────────────────────
CREATE TABLE IF NOT EXISTS `customer_advance_logs` (
    `id`               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `customer_id`      BIGINT UNSIGNED NOT NULL,
    `sale_id`          BIGINT UNSIGNED NULL,
    `previous_balance` DECIMAL(15,2) NOT NULL DEFAULT 0,
    `used_amount`      DECIMAL(15,2) NOT NULL DEFAULT 0,
    `remaining_balance` DECIMAL(15,2) NOT NULL DEFAULT 0,
    `is_new_advance`   TINYINT(1) NOT NULL DEFAULT 0,
    `deleted_at`        DATETIME NULL,
    `created_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE CASCADE,
    FOREIGN KEY (`sale_id`)     REFERENCES `sales`(`id`)     ON DELETE SET NULL
);

-- ─── CUSTOMER ADVANCE RETURN LOGS ────────────────────
CREATE TABLE IF NOT EXISTS `customer_advance_return_logs` (
    `id`                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `customer_id`       BIGINT UNSIGNED NOT NULL,
    `previous_balance`  DECIMAL(10,2) NOT NULL,
    `returned_amount`   DECIMAL(10,2) NOT NULL,
    `remaining_balance` DECIMAL(10,2) NOT NULL,
    `return_type`       VARCHAR(255) NOT NULL,
    `created_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE CASCADE
);



-- ─── CREDIT SALE REMINDERS ────────────────────────────
CREATE TABLE IF NOT EXISTS `credit_sale_reminders` (
    `id`                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `sale_id`           BIGINT UNSIGNED NOT NULL,
    `voucher_no`        VARCHAR(255) NOT NULL,
    `customer_name`     VARCHAR(255) NOT NULL,
    `contact`           VARCHAR(255) NULL,
    `remaining_balance` DECIMAL(15,2) NOT NULL,
    `reminder_datetime` DATETIME NOT NULL,
    `is_triggered`      TINYINT(1) NOT NULL DEFAULT 0,
    `deleted_at`        DATETIME NULL,
    `created_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON DELETE CASCADE,

    INDEX `idx_reminders_datetime_triggered` (`reminder_datetime`, `is_triggered`)
);

-- ─── TEMP RECEIPTS (replaces Laravel session for print data) ──
CREATE TABLE IF NOT EXISTS `temp_receipts` (
    `id`          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `receipt_id`  VARCHAR(255) NOT NULL UNIQUE,
    `data`        LONGTEXT NOT NULL,
    `deleted_at`  DATETIME NULL,
    `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX `idx_temp_receipts_receipt_id` (`receipt_id`),
    INDEX `idx_temp_receipts_created_at` (`created_at`)
);

-- ─── WALK-IN RETURN SESSIONS ──────────────────────────
CREATE TABLE IF NOT EXISTS `walk_in_return_sessions` (
    `id`                        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `batch_no`                  VARCHAR(255) NOT NULL UNIQUE,
    `total_subtotal`            DECIMAL(12,2) NOT NULL DEFAULT 0,
    `discount_type`             VARCHAR(255) NULL,
    `discount_value`            DECIMAL(12,4) NOT NULL DEFAULT 0,
    `sale_discount_amount`      DECIMAL(12,2) NOT NULL DEFAULT 0,
    `tax_type`                  VARCHAR(255) NULL,
    `tax_value`                 DECIMAL(12,4) NOT NULL DEFAULT 0,
    `sale_tax_amount`           DECIMAL(12,2) NOT NULL DEFAULT 0,
    `total_discount_amount`     DECIMAL(12,2) NOT NULL DEFAULT 0,
    `total_tax_amount`          DECIMAL(12,2) NOT NULL DEFAULT 0,
    `total_refund_amount`       DECIMAL(12,2) NOT NULL DEFAULT 0,
    `total_revenue_without_tax` DECIMAL(12,2) NOT NULL DEFAULT 0,
    `total_profit_without_tax`  DECIMAL(12,2) NOT NULL DEFAULT 0,
    `notes`                     TEXT NULL,
    `status`                    ENUM('completed','pending') NOT NULL DEFAULT 'completed',
    `customer_name`             VARCHAR(255) NULL,
    `customer_city`             VARCHAR(255) NULL,
    `shop_name`                 VARCHAR(255) NULL,
    `contact_no`                VARCHAR(255) NULL,
    `deleted_at`                DATETIME NULL,
    `created_at`                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX `idx_wirs_batch_no`    (`batch_no`),
    INDEX `idx_wirs_created_at`  (`created_at`),
    INDEX `idx_wirs_status`      (`status`)
);

-- ─── WALK-IN RETURNS ──────────────────────────────────
CREATE TABLE IF NOT EXISTS `walk_in_returns` (
    `id`                    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `session_id`            BIGINT UNSIGNED NOT NULL,
    `purchase_id`           INT UNSIGNED NOT NULL,
    `quantity_returned`     INT NOT NULL,
    `unit_price`            DECIMAL(12,4) NOT NULL,
    `discount_type`         VARCHAR(255) NULL,
    `discount_value`        DECIMAL(12,4) NOT NULL DEFAULT 0,
    `discount_amount`       DECIMAL(12,4) NOT NULL DEFAULT 0,
    `tax_type`              VARCHAR(255) NULL,
    `tax_value`             DECIMAL(12,4) NOT NULL DEFAULT 0,
    `tax_amount`            DECIMAL(12,4) NOT NULL DEFAULT 0,
    `subtotal`              DECIMAL(12,2) NOT NULL,
    `total_after_discount`  DECIMAL(12,2) NOT NULL,
    `total_after_tax`       DECIMAL(12,2) NOT NULL,
    `refund_amount`         DECIMAL(12,2) NOT NULL,
    `revenue_without_tax`   DECIMAL(12,2) NOT NULL DEFAULT 0,
    `profit_without_tax`    DECIMAL(12,2) NOT NULL DEFAULT 0,
    `deleted_at`            DATETIME NULL,
    `created_at`            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (`session_id`)  REFERENCES `walk_in_return_sessions`(`id`) ON DELETE CASCADE,
    FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`)               ON DELETE CASCADE,

    INDEX `idx_wir_session_id`              (`session_id`),
    INDEX `idx_wir_purchase_id`             (`purchase_id`),
    INDEX `idx_wir_session_id_purchase_id`  (`session_id`, `purchase_id`)
);


-- alter sale return tables

ALTER TABLE `sale_returns`
    DROP FOREIGN KEY `sale_returns_ibfk_1`;
ALTER TABLE `sale_returns`
    MODIFY `sale_id` BIGINT UNSIGNED NULL,
    ADD COLUMN `voucher_no` VARCHAR(255) NULL AFTER `sale_id`;
ALTER TABLE `sale_returns`
    ADD CONSTRAINT `sale_returns_sale_id_fk`
    FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON DELETE SET NULL;

ALTER TABLE `sale_return_items`
    DROP FOREIGN KEY `sale_return_items_ibfk_2`;
ALTER TABLE `sale_return_items`
    MODIFY `sale_item_id` BIGINT UNSIGNED NULL,
    ADD COLUMN `product_name` VARCHAR(255) NULL AFTER `purchase_id`;
ALTER TABLE `sale_return_items`
    ADD CONSTRAINT `sale_return_items_sale_item_id_fk`
    FOREIGN KEY (`sale_item_id`) REFERENCES `sale_items`(`id`) ON DELETE SET NULL;


ALTER TABLE `sale_returns`
    ADD COLUMN `customer_id` BIGINT UNSIGNED NULL AFTER `voucher_no`;

ALTER TABLE `sale_returns`
    ADD CONSTRAINT `sale_returns_customer_id_fk`
    FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE CASCADE;

ALTER TABLE `sale_returns`
    ADD INDEX `idx_sale_returns_customer_id` (`customer_id`);


ALTER TABLE `sale_returns`
    ADD COLUMN `original_subtotal`         DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `voucher_no`,
    ADD COLUMN `updated_subtotal`          DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `original_subtotal`,

    ADD COLUMN `discount_type`             VARCHAR(255) NULL AFTER `updated_subtotal`,
    ADD COLUMN `original_discount_value`   DECIMAL(12,4) NOT NULL DEFAULT 0 AFTER `discount_type`,
    ADD COLUMN `original_discount_amount`  DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `original_discount_value`,
    ADD COLUMN `updated_discount_value`    DECIMAL(12,4) NOT NULL DEFAULT 0 AFTER `original_discount_amount`,
    ADD COLUMN `updated_discount_amount`   DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `updated_discount_value`,

    ADD COLUMN `tax_type`                  VARCHAR(255) NULL AFTER `updated_discount_amount`,
    ADD COLUMN `original_tax_value`        DECIMAL(12,4) NOT NULL DEFAULT 0 AFTER `tax_type`,
    ADD COLUMN `original_tax_amount`       DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `original_tax_value`,
    ADD COLUMN `updated_tax_value`         DECIMAL(12,4) NOT NULL DEFAULT 0 AFTER `original_tax_amount`,
    ADD COLUMN `updated_tax_amount`        DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `updated_tax_value`,

    ADD COLUMN `original_received_amount`  DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `updated_tax_amount`,
    ADD COLUMN `updated_received_amount`   DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `original_received_amount`,

    ADD COLUMN `original_change_amount`    DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `updated_received_amount`,
    ADD COLUMN `updated_change_amount`     DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `original_change_amount`,

    ADD COLUMN `original_grand_total`      DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `updated_change_amount`,
    ADD COLUMN `updated_grand_total`       DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `original_grand_total`;

ALTER TABLE `sale_returns`
    ADD COLUMN `total_tax` DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `total_return_amount`;


ALTER TABLE `sale_return_items`
    ADD COLUMN `original_quantity`        INT NOT NULL DEFAULT 0 AFTER `product_name`,
    ADD COLUMN `discount_type`            VARCHAR(255) NULL AFTER `original_quantity`,
    ADD COLUMN `original_discount_value`  DECIMAL(12,4) NOT NULL DEFAULT 0 AFTER `discount_type`,
    ADD COLUMN `original_discount_amount` DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `original_discount_value`,

    ADD COLUMN `tax_type`                 VARCHAR(255) NULL AFTER `original_discount_amount`,
    ADD COLUMN `original_tax_value`       DECIMAL(12,4) NOT NULL DEFAULT 0 AFTER `tax_type`,
    ADD COLUMN `original_tax_amount`      DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `original_tax_value`;

ALTER TABLE `sale_returns`
    ADD COLUMN `payment_type` VARCHAR(50) NULL AFTER `customer_id`,
    ADD COLUMN `sale_date`    DATETIME NULL AFTER `payment_type`;

ALTER TABLE `sale_return_items`
    ADD COLUMN `price` DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER `product_name`;

ALTER TABLE `sale_return_items`
    ADD COLUMN `purchased_price` DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER `price`;

ALTER TABLE `sale_returns`
    ADD COLUMN `user_id` INT UNSIGNED NULL AFTER `sale_id`,
    ADD CONSTRAINT `sale_returns_user_id_fk`
        FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,
    ADD INDEX `idx_sale_returns_user_id` (`user_id`);

ALTER TABLE `walk_in_return_sessions`
    ADD COLUMN `user_id` INT UNSIGNED NULL AFTER `batch_no`,
    ADD CONSTRAINT `walk_in_return_sessions_user_id_fk`
        FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,
    ADD INDEX `idx_wirs_user_id` (`user_id`);

ALTER TABLE `sale_returns`
    ADD COLUMN `seller_name` VARCHAR(255) NULL AFTER `user_id`;

ALTER TABLE `walk_in_return_sessions`
    ADD COLUMN `seller_name` VARCHAR(255) NULL AFTER `user_id`;

-- ─────────────────────────────────────────────────────
-- RECEIPT SETTINGS
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `receipt_settings` (
    `id`                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `paper_size`         ENUM('80mm','A4','A5') NOT NULL DEFAULT '80mm',
    `design_type`        ENUM('design1','design2','design3') NOT NULL DEFAULT 'design1',
    `language`           VARCHAR(20) NOT NULL DEFAULT 'en',
    `show_signature`     TINYINT(1) NOT NULL DEFAULT 1,
    `show_stamp`         TINYINT(1) NOT NULL DEFAULT 1,
    `show_paid_overlay`  TINYINT(1) NOT NULL DEFAULT 1,
    `created_at`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT IGNORE INTO `receipt_settings`
    (`id`, `paper_size`, `design_type`, `language`, `show_signature`, `show_stamp`, `show_paid_overlay`)
VALUES
    (1, '80mm', 'design1', 'en', 1, 1, 1);

-- ─────────────────────────────────────────────────────
-- APP SETTINGS
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `app_settings` (
    `id`                        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `default_low_inventory`     INT NOT NULL DEFAULT 2,
    `enable_default_discount`   TINYINT(1) NOT NULL DEFAULT 0,
    `default_discount_type`     VARCHAR(50) NOT NULL DEFAULT 'amount',
    `default_discount_value`    DECIMAL(10,2) NOT NULL DEFAULT 0,
    `enable_default_tax`        TINYINT(1) NOT NULL DEFAULT 0,
    `default_tax_type`          VARCHAR(50) NOT NULL DEFAULT 'amount',
    `default_tax_value`         DECIMAL(10,2) NOT NULL DEFAULT 0,
    `auto_delete_period`        VARCHAR(50) NOT NULL DEFAULT 'never',
    `created_at`                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT IGNORE INTO `app_settings`
    (`id`, `default_low_inventory`)
VALUES
    (1, 2);

-- ─────────────────────────────────────────────────────
-- CURRENCY SETTINGS
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `currency_settings` (
    `id`                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `currency_symbol`    VARCHAR(10) NOT NULL DEFAULT 'Rs',
    `currency_position`  VARCHAR(10) NOT NULL DEFAULT 'before',
    `currency_locale`    VARCHAR(10) NOT NULL DEFAULT 'en-PK',
    `created_at`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT IGNORE INTO `currency_settings`
    (`id`, `currency_symbol`, `currency_position`, `currency_locale`)
VALUES
    (1, 'Rs', 'before', 'en-PK');

-- ─────────────────────────────────────────────────────
-- RECEIPT TRANSLATIONS
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `receipt_translations` (
    `id`               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `key`              VARCHAR(255) NOT NULL,
    `language`         VARCHAR(10) NOT NULL,
    `translated_value` VARCHAR(255) NOT NULL,
    `created_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY `uk_receipt_translations_key_language` (`key`, `language`)
);

-- ─────────────────────────────────────────────────────
-- USER ACTIVITY LOGS
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `user_activity_logs` (
    `id`                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `user_id`             INT UNSIGNED NULL,
    `action_type`         VARCHAR(255) NOT NULL,
    `action_description`  TEXT NOT NULL,
    `entity_type`         VARCHAR(255) NOT NULL,
    `entity_id`           BIGINT UNSIGNED NULL,
    `old_data`            JSON NULL,
    `new_data`            JSON NULL,
    `is_read`             TINYINT(1) NOT NULL DEFAULT 0,
    `created_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,

    INDEX `idx_user_activity_logs_user_id_is_read` (`user_id`, `is_read`),
    INDEX `idx_user_activity_logs_created_at`      (`created_at`)
);

ALTER TABLE `user_activity_logs`
    ADD COLUMN `user_name` VARCHAR(255) NULL AFTER `user_id`;

-- Add this anywhere near the other CREATE TABLE statements:
CREATE TABLE IF NOT EXISTS `pending_sale_edits` (
    `id`                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `original_voucher_no` VARCHAR(255) NOT NULL UNIQUE,
    `user_id`             INT UNSIGNED NULL,
    `old_data`            JSON NOT NULL,
    `created_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX `idx_pending_sale_edits_voucher` (`original_voucher_no`)
);

-- ─────────────────────────────────────────────────────
-- BANK ACCOUNTS
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bank_accounts` (
    `id`              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `bank_name`       VARCHAR(100) NOT NULL,      -- JazzCash, EasyPaisa, MCB Bank, HBL Bank, etc.
    `account_title`   VARCHAR(255) NULL,
    `account_number`  VARCHAR(100) NULL,
    `branch_name`     VARCHAR(255) NULL,
       `balance`         DECIMAL(15,2) NOT NULL DEFAULT 0,
    `status`          TINYINT(1) NOT NULL DEFAULT 1,
    `deleted_at`      DATETIME NULL,
    `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX `idx_bank_accounts_bank_name` (`bank_name`),
    INDEX `idx_bank_accounts_status`    (`status`)
);

-- Link a card-payment to the specific account it landed in
ALTER TABLE `payments`
    ADD COLUMN `bank_account_id` INT UNSIGNED NULL AFTER `method`,
    ADD CONSTRAINT `payments_bank_account_id_fk`
        FOREIGN KEY (`bank_account_id`) REFERENCES `bank_accounts`(`id`) ON DELETE SET NULL,
    ADD INDEX `idx_payments_bank_account_id` (`bank_account_id`);