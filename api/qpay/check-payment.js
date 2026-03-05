const axios = require('axios');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Зөвхөн POST хүсэлт зөвшөөрөгдөнө' });
    }

    try {
        const { invoice_id } = req.body;
        if (!invoice_id) {
            return res.status(400).json({ error: 'invoice_id явуулаагүй байна' });
        }

        // 1. TOKEN АВАХ
        const auth = Buffer.from(`${process.env.QPAY_USERNAME}:${process.env.QPAY_PASSWORD}`).toString('base64');
        const tokenRes = await axios.post('https://quickqr.qpay.mn/v2/auth/token', 
            { terminal_id: 'DALATECH_AI' }, 
            { headers: { 'Authorization': `Basic ${auth}` } }
        );
        const token = tokenRes.data.access_token;

        // 2. ТӨЛБӨР ШАЛГАХ (QPay рүү хандах)
        const checkRes = await axios.post('https://quickqr.qpay.mn/v2/payment/check', 
            { invoice_id: invoice_id },
            { headers: { 'Authorization': `Bearer ${token}` } }
        );

        // QPay-ийн хариуг буцаах (PAID эсвэл OPEN гэсэн төлөв ирнэ)
        return res.status(200).json(checkRes.data);

    } catch (error) {
        console.error("ТӨЛБӨР ШАЛГАХ АЛДАА:", error.response?.data || error.message);
        return res.status(500).json({ error: 'Төлбөр шалгахад алдаа гарлаа' });
    }
}
