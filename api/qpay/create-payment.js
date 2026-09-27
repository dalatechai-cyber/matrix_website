const axios = require('axios');
const { checkPaymentRequest } = require('../../services/closureGuard');
const { checkPaymentBookingRules, consentTime, REFRESH_MESSAGE } = require('../../services/bookingRules');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Зөвхөн POST хүсэлт зөвшөөрөгдөнө' });
    }

    // --- 0. САЛОН АМАРЧ БАЙХ ӨДӨРТ ТӨЛБӨР ҮҮСГЭХГҮЙ ---
    // No invoice exists for an appointment inside a salon closure, so there is
    // no way to pay a deposit for a day the salon is shut. With no closure
    // configured this always passes and the handler behaves exactly as before.
    const closureCheck = checkPaymentRequest(req.body || {});
    if (!closureCheck.allowed) {
        console.warn('Blocked QPay invoice for closed salon date:', closureCheck.date, closureCheck.reason);
        return res.status(409).json({
            error: 'Salon is closed on the requested date',
            reason: closureCheck.reason,
            closure: closureCheck.closure,
        });
    }

    // --- 0б. ҮСЧНИЙ ХҮЙС, УРЬДЧИЛГААНЫ НӨХЦӨЛ ---
    // No invoice (and so no QR) unless the hairdresser matches the customer's
    // gender and the customer has agreed the deposit is non-refundable.
    // Shared with routes/qpay.js through services/bookingRules.js.
    const rulesCheck = checkPaymentBookingRules(req.body || {});
    if (!rulesCheck.allowed) {
        console.warn('Blocked QPay invoice by booking rules:', rulesCheck.reason, (req.body || {}).staffName);
        return res.status(422).json({ error: REFRESH_MESSAGE, reason: rulesCheck.reason });
    }

    try {
        // --- 1. ФРОНТЕНДООС ИРСЭН МЭДЭЭЛЛИЙГ ХҮЛЭЭЖ АВАХ ---
        const { amount, name, phone, staffName } = req.body;

        // "20,000 ₮" гэж ирсэн ч зөвхөн тоог нь ялгаж авах
        const cleanAmount = Number(String(amount).replace(/[^0-9.]/g, ''));
        const finalAmount = cleanAmount > 0 ? cleanAmount : 100; // Хэрэв алдаа гарвал 100₮-өөр хамгаална

        // Гүйлгээний утгад Нэр, Утсыг нь оруулах
        const finalDescription = `${name || 'Үйлчлүүлэгч'} - ${phone || 'Утасгүй'}`.substring(0, 255);

        // --- 1б. БАНКНЫ ДАНС (салоны нэг данс) ---
        const bankAccountsPayload = [{
            account_bank_code: "040000",
            account_number: "416055415",
            account_name: "Эрхэмбаатар Оюунсүрэн",
            is_default: true
        }];

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
            amount: finalAmount, // Бодит үнэ
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

        // Evidence for a later dispute, alongside the line written on the
        // calendar event: which invoice was created after the customer agreed.
        const consent = consentTime(req.body.depositTermsAcceptedAt);
        console.log('Deposit terms accepted:', JSON.stringify({
            invoice_id: invoiceRes.data && invoiceRes.data.invoice_id,
            staffName,
            customerGender: rulesCheck.customerGender,
            bookingDate: req.body.bookingDate,
            acceptedAt: consent.at.toISOString(),
            acceptedAtSource: consent.source,
        }));

        return res.status(200).json(invoiceRes.data);

    } catch (error) {
        console.error("API ROUTE АЛДАА:", error.response?.data || error.message);
        return res.status(500).json({ 
            error: 'Failed to create QPay invoice', 
            details: error.response?.data || error.message 
        });
    }
}
