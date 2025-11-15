require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const mercadopago = require('mercadopago');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
  console.error('Missing Supabase env vars (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY)');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

// Mercado Pago client wrapper (keeps same usage as original file)
const client = new mercadopago.MercadoPagoConfig({ accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN });
const preference = new mercadopago.Preference(client);
const payment = new mercadopago.Payment(client);

module.exports = {
  supabase,
  supabaseAdmin,
  supabaseUrl,
  preference,
  payment,
  mercadopagoClient: client,
};
