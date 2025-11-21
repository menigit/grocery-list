// Vercel Serverless API for Vouchers Management with Neon PostgreSQL
const { Pool } = require('pg');

// Neon Database Connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Helper function to handle CORS
const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

// Main handler
module.exports = async (req, res) => {
    setCorsHeaders(res);
    
    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const { method, query, body } = req;
        const { id, action } = query;

        // GET /api/vouchers - Get all vouchers
        if (method === 'GET' && !id) {
            const vouchersQuery = `
                SELECT id, name, initial_value, code, description, is_redeemed, 
                       created_at, updated_at
                FROM vouchers
                ORDER BY name
            `;
            const vouchersResult = await pool.query(vouchersQuery);
            
            const redemptionsQuery = `
                SELECT id, voucher_id, amount, date, created_at
                FROM redemptions
                ORDER BY voucher_id, created_at DESC
            `;
            const redemptionsResult = await pool.query(redemptionsQuery);
            
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
            
            const vouchers = vouchersResult.rows.map(v => ({
                id: parseInt(v.id),
                name: v.name,
                initialValue: parseFloat(v.initial_value),
                code: v.code || '',
                description: v.description || '',
                redemptions: redemptionsMap[v.id] || [],
                isRedeemed: v.is_redeemed
            }));
            
            return res.status(200).json(vouchers);
        }

        // POST /api/vouchers - Create new voucher
        if (method === 'POST' && !id && !action) {
            const { id: voucherId, name, initialValue, code, description, redemptions, isRedeemed } = body;
            
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                
                const voucherQuery = `
                    INSERT INTO vouchers (id, name, initial_value, code, description, is_redeemed)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    RETURNING *
                `;
                const voucherResult = await client.query(voucherQuery, [
                    voucherId, name, initialValue, code || null, description || null, isRedeemed || false
                ]);
                
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
                return res.status(200).json({ 
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
                throw error;
            } finally {
                client.release();
            }
        }

        // PUT /api/vouchers?id=123 - Update voucher
        if (method === 'PUT' && id) {
            const { name, initialValue, code, description, redemptions, isRedeemed } = body;
            
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                
                const voucherQuery = `
                    UPDATE vouchers 
                    SET name = $1, initial_value = $2, code = $3, 
                        description = $4, is_redeemed = $5
                    WHERE id = $6
                    RETURNING *
                `;
                const voucherResult = await client.query(voucherQuery, [
                    name, initialValue, code || null, description || null, 
                    isRedeemed || false, id
                ]);
                
                if (voucherResult.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return res.status(404).json({ error: 'שובר לא נמצא' });
                }
                
                await client.query('DELETE FROM redemptions WHERE voucher_id = $1', [id]);
                
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
                return res.status(200).json({ 
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
                throw error;
            } finally {
                client.release();
            }
        }

        // DELETE /api/vouchers?id=123 - Delete voucher
        if (method === 'DELETE' && id) {
            const result = await pool.query(
                'DELETE FROM vouchers WHERE id = $1 RETURNING id',
                [id]
            );
            
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'שובר לא נמצא' });
            }
            
            return res.status(200).json({ success: true });
        }

        // DELETE /api/vouchers?action=deleteAll - Delete all vouchers
        if (method === 'DELETE' && action === 'deleteAll') {
            await pool.query('DELETE FROM vouchers');
            return res.status(200).json({ success: true });
        }

        // POST /api/vouchers?action=import - Import vouchers
        if (method === 'POST' && action === 'import') {
            const vouchers = body;
            
            if (!Array.isArray(vouchers)) {
                return res.status(400).json({ error: 'נתונים לא תקינים' });
            }
            
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                
                await client.query('DELETE FROM vouchers');
                
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
                return res.status(200).json({ success: true, count: vouchers.length });
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        }

        return res.status(404).json({ error: 'Not found' });
        
    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ error: error.message || 'שגיאה בשרת' });
    }
};