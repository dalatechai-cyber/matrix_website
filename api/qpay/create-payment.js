const axios = require('axios');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Зөвхөн POST хүсэлт зөвшөөрөгдөнө' });
    }

    try {
        // --- 1. ФРОНТЕНДООС ИРСЭН МЭДЭЭЛЛИЙГ ХҮЛЭЭЖ АВАХ ---
        const { amount, name, phone, staffName } = req.body;

        // "20,000 ₮" гэж ирсэн ч зөвхөн тоог нь ялгаж авах
        const cleanAmount = Number(String(amount).replace(/[^0-9.]/g, ''));
        const finalAmount = cleanAmount > 0 ? cleanAmount : 100; // Хэрэв алдаа гарвал 100₮-өөр хамгаална

        // Гүйлгээний утгад Нэр, Утсыг нь оруулах
        const finalDescription = `${name || 'Үйлчлүүлэгч'} - ${phone || 'Утасгүй'}`.substring(0, 255);

        // --- 1б. БАНКНЫ ДАНСЫГ АЖИЛТНЫ НЭРЭЭР ТОДОРХОЙЛОХ ---
        let bankAccountsPayload;
        if (staffName && (staffName.includes('Мөнхзаяа') || staffName.includes('Маникюр'))) {
            bankAccountsPayload = [{
                account_bank_code: "050000",
                account_number: "5042384162",
                account_name: "Ганбат Мөнхзаяа",
                is_default: true
            }];
        } else {
            bankAccountsPayload = [{
                account_bank_code: "040000",
                account_number: "416055415",
                account_name: "Эрхэмбаатар Оюунсүрэн",
                is_default: true
            }];
        }

        // --- 2. TOKEN АВАХ ---
        const auth = Buffer.from(`${process.env.QPAY_USERNAME}:${process.env.QPAY_PASSWORD}`).toString('base64');
        const tokenRes = await axios.post('https://quickqr.qpay.mn/v2/auth/token', 
            { terminal_id: 'DALATECH_AI' }, 
            { headers: { 'Authorization': `Basic ${auth}` } }
        );
        const token = tokenRes.data.access_token;

        // --- 3. PAYLOAD БЭЛДЭХ ---
        const payload = {
            merchant_id: "17e69f2a-d1a4-4fe6-a5a2-34a649378414", // <-- Өөрийн 87ec2243... ID-гээ буцааж хийгээрэй
            amount: 100, // Бодит үнэ
            currency: 'MNT',
            description: finalDescription, // Бодит нэр, утас
            mcc_code: '7230',
            bank_accounts: bankAccountsPayload
        };

        // --- 4. INVOICE ҮҮСГЭХ ---
        const invoiceRes = await axios.post('https://quickqr.qpay.mn/v2/invoice', 
            payload,
            { headers: { 'Authorization': `Bearer ${token}` } }
        );

        return res.status(200).json(invoiceRes.data);

    } catch (error) {
        console.error("API ROUTE АЛДАА:", error.response?.data || error.message);
        return res.status(500).json({ 
            error: 'Failed to create QPay invoice', 
            details: error.response?.data || error.message 
        });
    }
}
