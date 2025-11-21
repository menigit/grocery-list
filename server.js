
// Backend API Server for Vouchers Management with Neon PostgreSQL
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve HTML file from public folder

// Neon Database Connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Test database connection
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('❌ Database connection error:', err);
    } else {
        console.log('✅ Connected to Neon PostgreSQL:', res.rows[0].now);
    }
});

// ==================== API ENDPOINTS ====================

// Get all vouchers with their redemptions
app.get('/api/vouchers', async (req, res) => {
    try {
        const vouchersQuery = `
            SELECT id, name, initial_value, code, description, is_redeemed
            FROM vouchers
            ORDER BY name
        `;
        const vouchersResult = await pool.query(vouchersQuery);
        
        const redemptionsQuery = `
            SELECT id, voucher_id, amount, date
            FROM redemptions
            ORDER BY voucher_id, date DESC
        `;
        const redemptionsResult = await pool.query(redemptionsQuery);
        
        // Group redemptions by voucher_id
        const redemptionsMap = {};
        redemptionsResult.rows.forEach(redemption => {
            if (!redemptionsMap[redemption.voucher_id]) {
                redemptionsMap[redemption.voucher_id] = [];
            }
            redemptionsMap[redemption.voucher_id].push({
                id: redemption.id,
                amount: parseFloat(redemption.amount),
                date: redemption.date
            });
        });
        
        // Combine vouchers with their redemptions
        const vouchers = vouchersResult.rows.map(v => ({
            id: parseInt(v.id),
            name: v.name,
            initialValue: parseFloat(v.initial_value),
            code: v.code || '',
            description: v.description || '',
            redemptions: redemptionsMap[v.id] || [],
            isRedeemed: v.is_redeemed
        }));
        
        res.json(vouchers);
    } catch (error) {
        console.error('Error fetching vouchers:', error);
        res.status(500).json({ error: 'שגיאה בטעינת השוברים' });
    }
});

// Create new voucher
app.post('/api/vouchers', async (req, res) => {
    const { id, name, initialValue, code, description, redemptions, isRedeemed } = req.body;
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Insert voucher
        const voucherQuery = `
            INSERT INTO vouchers (id, name, initial_value, code, description, is_redeemed)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `;
        const voucherResult = await client.query(voucherQuery, [
            id, name, initialValue, code || null, description || null, isRedeemed || false
        ]);
        
        // Insert redemptions if any
        if (redemptions && redemptions.length > 0) {
            const redemptionQuery = `
                INSERT INTO redemptions (voucher_id, amount, date)
                VALUES ($1, $2, $3)
            `;
            for (const redemption of redemptions) {
                await client.query(redemptionQuery, [
                    id, redemption.amount, redemption.date
                ]);
            }
        }
        
        await client.query('COMMIT');
        res.json({ 
            success: true, 
            voucher: {
                id: parseInt(voucherResult.rows[0].id),
                name: voucherResult.rows[0].name,
                initialValue: parseFloat(voucherResult.rows[0].initial_value),
                code: voucherResult.rows[0].code || '',
                description: voucherResult.rows[0].description || '',
                redemptions: redemptions || [],
                isRedeemed: voucherResult.rows[0].is_redeemed
            }
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error creating voucher:', error);
        res.status(500).json({ error: 'שגיאה ביצירת השובר' });
    } finally {
        client.release();
    }
});

// Update voucher
app.put('/api/vouchers/:id', async (req, res) => {
    const voucherId = req.params.id;
    const { name, initialValue, code, description, redemptions, isRedeemed } = req.body;
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Update voucher
        const voucherQuery = `
            UPDATE vouchers 
            SET name = $1, initial_value = $2, code = $3, 
                description = $4, is_redeemed = $5
            WHERE id = $6
            RETURNING *
        `;
        const voucherResult = await client.query(voucherQuery, [
            name, initialValue, code || null, description || null, 
            isRedeemed || false, voucherId
        ]);
        
        if (voucherResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'שובר לא נמצא' });
        }
        
        // Delete all existing redemptions
        await client.query('DELETE FROM redemptions WHERE voucher_id = $1', [voucherId]);
        
        // Insert new redemptions
        if (redemptions && redemptions.length > 0) {
            const redemptionQuery = `
                INSERT INTO redemptions (voucher_id, amount, date)
                VALUES ($1, $2, $3)
            `;
            for (const redemption of redemptions) {
                await client.query(redemptionQuery, [
                    voucherId, redemption.amount, redemption.date
                ]);
            }
        }
        
        await client.query('COMMIT');
        res.json({ 
            success: true,
            voucher: {
                id: parseInt(voucherResult.rows[0].id),
                name: voucherResult.rows[0].name,
                initialValue: parseFloat(voucherResult.rows[0].initial_value),
                code: voucherResult.rows[0].code || '',
                description: voucherResult.rows[0].description || '',
                redemptions: redemptions || [],
                isRedeemed: voucherResult.rows[0].is_redeemed
            }
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error updating voucher:', error);
        res.status(500).json({ error: 'שגיאה בעדכון השובר' });
    } finally {
        client.release();
    }
});

// Delete voucher
app.delete('/api/vouchers/:id', async (req, res) => {
    const voucherId = req.params.id;
    
    try {
        const result = await pool.query(
            'DELETE FROM vouchers WHERE id = $1 RETURNING id',
            [voucherId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'שובר לא נמצא' });
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting voucher:', error);
        res.status(500).json({ error: 'שגיאה במחיקת השובר' });
    }
});

// Delete all vouchers
app.delete('/api/vouchers', async (req, res) => {
    try {
        await pool.query('DELETE FROM vouchers');
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting all vouchers:', error);
        res.status(500).json({ error: 'שגיאה במחיקת כל השוברים' });
    }
});

// Import vouchers (bulk insert)
app.post('/api/vouchers/import', async (req, res) => {
    const vouchers = req.body;
    
    if (!Array.isArray(vouchers)) {
        return res.status(400).json({ error: 'נתונים לא תקינים' });
    }
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Delete all existing data
        await client.query('DELETE FROM vouchers');
        
        // Insert all vouchers
        for (const voucher of vouchers) {
            const voucherQuery = `
                INSERT INTO vouchers (id, name, initial_value, code, description, is_redeemed)
                VALUES ($1, $2, $3, $4, $5, $6)
            `;
            await client.query(voucherQuery, [
                voucher.id, voucher.name, voucher.initialValue, 
                voucher.code || null, voucher.description || null, 
                voucher.isRedeemed || false
            ]);
            
            // Insert redemptions
            if (voucher.redemptions && voucher.redemptions.length > 0) {
                const redemptionQuery = `
                    INSERT INTO redemptions (voucher_id, amount, date)
                    VALUES ($1, $2, $3)
                `;
                for (const redemption of voucher.redemptions) {
                    await client.query(redemptionQuery, [
                        voucher.id, redemption.amount, redemption.date
                    ]);
                }
            }
        }
        
        await client.query('COMMIT');
        res.json({ success: true, count: vouchers.length });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error importing vouchers:', error);
        res.status(500).json({ error: 'שגיאה בייבוא השוברים' });
    } finally {
        client.release();
    }
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', database: 'connected' });
    } catch (error) {
        res.status(500).json({ status: 'error', database: 'disconnected' });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 API available at http://localhost:${PORT}/api`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    pool.end(() => {
        console.log('Database pool closed');
        process.exit(0);
    });
});