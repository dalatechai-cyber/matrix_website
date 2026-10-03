const axios = require('axios');
const { checkPaymentRequest } = require('../../services/closureGuard');
const { checkPaymentBookingRules, consentTime, REFRESH_MESSAGE } = require('../../services/bookingRules');
const { callbackUrlForPayment, publicOrigin } = require('../../services/lateBooking');
const { blockedByMaintenance, MAINTENANCE_MESSAGE, depositFor, isTestRequest } = require('../../config/siteMode');
const { resolveBookingBranch, qpayAccountFor } = require('../../config/branches');
const { holdForPaymentRequest } = require('../../services/bookingHold');

// The merchant Яармаг has always been invoiced under. Used for Яармаг only:
// another branch is invoiced under its own merchant (config/branches.js).
const YAARMAG_MERCHANT_ID = "17e69f2a-d1a4-4fe6-a5a2-34a649378414";
const BRANCH_NOT_READY_MESSAGE = 'Энэ салбарт онлайн захиалга хараахан нээгдээгүй байна. Салбарын утсаар холбогдоно уу.';

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Зөвхөн POST хүсэлт зөвшөөрөгдөнө' });
    }

    // --- 0а. ЗАСВАРТАЙ ҮЕД ШИНЭ ТӨЛБӨР ҮҮСГЭХГҮЙ ---
    // SITE_MAINTENANCE=on: no new invoices. Payments already made are still
    // booked (check-payment, /api/calendar/book and the QPay callback stay open).
    if (blockedByMaintenance(req)) {
        return res.status(503).json({ error: MAINTENANCE_MESSAGE, maintenance: true });
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

    // --- 0в. САЛБАР ---
    // The hairdresser decides the branch, and the branch decides the QPay
    // account. A page naming another branch, or a branch not yet connected,
    // gets no invoice — never one on another branch's account.
    const branchCheck = resolveBookingBranch({ stylistId: (req.body || {}).staffName, branch: (req.body || {}).branch });
    if (!branchCheck.ok) {
        console.warn('Blocked QPay invoice by branch:', branchCheck.reason, (req.body || {}).staffName);
        return res.status(409).json({ error: BRANCH_NOT_READY_MESSAGE, reason: branchCheck.reason });
    }
    const account = qpayAccountFor(branchCheck.branch);
    const merchantId = branchCheck.branch === 'yaarmag' ? YAARMAG_MERCHANT_ID : account.merchantId;

    // --- 0г. 5 МИНУТЫН ТҮР ХАДГАЛАЛТ ---
    // The time is held on the hairdresser's calendar before a QR exists, so
    // no other customer (website or Messenger) can reach a QR for it. Taken,
    // or the calendar cannot be read: no invoice. services/bookingHold.js.
    const hold = await holdForPaymentRequest(req.body || {}, { test: isTestRequest(req) });
    if (!hold.ok) {
        console.warn('Blocked QPay invoice by hold:', hold.payload.reason, (req.body || {}).staffName);
        return res.status(hold.status).json(hold.payload);
    }

    try {
        // --- 1. ФРОНТЕНДООС ИРСЭН МЭДЭЭЛЛИЙГ ХҮЛЭЭЖ АВАХ ---
        const { amount, name, phone, staffName } = req.body;

        // "20,000 ₮" гэж ирсэн ч зөвхөн тоог нь ялгаж авах
        // Дүнг сервер тогтооно: үсчний зэрэглэлийн үнэ, эсвэл зөвхөн тестийн
        // гарын үсэгтэй cookie-той хөтөчид 100₮. Хөтчөөс ирсэн дүнг үл тооно.
        const finalAmount = depositFor(req, staffName);
        if (!finalAmount) {
            await hold.release();
            return res.status(422).json({ error: 'Unknown stylist' });
        }
        const isTest = isTestRequest(req);

        // Гүйлгээний утгад Нэр, Утсыг нь оруулах
        const finalDescription = `${name || 'Үйлчлүүлэгч'} - ${phone || 'Утасгүй'}`.substring(0, 255);

        // --- 1б. БАНКНЫ ДАНС (салбарын данс) ---
        const bankAccountsPayload = account.bankAccounts;

        // --- 2. TOKEN АВАХ (салбарын QPay эрхээр) ---
        const auth = Buffer.from(`${account.username}:${account.password}`).toString('base64');
        const tokenRes = await axios.post('https://quickqr.qpay.mn/v2/auth/token',
            { terminal_id: account.terminalId },
            { headers: { 'Authorization': `Basic ${auth}` } }
        );
        const token = tokenRes.data.access_token;

        // --- 3. PAYLOAD БЭЛДЭХ ---
        // QPay calls callback_url when the customer pays, even long after the
        // QR appeared or with the page closed; routes/qpay.js /late-payment
        // then books the slot or alerts the salon. The URL carries the booking,
        // signed (services/lateBooking.js). Omitted if it cannot be built.
        const consent = consentTime(req.body.depositTermsAcceptedAt);
        const callbackUrl = callbackUrlForPayment(publicOrigin(req), req.body, { agreedAt: consent.at, amount: finalAmount, test: isTest });
        const payload = {
            merchant_id: merchantId,
            amount: finalAmount, // Бодит үнэ
            currency: 'MNT',
            description: finalDescription, // Бодит нэр, утас
            mcc_code: '7230',
        };
        if (bankAccountsPayload && bankAccountsPayload.length > 0) payload.bank_accounts = bankAccountsPayload;
        if (callbackUrl) payload.callback_url = callbackUrl;
        else console.warn('create-payment: no payment callback for this invoice (booking unreadable or no signing key)');

        // --- 4. INVOICE ҮҮСГЭХ ---
        const invoiceRes = await axios.post('https://quickqr.qpay.mn/v2/invoice', 
            payload,
            { headers: { 'Authorization': `Bearer ${token}` } }
        );

        // Evidence for a later dispute, alongside the line written on the
        // calendar event: which invoice was created after the customer agreed.
        console.log('Deposit terms accepted:', JSON.stringify({
            invoice_id: invoiceRes.data && (invoiceRes.data.invoice_id || invoiceRes.data.id),
            branch: branchCheck.branch,
            staffName,
            customerGender: rulesCheck.customerGender,
            bookingDate: req.body.bookingDate,
            acceptedAt: consent.at.toISOString(),
            acceptedAtSource: consent.source,
        }));

        return res.status(200).json({ ...invoiceRes.data, hold_expires_at: hold.expiresAt.toISOString() });

    } catch (error) {
        console.error("API ROUTE АЛДАА:", error.response?.data || error.message);
        // No QR for this time after all: give it back at once.
        await hold.release();
        return res.status(500).json({ 
            error: 'Failed to create QPay invoice', 
            details: error.response?.data || error.message 
        });
    }
}
