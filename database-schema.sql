-- Neon PostgreSQL Schema for Vouchers Management System

-- Create vouchers table
CREATE TABLE IF NOT EXISTS vouchers (
    id BIGINT PRIMARY KEY,
    name TEXT NOT NULL,
    initial_value DECIMAL(10,2) NOT NULL,
    code TEXT,
    description TEXT,
    is_redeemed BOOLEAN DEFAULT FALSE
);

-- Create redemptions table
CREATE TABLE IF NOT EXISTS redemptions (
    id SERIAL PRIMARY KEY,
    voucher_id BIGINT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    date TEXT NOT NULL,
    CONSTRAINT fk_voucher
        FOREIGN KEY (voucher_id)
        REFERENCES vouchers(id)
        ON DELETE CASCADE
);
