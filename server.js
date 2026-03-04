'use strict';

require('dotenv').config();

const express = require('express');
const webhookRouter = require('./routes/webhooks');
const qpayRouter = require('./routes/qpay');
const calendarRouter = require('./routes/calendar');

const app = express();

app.use(express.json());

app.use('/api/webhooks', webhookRouter);
app.use('/api/qpay', qpayRouter);
app.use('/api/calendar', calendarRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Matrix Salon server running on port ${PORT}`);
});

module.exports = app;
