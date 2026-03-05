const axios = require('axios');

async function register() {
    try {
        // 1. GET TOKEN
        const terminalId = "DALATECH_AI"; // Corrected quote mark here
        const auth = Buffer.from(`${process.env.QPAY_USERNAME}:${process.env.QPAY_PASSWORD}`).toString('base64');

        console.log("Requesting token...");
        const tokenRes = await axios.post('https://quickqr.qpay.mn/v2/auth/token', 
            { terminal_id: terminalId }, 
            { headers: { 'Authorization': `Basic ${auth}` } }
        );

        const accessToken = tokenRes.data.access_token;
        console.log("Token received. Registering merchant...");

        // 2. CREATE MERCHANT
        const merchantData = {
            "register_number": "8354405",
            "company_name": "KNK Eco Crown",
            "name": "Matrix Eco Salon",
            "mcc_code": "7230", 
            "city": "11000",
            "district": "17000", 
            "address": "763 байр 3 тоот, Хан-уул дүүрэг, 4-хороо, наадамчдын зам гудамж, Төгөлдөр Апартмент, Ulaanbaatar 17110",
            "phone": "91005498",
            "email": "oyunaakhuslen1986@gmail.com",
            "bank_accounts": [{
                "account_bank_code": "040000", 
                "account_number": "416055415",
                "account_name": "Эрхэмбаатар Оюунсүрэн",
                "is_default": true
            }]
        };

        const merchantRes = await axios.post('https://quickqr.qpay.mn/v2/merchant/company', 
            merchantData,
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
        );

        console.log("-----------------------------------------");
        console.log("SUCCESS! YOUR MERCHANT ID IS:", merchantRes.data.id);
        console.log("-----------------------------------------");

    } catch (error) {
        console.error("QPay API Error Details:", error.response ? error.response.data : error.message);
        process.exit(1);
    }
}

register();
