'use strict';

require('dotenv').config();
const axios = require('axios');
const { getQPayToken } = require('./services/qpay');

const QPAY_BASE_URL = 'https://quickqr.qpay.mn/v2';

const MERCHANT_TYPE = 'company';

// Company registration details supplied for this one-time merchant setup.
// These values are taken directly from the business registration documents.
// district: 17000 = Khan-Uul District code
// city:     11000 = Ulaanbaatar city code
// mcc_code:  7230 = Beauty and Barber Shops (international / QPay standard)
const COMPANY_PAYLOAD = {
  register_number: '8354405',
  district: '17000',
  city: '11000',
  address: '763 байр 3 тоот, Хан-уул дүүрэг, 4-хороо, наадамчдын зам гудамж, Төгөлдөр Апартмент, Ulaanbaatar 17110',
  phone: '91005498',
  email: 'oyunaakhuslen1986@gmail.com',
  mcc_code: '7230',
};

async function createMerchant() {
  const accessToken = await getQPayToken();

  const response = await axios.post(
    `${QPAY_BASE_URL}/merchant`,
    {
      merchant_type: MERCHANT_TYPE,
      [MERCHANT_TYPE]: COMPANY_PAYLOAD,
    },
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  const merchantId =
    response.data.merchant_id ||
    response.data.id ||
    response.data.merchantId ||
    null;

  console.log('Merchant created successfully.');
  console.log('Merchant ID:', merchantId);
  console.log('Full response:', JSON.stringify(response.data, null, 2));

  return merchantId;
}

createMerchant().catch((err) => {
  console.error('Failed to create merchant:', err.response?.data || err.message);
  process.exit(1);
});
