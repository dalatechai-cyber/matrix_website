const axios = require('axios');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Зөвхөн POST хүсэлт зөвшөөрөгдөнө' });
    }

    try {
        console.log("1. API ROUTE АЖИЛЛАЖ ЭХЭЛЛЭЭ!");

        const terminalId = 'DALATECH_AI';
        
        // 1. TOKEN АВАХ
        const auth = Buffer.from(`${process.env.QPAY_USERNAME}:${process.env.QPAY_PASSWORD}`).toString('base64');
        const tokenRes = await axios.post('https://quickqr.qpay.mn/v2/auth/token', 
            { terminal_id: terminalId }, 
            { headers: { 'Authorization': `Basic ${auth}` } }
        );
        const token = tokenRes.data.access_token;
        console.log("2. TOKEN АМЖИЛТТАЙ АВЛАА!");

        // 2. PAYLOAD БЭЛДЭХ (Шинэ талбар нэмэгдсэн)
        const payload = {
            merchant_id: "17e69f2a-d1a4-4fe6-a5a2-34a649378414", // Жишээ нь: "87ec2243-bc4d..." гэх мэт
            invoice_receiver_code: terminalId, // <-- ЭНЭ ДУТУУ БАЙСНААС АЛДАА ГАРЧЭЭ!
            amount: 100, 
            currency: 'MNT',
            description: 'Matrix Salon Test',
            mcc_code: '7230'
        };

        console.log("3. QPAY-РҮҮ ИЛГЭЭЖ БУЙ МЭДЭЭЛЭЛ:", payload);

        // 3. INVOICE ҮҮСГЭХ
        const invoiceRes = await axios.post('https://quickqr.qpay.mn/v2/invoice', 
            payload,
            { headers: { 'Authorization': `Bearer ${token}` } }
        );

        console.log("4. QR КОД АМЖИЛТТАЙ ҮҮСЛЭЭ!");
        return res.status(200).json(invoiceRes.data);

    } catch (error) {
        console.error("API ROUTE АЛДАА:", error.response?.data || error.message);
        return res.status(500).json({ 
            error: 'Failed to create QPay invoice', 
            details: error.response?.data || error.message 
        });
    }
}
